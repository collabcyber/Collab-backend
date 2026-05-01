const Checkpoint = require('../models/Checkpoint')
const Project = require('../models/Project')

const PHASES = ['problem', 'plan', 'build', 'mvp', 'validation', 'demo']
const PHASE_INDEX = PHASES.reduce((acc, phase, index) => {
  acc[phase] = index
  return acc
}, {})

const toId = (value) => (value ? value.toString() : '')

const getNextPhase = (phase) => {
  const currentIndex = PHASE_INDEX[phase]
  if (currentIndex === undefined || currentIndex < 0) return 'problem'
  if (currentIndex >= PHASES.length - 1) return PHASES[PHASES.length - 1]
  return PHASES[currentIndex + 1]
}

const isTeamMemberOrOwner = (project, userId) => {
  if (!project || !userId) return false

  const userIdString = toId(userId)
  if (!userIdString) return false

  if (toId(project.owner) === userIdString) return true

  const teamMembers = project.teamMembers || []
  return teamMembers.some((memberId) => toId(memberId) === userIdString)
}

exports.submitCheckpoint = async (req, res) => {
  try {
    const { projectId, phase, submissionLink, description } = req.body
    const userId = req.user?.userId

    const project = await Project.findById(projectId).select('owner teamMembers phase buildPhase')
    if (!project) {
      return res.status(404).json({ message: 'Project not found' })
    }

    if (!isTeamMemberOrOwner(project, userId)) {
      return res.status(403).json({ message: 'Only project team members can submit checkpoints' })
    }

    const currentPhase = PHASES.includes(project.phase) ? project.phase : 'problem'
    if (phase !== currentPhase) {
      return res.status(400).json({ message: 'Invalid phase submission', currentPhase })
    }

    const existing = await Checkpoint.findOne({ projectId, phase }).select('_id')
    if (existing) {
      return res.status(409).json({ message: 'Checkpoint for this phase already submitted' })
    }

    const checkpoint = await Checkpoint.create({
      projectId,
      phase,
      submissionLink,
      description: description || ''
    })

    project.phase = getNextPhase(currentPhase)
    if (project.buildPhase) {
      project.buildPhase.lastActivity = new Date()
    }
    await project.save()

    return res.status(201).json({
      message: 'Checkpoint submitted successfully',
      checkpoint,
      projectPhase: project.phase
    })
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'Checkpoint for this phase already submitted' })
    }

    console.error('Submit checkpoint error:', error)
    return res.status(500).json({ message: 'Failed to submit checkpoint' })
  }
}

exports.getProjectCheckpoints = async (req, res) => {
  try {
    const { projectId } = req.params
    const userId = req.user?.userId

    const project = await Project.findById(projectId).select('owner teamMembers phase')
    if (!project) {
      return res.status(404).json({ message: 'Project not found' })
    }

    if (!isTeamMemberOrOwner(project, userId)) {
      return res.status(403).json({ message: 'Only project team members can view checkpoints' })
    }

    const checkpoints = await Checkpoint.find({ projectId }).lean()

    checkpoints.sort((a, b) => {
      const phaseDiff = (PHASE_INDEX[a.phase] ?? Number.MAX_SAFE_INTEGER) - (PHASE_INDEX[b.phase] ?? Number.MAX_SAFE_INTEGER)
      if (phaseDiff !== 0) return phaseDiff
      return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime()
    })

    return res.json({
      projectId,
      currentPhase: PHASES.includes(project.phase) ? project.phase : 'problem',
      checkpoints
    })
  } catch (error) {
    console.error('Get checkpoints error:', error)
    return res.status(500).json({ message: 'Failed to fetch checkpoints' })
  }
}
