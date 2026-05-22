const Checkpoint = require('../models/Checkpoint')
const Project = require('../models/Project')
const User = require('../models/User')

const PHASES = ['problem', 'plan', 'build', 'mvp', 'validation', 'demo']
const PHASE_INDEX = PHASES.reduce((acc, phase, index) => {
  acc[phase] = index
  return acc
}, {})

const PHASE_PROMPTS = {
  problem: [
    { questionKey: 'problem_pain', question: 'What problem are you solving?' },
    { questionKey: 'problem_why', question: 'Why does this problem matter right now?' },
    { questionKey: 'problem_origin', question: 'What inspired this venture concept?' }
  ],
  plan: [
    { questionKey: 'plan_solution', question: 'What is your core solution and how will it work?' },
    { questionKey: 'plan_scope', question: 'What is your next execution scope?' },
    { questionKey: 'plan_roles', question: 'Which contributor roles are critical this week?' }
  ],
  build: [
    { questionKey: 'build_shipped', question: 'What did your team build in this phase?' },
    { questionKey: 'build_testing', question: 'What did you test with users or teammates?' },
    { questionKey: 'build_blockers', question: 'What is currently blocking momentum?' }
  ],
  mvp: [
    { questionKey: 'mvp_value', question: 'What can users do in your current MVP?' },
    { questionKey: 'mvp_gap', question: 'What is still incomplete before broader testing?' },
    { questionKey: 'mvp_risk', question: 'What is the biggest product or execution risk now?' }
  ],
  validation: [
    { questionKey: 'validation_users', question: 'Who did you speak to and what did they say?' },
    { questionKey: 'validation_surprises', question: 'What surprised your team most from feedback?' },
    { questionKey: 'validation_failures', question: 'Which assumptions failed and what changed?' }
  ],
  demo: [
    { questionKey: 'demo_story', question: 'How does your demo prove startup progress?' },
    { questionKey: 'demo_traction', question: 'What traction or validation signals can you show?' },
    { questionKey: 'demo_next', question: 'What is the next venture milestone?' }
  ]
}

const toId = (value) => (value ? value.toString() : '')

const normalizeText = (value, maxLength) => {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

const normalizeList = (value, maxLength = 240, maxItems = 12) => {
  const list = Array.isArray(value) ? value : value ? [value] : []
  const cleaned = list
    .map((item) => normalizeText(typeof item === 'string' ? item : String(item), maxLength))
    .filter(Boolean)
    .slice(0, maxItems)
  return [...new Set(cleaned)]
}

const normalizeUrlList = (value) => {
  const list = Array.isArray(value) ? value : value ? [value] : []
  const cleaned = list
    .map((item) => normalizeText(typeof item === 'string' ? item : String(item), 1000))
    .filter(Boolean)
    .slice(0, 20)
  return [...new Set(cleaned)]
}

const getExpectedPrompts = (phase) => PHASE_PROMPTS[phase] || []

const getNextPhase = (phase) => {
  const currentIndex = PHASE_INDEX[phase]
  if (currentIndex === undefined || currentIndex < 0) return 'problem'
  if (currentIndex >= PHASES.length - 1) return PHASES[PHASES.length - 1]
  return PHASES[currentIndex + 1]
}

const getCurrentCheckpointPhase = async (projectId) => {
  const submitted = await Checkpoint.find({ projectId }).select('phase').lean()
  const submittedPhases = new Set(submitted.map((checkpoint) => checkpoint.phase))
  return PHASES.find((phase) => !submittedPhases.has(phase)) || PHASES[PHASES.length - 1]
}

const isTeamMemberOrOwner = (project, userId) => {
  if (!project || !userId) return false

  const userIdString = toId(userId)
  if (!userIdString) return false

  if (toId(project.owner) === userIdString) return true

  const teamMembers = project.teamMembers || []
  return teamMembers.some((memberId) => toId(memberId) === userIdString)
}

const getProjectParticipantIds = (project) => {
  const ids = new Set()
  const ownerId = toId(project?.owner)
  if (ownerId) ids.add(ownerId)

  ;(project?.teamMembers || []).forEach((memberId) => {
    const normalized = toId(memberId)
    if (normalized) ids.add(normalized)
  })

  return Array.from(ids)
}

const completeSprintForProject = async (project) => {
  if (!project) return

  if (project.buildPhase) {
    project.buildPhase.lastActivity = new Date()
  }
  await project.save()

  const participantIds = getProjectParticipantIds(project)
  if (participantIds.length > 0) {
    await User.updateMany(
      { _id: { $in: participantIds } },
      { $set: { sprintStatus: 'completed' } }
    )
  }
}

const normalizeExecutionEntry = (payload = {}, phase) => {
  const legacySubmissionLink = normalizeText(payload.submissionLink || '', 1000)
  const legacyDescription = normalizeText(payload.description || '', 2000)
  const rawEntry = payload.executionEntry || {}
  const expectedPrompts = getExpectedPrompts(phase)

  const reflectionsInput = Array.isArray(rawEntry.reflections) ? rawEntry.reflections : []
  let reflections = reflectionsInput
    .map((entry) => ({
      questionKey: normalizeText(entry?.questionKey || '', 120),
      question: normalizeText(entry?.question || '', 240),
      answer: normalizeText(entry?.answer || '', 2000)
    }))
    .filter((entry) => entry.questionKey && entry.question && entry.answer)
    .slice(0, 20)

  // Backward compatibility: transform legacy link/note into a structured reflection.
  if (reflections.length === 0 && (legacySubmissionLink || legacyDescription)) {
    const fallbackPrompt = expectedPrompts[0] || {
      questionKey: 'legacy_update',
      question: 'What did your team complete in this stage?'
    }
    reflections = [
      {
        questionKey: fallbackPrompt.questionKey,
        question: fallbackPrompt.question,
        answer: legacyDescription || `Legacy evidence: ${legacySubmissionLink}`
      }
    ]
  }

  const evidenceLinks = normalizeUrlList(rawEntry.evidenceLinks)
  if (legacySubmissionLink && !evidenceLinks.includes(legacySubmissionLink)) {
    evidenceLinks.unshift(legacySubmissionLink)
  }

  const executionEntry = {
    progressNarrative: normalizeText(rawEntry.progressNarrative || legacyDescription, 2500),
    nextMilestone: normalizeText(rawEntry.nextMilestone || '', 300),
    blockers: normalizeList(rawEntry.blockers, 240, 12),
    evidenceLinks,
    reflections
  }

  return {
    executionEntry,
    submissionLink: executionEntry.evidenceLinks[0] || '',
    description: executionEntry.progressNarrative || ''
  }
}

const formatCheckpointForResponse = (checkpoint) => {
  const phase = checkpoint?.phase
  return {
    ...checkpoint,
    expectedPrompts: getExpectedPrompts(phase)
  }
}

exports.submitCheckpoint = async (req, res) => {
  try {
    const { projectId, phase } = req.body
    const userId = req.user?.userId

    const project = await Project.findById(projectId).select('owner teamMembers buildPhase')
    if (!project) {
      return res.status(404).json({ message: 'Venture not found' })
    }

    if (!isTeamMemberOrOwner(project, userId)) {
      return res.status(403).json({ message: 'Only venture team contributors can submit checkpoints' })
    }

    const currentPhase = await getCurrentCheckpointPhase(projectId)
    if (phase !== currentPhase) {
      return res.status(400).json({ message: 'Invalid phase submission', currentPhase })
    }

    const existing = await Checkpoint.findOne({ projectId, phase }).select('_id')
    if (existing) {
      if (phase === 'demo') {
        await completeSprintForProject(project)
        return res.status(200).json({
          success: true,
          alreadyCompleted: true,
          message: 'Demo already submitted. Your sprint is complete.',
          sprintCompleted: true,
          projectPhase: 'demo'
        })
      }
      return res.status(409).json({ message: 'Checkpoint for this phase already submitted' })
    }

    const { executionEntry, submissionLink, description } = normalizeExecutionEntry(req.body, phase)
    if (!executionEntry.reflections.length) {
      return res.status(400).json({
        message: 'Structured stage reflections are required before submission'
      })
    }

    const checkpoint = await Checkpoint.create({
      projectId,
      phase,
      submissionLink,
      description,
      executionEntry,
      submittedBy: userId
    })

    if (currentPhase === 'demo') {
      await completeSprintForProject(project)
      return res.status(201).json({
        success: true,
        sprintCompleted: true,
        message: 'Sprint completed successfully.',
        checkpoint: formatCheckpointForResponse(checkpoint.toObject()),
        projectPhase: 'demo'
      })
    }

    if (project.buildPhase) {
      project.buildPhase.lastActivity = new Date()
    }
    await project.save()

    return res.status(201).json({
      success: true,
      sprintCompleted: false,
      message: 'Checkpoint submitted successfully',
      checkpoint: formatCheckpointForResponse(checkpoint.toObject()),
      nextCheckpointPhase: getNextPhase(currentPhase)
    })
  } catch (error) {
    if (error?.code === 11000) {
      if (req.body?.phase === 'demo') {
        try {
          const project = await Project.findById(req.body?.projectId).select('owner teamMembers buildPhase')
          if (project) {
            await completeSprintForProject(project)
          }
        } catch (syncError) {
          console.error('Demo checkpoint completion sync error:', syncError)
        }

        return res.status(200).json({
          success: true,
          alreadyCompleted: true,
          message: 'Demo already submitted. Your sprint is complete.',
          sprintCompleted: true,
          projectPhase: 'demo'
        })
      }
      return res.status(409).json({ message: 'Checkpoint for this phase already submitted' })
    }

    console.error('Submit checkpoint error:', error)
    return res.status(500).json({ message: 'Failed to submit checkpoint' })
  }
}

exports.updateCheckpoint = async (req, res) => {
  try {
    const { projectId, phase } = req.params
    const userId = req.user?.userId

    const project = await Project.findById(projectId).select('owner teamMembers')
    if (!project) {
      return res.status(404).json({ message: 'Venture not found' })
    }

    if (!isTeamMemberOrOwner(project, userId)) {
      return res.status(403).json({ message: 'Only venture team contributors can edit checkpoints' })
    }

    const checkpoint = await Checkpoint.findOne({ projectId, phase })
    if (!checkpoint) {
      return res.status(404).json({
        message: 'Checkpoint for this phase does not exist yet. Submit this phase first.'
      })
    }

    const { executionEntry, submissionLink, description } = normalizeExecutionEntry(req.body, phase)
    if (!executionEntry.reflections.length) {
      return res.status(400).json({ message: 'Structured stage reflections are required before update' })
    }

    checkpoint.submissionLink = submissionLink
    checkpoint.description = description
    checkpoint.executionEntry = executionEntry
    await checkpoint.save()

    return res.json({
      success: true,
      message: 'Checkpoint updated successfully',
      checkpoint: formatCheckpointForResponse(checkpoint.toObject())
    })
  } catch (error) {
    console.error('Update checkpoint error:', error)
    return res.status(500).json({ message: 'Failed to update checkpoint' })
  }
}

exports.getProjectCheckpoints = async (req, res) => {
  try {
    const { projectId } = req.params
    const userId = req.user?.userId

    const project = await Project.findById(projectId).select('owner teamMembers')
    if (!project) {
      return res.status(404).json({ message: 'Venture not found' })
    }

    if (!isTeamMemberOrOwner(project, userId)) {
      return res.status(403).json({ message: 'Only venture team contributors can view checkpoints' })
    }

    const checkpoints = await Checkpoint.find({ projectId }).lean()

    checkpoints.sort((a, b) => {
      const phaseDiff = (PHASE_INDEX[a.phase] ?? Number.MAX_SAFE_INTEGER) - (PHASE_INDEX[b.phase] ?? Number.MAX_SAFE_INTEGER)
      if (phaseDiff !== 0) return phaseDiff
      return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime()
    })

    return res.json({
      projectId,
      currentPhase: await getCurrentCheckpointPhase(projectId),
      phasePrompts: PHASE_PROMPTS,
      checkpoints: checkpoints.map(formatCheckpointForResponse)
    })
  } catch (error) {
    console.error('Get checkpoints error:', error)
    return res.status(500).json({ message: 'Failed to fetch checkpoints' })
  }
}
