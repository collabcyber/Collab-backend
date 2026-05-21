const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const mongoose = require('mongoose')
const Project = require('../models/Project')
const Checkpoint = require('../models/Checkpoint')
const User = require('../models/User')
const { createNotification } = require('./notificationController')
const { applyUserStats, POINTS, computeBadges } = require('../utils/points')
const { submitValidation } = require('./validationController')
const { sendEmail } = require('../services/emailService')
const { generateValidationCertificates, buildVerificationUrl } = require('../services/certificateService')
const { logSecurityEvent } = require('../middleware/securityLogger')

const toId = (value) => (value ? value.toString() : '')
const SPRINT_PHASES = ['problem', 'plan', 'build', 'mvp', 'validation', 'demo']
const SPRINT_PHASE_INDEX = SPRINT_PHASES.reduce((acc, phase, index) => {
  acc[phase] = index
  return acc
}, {})
const FILE_LINK_TTL_SECONDS = Math.max(60, parseInt(process.env.FILE_LINK_TTL_SECONDS || '900', 10) || 900)
const FILE_ACCESS_SECRET = process.env.FILE_ACCESS_SECRET || process.env.JWT_SECRET || 'collab-file-access-secret'
const PUBLIC_API_BASE = (process.env.PUBLIC_API_BASE || 'https://api.collab.qzz.io').replace(/\/$/, '')
const PROJECT_VISIBILITY = new Set(['private', 'college', 'global'])

const createIdeaFingerprint = ({ title, shortPitch, description, executionPlan, category, ownerId }) => {
  const normalized = [
    title || '',
    shortPitch || '',
    description || '',
    executionPlan || '',
    category || '',
    ownerId || ''
  ]
    .map((value) => String(value).trim().toLowerCase())
    .join('|')
  return crypto.createHash('sha256').update(normalized).digest('hex')
}

const createFileSignature = ({ projectId, fileId, userId, expiresAt }) =>
  crypto
    .createHmac('sha256', FILE_ACCESS_SECRET)
    .update(`${projectId}:${fileId}:${userId}:${expiresAt}`)
    .digest('hex')

const buildSignedFileUrl = ({ projectId, fileId, userId }) => {
  if (!projectId || !fileId || !userId) return ''
  const expiresAt = Date.now() + FILE_LINK_TTL_SECONDS * 1000
  const sig = createFileSignature({
    projectId: projectId.toString(),
    fileId: fileId.toString(),
    userId: userId.toString(),
    expiresAt
  })
  return `${PUBLIC_API_BASE}/api/projects/${projectId}/files/${fileId}/download?exp=${expiresAt}&sig=${sig}`
}

const verifyFileSignature = ({ projectId, fileId, userId, expiresAt, sig }) => {
  if (!projectId || !fileId || !userId || !expiresAt || !sig) return false
  const expNumber = Number(expiresAt)
  if (!Number.isFinite(expNumber) || expNumber < Date.now()) return false

  const expected = createFileSignature({
    projectId: projectId.toString(),
    fileId: fileId.toString(),
    userId: userId.toString(),
    expiresAt: expNumber
  })

  const expectedBuffer = Buffer.from(expected, 'utf8')
  const providedBuffer = Buffer.from(String(sig), 'utf8')
  if (expectedBuffer.length !== providedBuffer.length) return false
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer)
}

const normalizeLabel = (value) => {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

const normalizeLabelList = (items) => {
  const list = Array.isArray(items) ? items : items ? [items] : []
  const normalized = list
    .map((item) => normalizeLabel(typeof item === 'string' ? item : ''))
    .filter(Boolean)
  return [...new Set(normalized)]
}

const normalizePlainText = (value, maxLength = 500) => {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

const normalizeLongText = (value, maxLength = 3000) => {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

const normalizeValidationAssumptions = (items) => {
  const list = Array.isArray(items) ? items : items ? [items] : []
  const normalized = list
    .map((item) => normalizeLongText(typeof item === 'string' ? item : String(item), 300))
    .filter(Boolean)
  return [...new Set(normalized)].slice(0, 30)
}

const normalizeValidationTasks = (items) => {
  const list = Array.isArray(items) ? items : []

  return list
    .map((item) => {
      if (typeof item === 'string') {
        return {
          taskId: new mongoose.Types.ObjectId().toString(),
          title: normalizePlainText(item, 180),
          status: 'pending',
          dueDate: undefined,
          updatedAt: new Date(),
          completedAt: undefined
        }
      }

      const title = normalizePlainText(item?.title || '', 180)
      if (!title) return null

      const status = item?.status === 'completed' ? 'completed' : 'pending'
      const dueDate = item?.dueDate ? new Date(item.dueDate) : undefined
      const completedAt = status === 'completed'
        ? (item?.completedAt ? new Date(item.completedAt) : new Date())
        : undefined

      return {
        taskId: item?.taskId || new mongoose.Types.ObjectId().toString(),
        title,
        status,
        dueDate: dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : undefined,
        updatedAt: new Date(),
        completedAt
      }
    })
    .filter(Boolean)
    .slice(0, 100)
}

const VALIDATION_EVIDENCE_KINDS = new Set([
  'survey',
  'interview',
  'waitlist',
  'feedback',
  'experiment',
  'insight',
  'other'
])

const normalizeValidationEvidence = (items) => {
  const list = Array.isArray(items) ? items : []

  return list
    .map((item) => {
      if (!item) return null

      const title = normalizePlainText(item?.title || '', 180)
      if (!title) return null

      const kind = VALIDATION_EVIDENCE_KINDS.has(item?.kind) ? item.kind : 'other'
      const summary = normalizeLongText(item?.summary || '', 1500)
      const link = normalizePlainText(item?.link || '', 1000)

      return {
        evidenceId: item?.evidenceId || new mongoose.Types.ObjectId().toString(),
        kind,
        title,
        summary,
        link,
        createdAt: item?.createdAt ? new Date(item.createdAt) : new Date()
      }
    })
    .filter(Boolean)
    .slice(0, 300)
}

const isViewerTeamMember = (project, viewerId) => {
  if (!viewerId) return false
  return (project.teamMembers || []).some((member) => toId(member._id || member) === viewerId)
}

const sanitizeProjectForViewer = (projectDoc, viewerId) => {
  if (!projectDoc) return null
  const project = projectDoc.toObject({ virtuals: true })
  const ownerId = toId(project.owner?._id || project.owner)
  const isOwner = viewerId && ownerId === viewerId
  const isTeamMember = isViewerTeamMember(project, viewerId)
  const isPrivilegedViewer = Boolean(isOwner || isTeamMember)

  const withDownloadLinks = (files = []) =>
    files.map((file) => {
      const fileId = toId(file?._id || file?.filename)
      return {
        ...file,
        downloadUrl: buildSignedFileUrl({
          projectId: project._id,
          fileId,
          userId: viewerId
        })
      }
    })

  if (!isOwner) {
    project.interestedUsers = []
    project.security = undefined
  }

  if (!isPrivilegedViewer) {
      project.teamMembers = (project.teamMembers || []).map((member) => ({
        _id: member._id,
        name: member.name || 'Contributor'
      }))

    // Keep external view focused on a public summary, not the implementation details.
    project.executionPlan = undefined
    project.techProduct = undefined
    project.businessStartup = undefined
    project.designCreative = undefined
    project.marketingContent = undefined
    project.servicesOperations = undefined

    project.files = []
    project.messages = []
    if (!['validation', 'validated', 'validation_failed'].includes(project.status) && project.validation) {
      project.validation.sharedFiles = []
    }
    if (project.owner) {
      const ownerId = project.owner._id || project.owner
      project.owner = {
        _id: ownerId,
        name: project.owner.name || 'Owner'
      }
    }
  }

  if (!isPrivilegedViewer && project.validation?.reviews) {
    project.validation.reviews = []
  }

  if (Array.isArray(project.files) && viewerId) {
    project.files = withDownloadLinks(project.files)
  }

  if (Array.isArray(project.validation?.sharedFiles) && viewerId) {
    project.validation.sharedFiles = withDownloadLinks(project.validation.sharedFiles)
  }

  project.accessWatermark = {
    viewerId: viewerId || 'unknown',
    issuedAt: new Date().toISOString()
  }

  return project
}

const maybeApplyInactivityPenalty = async (project) => {
  if (!project?.buildPhase?.isActive) return

  const lastActivity = project.buildPhase.lastActivity
  if (!lastActivity) return

  const lastPenaltyAt = project.buildPhase.lastPenaltyAt
  const now = Date.now()
  const diff = now - new Date(lastActivity).getTime()

  if (diff < 48 * 60 * 60 * 1000) return
  if (lastPenaltyAt && new Date(lastPenaltyAt).getTime() >= new Date(lastActivity).getTime()) return

  const teamIds = [project.owner, ...(project.teamMembers || [])]
  await Promise.all(
    teamIds.map((id) =>
      applyUserStats(id, {
        points: POINTS.inactivity_penalty,
        inc: { inactivePenalties: 1 },
        touchActive: false
      })
    )
  )

  project.buildPhase.lastPenaltyAt = new Date()
  await project.save()
}

exports.createProject = async (req, res) => {
  try {
    const {
      title,
      shortPitch,
      description,
      category,
      tags,
      rolesNeeded,
      skillsRequired,
      numberOfTeammates,
      visibility,
      executionPlan,
      techProduct,
      businessStartup,
      designCreative,
      marketingContent,
      servicesOperations
    } = req.body

    const userId = req.user.userId

    const normalizedTitle = title?.trim()
    const normalizedShortPitch = shortPitch?.trim()
    const normalizedCategory = category?.trim()
    const normalizedExecutionPlan = executionPlan?.trim()
    const normalizedDescription = (description?.trim() || normalizedShortPitch || normalizedTitle || '').trim()

    if (!normalizedTitle || !normalizedShortPitch || !normalizedCategory || !normalizedExecutionPlan) {
      return res.status(400).json({ message: 'Title, short pitch, category, and execution plan are required' })
    }

    const owner = await User.findById(userId).select('college college_id')

    const normalizedSkills = normalizeLabelList(skillsRequired)
    const normalizedRoles = normalizeLabelList(rolesNeeded)
    const normalizedVisibility = PROJECT_VISIBILITY.has(visibility) ? visibility : 'private'
    const ideaFingerprint = createIdeaFingerprint({
      title: normalizedTitle,
      shortPitch: normalizedShortPitch,
      description: normalizedDescription,
      executionPlan: normalizedExecutionPlan,
      category: normalizedCategory,
      ownerId: userId
    })

    const project = new Project({
      title: normalizedTitle,
      shortPitch: normalizedShortPitch,
      description: normalizedDescription,
      category: normalizedCategory,
      tags: (Array.isArray(tags) ? tags : tags ? [tags] : []).filter(Boolean),
      rolesNeeded: normalizedRoles,
      skillsRequired: normalizedSkills,
      numberOfTeammates: Math.min(10, Math.max(1, parseInt(numberOfTeammates, 10) || 1)),
      visibility: normalizedVisibility,
      college: owner?.college || owner?.college_id || undefined,
      executionPlan: normalizedExecutionPlan,
      security: {
        ideaFingerprint,
        fingerprintAlgorithm: 'sha256',
        fingerprintVersion: 1,
        fingerprintedAt: new Date()
      },
      owner: userId,
      teamMembers: [userId],
      status: 'planning',
      buildPhase: {
        startDate: new Date(),
        endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        isActive: true,
        lastActivity: new Date(),
        totalDurationDays: 14,
        isExtendedTimeline: false,
        extensionCount: 0,
        extensionDaysGranted: 0
      },
      techProduct: category === 'Tech & Product' ? techProduct : undefined,
      businessStartup: category === 'Business & Startup' ? businessStartup : undefined,
      designCreative: category === 'Design & Creative' ? designCreative : undefined,
      marketingContent: category === 'Marketing & Content' ? marketingContent : undefined,
      servicesOperations: category === 'Services & Operations' ? servicesOperations : undefined
    })

    await project.save()

    await applyUserStats(userId, {
      points: POINTS.create_project,
      inc: { projectsCreated: 1 }
    })

    const populatedProject = await Project.findById(project._id).populate('owner', 'name email')

    res.status(201).json({
      message: 'Venture created successfully',
      project: populatedProject
    })
  } catch (error) {
    console.error('Create venture error:', error)
    res.status(500).json({ message: 'Failed to create venture' })
  }
}

exports.getProjects = async (req, res) => {
  try {
    const { college, category, skills, status, roles, page = 1, limit = 20 } = req.query
    const parsedLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20))
    const parsedPage = Math.max(1, parseInt(page, 10) || 1)
    const filter = {}
    const viewerId = req.user?.userId ? req.user.userId.toString() : ''
    const viewer = await User.findById(req.user.userId).select('college college_id')
    const viewerCollege = (viewer?.college || viewer?.college_id) ? (viewer.college || viewer.college_id).toString() : null

    const visibilityFilter = [{ visibility: 'global' }]
    if (viewerCollege) {
      visibilityFilter.push({ visibility: 'college', college: viewerCollege })
    }
    if (viewerId) {
      visibilityFilter.push({
        visibility: 'private',
        $or: [{ owner: viewerId }, { teamMembers: viewerId }]
      })
    }
    filter.$or = visibilityFilter

    if (typeof status === 'string' && status && status !== 'all') {
      filter.status = status
    } else {
      filter.status = { $ne: 'archived' }
    }

    if (college && college !== 'all') {
      if (!mongoose.Types.ObjectId.isValid(college)) {
        return res.status(400).json({ message: 'Invalid college filter' })
      }
      filter.college = college
    }

    if (category && category !== 'all') {
      filter.category = category
    }

    if (skills && skills !== 'all') {
      const skillsArray = Array.isArray(skills)
        ? skills
        : skills.split(',').map((skill) => skill.trim()).filter(Boolean)
      if (skillsArray.length > 0) {
        filter.skillsRequired = { $in: normalizeLabelList(skillsArray) }
      }
    }

    if (roles && roles !== 'all') {
      const rolesArray = Array.isArray(roles)
        ? roles
        : roles.split(',').map((role) => role.trim()).filter(Boolean)
      if (rolesArray.length > 0) {
        filter.rolesNeeded = { $in: normalizeLabelList(rolesArray) }
      }
    }

    let projects
    try {
      projects = await Project.find(filter)
        .populate('owner', 'name')
        .populate('college', 'name type')
        .sort({ createdAt: -1 })
        .limit(parsedLimit)
        .skip((parsedPage - 1) * parsedLimit)
    } catch (populateError) {
      if (populateError?.name === 'CastError' && populateError?.path === 'college') {
        console.warn('Venture college populate failed, falling back without college populate.')
        projects = await Project.find(filter)
          .populate('owner', 'name')
          .sort({ createdAt: -1 })
          .limit(parsedLimit)
          .skip((parsedPage - 1) * parsedLimit)
      } else {
        throw populateError
      }
    }

    const total = await Project.countDocuments(filter)
    const sanitizedProjects = projects.map((project) => sanitizeProjectForViewer(project, viewerId))

    res.json({
      projects: sanitizedProjects,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        pages: Math.ceil(total / parsedLimit)
      }
    })
  } catch (error) {
    console.error('Get ventures error:', error)
    res.status(500).json({ message: 'Failed to fetch ventures' })
  }
}

exports.getValidationProjects = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query
    const parsedLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20))
    const parsedPage = Math.max(1, parseInt(page, 10) || 1)
    const viewerId = req.user?.userId ? req.user.userId.toString() : ''

    const projects = await Project.find({ status: 'validation' })
      .populate('owner', 'name')
      .sort({ updatedAt: -1 })
      .limit(parsedLimit)
      .skip((parsedPage - 1) * parsedLimit)

    const total = await Project.countDocuments({ status: 'validation' })
    const sanitizedProjects = projects.map((project) => sanitizeProjectForViewer(project, viewerId))

    res.json({
      projects: sanitizedProjects,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        pages: Math.ceil(total / parsedLimit)
      }
    })
  } catch (error) {
    console.error('Get validation ventures error:', error)
    res.status(500).json({ message: 'Failed to fetch validation ventures' })
  }
}

exports.getProjectOptions = async (req, res) => {
  try {
    const [roles, skills] = await Promise.all([
      Project.distinct('rolesNeeded'),
      Project.distinct('skillsRequired')
    ])

    const normalizedRoles = normalizeLabelList(roles)
    const normalizedSkills = normalizeLabelList(skills)

    res.json({ roles: normalizedRoles, skills: normalizedSkills })
  } catch (error) {
    console.error('Get venture options error:', error)
    res.status(500).json({ message: 'Failed to fetch venture options' })
  }
}

exports.getProjectById = async (req, res) => {
  try {
    const { id } = req.params
    const viewerId = req.user?.userId ? req.user.userId.toString() : ''

    const project = await Project.findById(id).populate('college', 'name')
      .populate('owner', 'name email phone lastActive')
      .populate('teamMembers', 'name email phone lastActive')
      .populate('interestedUsers', 'name email phone lastActive')
      .populate('messages.sender', 'name email')
      .populate('files.uploadedBy', 'name email')
      .populate('validation.sharedFiles.uploadedBy', 'name email')
      .populate('validation.reviews.reviewer', 'name')

    if (!project) {
      return res.status(404).json({ message: 'Venture not found' })
    }

    const isOwner = toId(project.owner?._id) === viewerId
    const isTeamMember = isViewerTeamMember(project, viewerId) || isOwner

    if (project.visibility === 'private' && !isOwner && !isTeamMember) {
      return res.status(403).json({ message: 'This venture is visible only to the venture team' })
    }

    if (project.visibility === 'college' && !isOwner && !isTeamMember) {
      const viewer = await User.findById(viewerId).select('college college_id')
      const viewerCollege = (viewer?.college || viewer?.college_id) ? (viewer.college || viewer.college_id).toString() : null
      const projectCollege = project.college ? project.college.toString() : null
      if (viewerCollege && projectCollege && viewerCollege !== projectCollege) {
        return res.status(403).json({ message: 'This venture is visible to its college only' })
      }
    }

    if (isTeamMember) {
      await maybeApplyInactivityPenalty(project)
    }

    const sanitized = sanitizeProjectForViewer(project, viewerId)

    res.json(sanitized)
  } catch (error) {
    console.error('Get venture error:', error)
    res.status(500).json({ message: 'Failed to fetch venture' })
  }
}

exports.getProjectProof = async (req, res) => {
  try {
    const { id } = req.params

    const project = await Project.findById(id)
      .select('title shortPitch description phase status teamMembers owner')
      .populate('owner', 'name')
      .populate('teamMembers', 'name')
      .lean()

    if (!project) {
      return res.status(404).json({ message: 'Venture not found' })
    }

    const checkpoints = await Checkpoint.find({ projectId: id })
      .select('phase submissionLink description submittedAt')
      .lean()

    checkpoints.sort((a, b) => {
      const phaseDiff = (SPRINT_PHASE_INDEX[a.phase] ?? Number.MAX_SAFE_INTEGER) - (SPRINT_PHASE_INDEX[b.phase] ?? Number.MAX_SAFE_INTEGER)
      if (phaseDiff !== 0) return phaseDiff
      return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime()
    })

    const membersMap = new Map()
    const ownerId = toId(project.owner?._id || project.owner)
    const ownerName = project.owner?.name || 'Owner'
    if (ownerId) {
      membersMap.set(ownerId, ownerName)
    }

    ;(project.teamMembers || []).forEach((member) => {
      const memberId = toId(member?._id || member)
      if (!memberId) return
      if (!membersMap.has(memberId)) {
        membersMap.set(memberId, member?.name || 'Team Contributor')
      }
    })

    const phaseStatus = SPRINT_PHASES.includes(project.phase) ? project.phase : 'problem'
    const completed = phaseStatus === 'demo' && ['validated', 'completed'].includes(String(project.status || '').toLowerCase())

    return res.json({
      id: project._id,
      title: project.title,
      description: project.shortPitch || project.description || '',
      teamMembers: Array.from(membersMap.values()),
      checkpoints: checkpoints.map((checkpoint) => ({
        phase: checkpoint.phase,
        submissionLink: checkpoint.submissionLink,
        description: checkpoint.description || '',
        submittedAt: checkpoint.submittedAt
      })),
      finalPhaseStatus: completed ? 'completed' : 'in_progress',
      currentPhase: phaseStatus
    })
  } catch (error) {
    console.error('Get venture proof error:', error)
    return res.status(500).json({ message: 'Failed to load venture proof' })
  }
}

exports.joinProject = async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.user.userId

    const project = await Project.findById(id)
    if (!project) {
      return res.status(404).json({ message: 'Venture not found' })
    }

    const maxTeamMembers = project.numberOfTeammates || 0
    const teamCount = (project.teamMembers || []).length

    if (teamCount >= maxTeamMembers) {
      await createNotification(
        userId,
        'team_full',
        'Team Full',
        `${project.title} is now full.`,
        project._id,
        project.owner,
        false,
        `/project/${project._id}`
      )
      return res.status(400).json({ message: 'Team is full' })
    }

    const userIdString = userId.toString()
    const interested = (project.interestedUsers || []).map((uid) => uid.toString())
    const team = (project.teamMembers || []).map((uid) => uid.toString())

    if (project.owner?.toString() === userIdString) {
      return res.status(400).json({ message: 'Owner cannot join their own venture' })
    }

    if (team.includes(userIdString)) {
      return res.status(400).json({ message: 'Already a team contributor' })
    }

    if (interested.includes(userIdString)) {
      return res.status(400).json({ message: 'Already requested to join' })
    }

    project.interestedUsers.push(userId)
    await project.save()

    const requester = await User.findById(userId).select('name email')
    if (requester) {
      await createNotification(
        project.owner,
        'join_request',
        'New join request',
        `${requester.name || requester.email} requested to join ${project.title}.`,
        project._id,
        userId,
        true,
        `/project/${project._id}`
      )
    }

    res.json({ message: 'Join request sent successfully' })
  } catch (error) {
    console.error('Join venture error:', error)
    res.status(500).json({ message: 'Failed to join venture' })
  }
}

exports.respondToJoinRequest = async (req, res) => {
  try {
    const { id } = req.params
    const requesterId = req.user?.userId || req.body.requesterId
    const { userId, action } = req.body

    if (!requesterId || !userId || !action) {
      return res.status(400).json({ message: 'requesterId, userId, and action are required' })
    }

    const project = await Project.findById(id)
    if (!project) {
      return res.status(404).json({ message: 'Venture not found' })
    }

    if (project.owner.toString() !== requesterId.toString()) {
      return res.status(403).json({ message: 'Only venture owner can respond to requests' })
    }

    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ message: 'Action must be accept or reject' })
    }

    const interested = (project.interestedUsers || []).map((uid) => uid.toString())
    if (!interested.includes(userId.toString())) {
      return res.status(400).json({ message: 'User has not expressed interest yet' })
    }

    if (action === 'reject') {
      project.interestedUsers = project.interestedUsers.filter((uid) => uid.toString() !== userId.toString())
      await project.save()

      await createNotification(
        userId,
        'join_rejected',
        'Join request declined',
        `Your request to join ${project.title} was declined.`,
        project._id,
        project.owner,
        false,
        `/project/${project._id}`
      )

      return res.json({ message: 'Join request rejected' })
    }

    req.body.requesterId = requesterId
    req.body.userId = userId
    return exports.addTeamMember(req, res)
  } catch (error) {
    console.error('Respond to join request error:', error)
    res.status(500).json({ message: 'Failed to respond to join request' })
  }
}

exports.addTeamMember = async (req, res) => {
  try {
    const { id } = req.params
    const requesterId = req.user?.userId || req.body.requesterId
    const { userId } = req.body

    if (!requesterId || !userId) {
      return res.status(400).json({ message: 'requesterId and userId are required' })
    }

    const project = await Project.findById(id)
    if (!project) {
      return res.status(404).json({ message: 'Venture not found' })
    }

    const maxTeamMembers = project.numberOfTeammates || 0
    const currentTeamCount = (project.teamMembers || []).length

    if (currentTeamCount >= maxTeamMembers) {
      return res.status(400).json({ message: 'Team is full' })
    }

    if (project.owner.toString() !== requesterId.toString()) {
      return res.status(403).json({ message: 'Only venture owner can add team contributors' })
    }

    const interested = (project.interestedUsers || []).map((uid) => uid.toString())
    if (!interested.includes(userId.toString())) {
      return res.status(400).json({ message: 'User has not expressed interest yet' })
    }

    const team = (project.teamMembers || []).map((uid) => uid.toString())
    if (team.includes(userId.toString())) {
      return res.status(400).json({ message: 'User already on team' })
    }

    project.teamMembers.push(userId)
    project.interestedUsers = project.interestedUsers.filter((uid) => uid.toString() !== userId.toString())

    const teamCount = (project.teamMembers || []).length
    if (teamCount >= maxTeamMembers && project.status === 'planning') {
      if (!project.buildPhase) {
        project.buildPhase = {}
      }
      project.status = 'building'
      project.buildPhase.startDate = new Date()
      project.buildPhase.endDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      project.buildPhase.isActive = true
      project.buildPhase.lastActivity = new Date()
      project.buildPhase.totalDurationDays = 14
      project.buildPhase.isExtendedTimeline = false
      project.buildPhase.extensionCount = 0
      project.buildPhase.extensionDaysGranted = 0
    }
    const remainingInterested = [...project.interestedUsers]
    if (teamCount >= maxTeamMembers && remainingInterested.length > 0) {
      await Promise.all(
        remainingInterested.map((participantId) =>
          createNotification(
            participantId,
            'team_full',
            'Team Full',
            `${project.title} is now full.`,
            project._id,
            project.owner,
            false,
            `/project/${project._id}`
          )
        )
      )
      project.interestedUsers = []
    }

    await project.save()

    await applyUserStats(userId, {
      points: POINTS.join_project,
      inc: { projectsJoined: 1 }
    })

    await createNotification(
      userId,
      'join_accepted',
      'Welcome to the team',
      `You have been added to ${project.title}.`,
      project._id,
      project.owner,
      false,
      `/project/${project._id}`
    )

    const populated = await Project.findById(project._id)
      .populate('owner', 'name email')
      .populate('teamMembers', 'name email')
      .populate('interestedUsers', 'name email')
      .populate('messages.sender', 'name email')
      .populate('files.uploadedBy', 'name email')
      .populate('validation.sharedFiles.uploadedBy', 'name email')
      .populate('validation.reviews.reviewer', 'name')

    res.json({ message: 'Contributor added', project: populated })
  } catch (error) {
    console.error('Error adding team contributor:', error)
    res.status(500).json({ message: 'Failed to add team contributor' })
  }
}

exports.updateProjectRequirements = async (req, res) => {
  try {
    const { id } = req.params
    const requesterId = req.user?.userId
    const { rolesNeeded, skillsRequired, numberOfTeammates, visibility } = req.body

    if (!requesterId) {
      return res.status(401).json({ message: 'Unauthorized' })
    }

    const project = await Project.findById(id)
    if (!project) {
      return res.status(404).json({ message: 'Venture not found' })
    }

    if (project.owner.toString() !== requesterId.toString()) {
      return res.status(403).json({ message: 'Only the venture owner can update requirements' })
    }

    const nextTeamSize = Number.isFinite(Number(numberOfTeammates))
      ? parseInt(numberOfTeammates, 10)
      : project.numberOfTeammates

    const currentTeamCount = (project.teamMembers || []).length
    if (nextTeamSize < 1 || nextTeamSize > 10) {
      return res.status(400).json({ message: 'Team size must be between 1 and 10' })
    }

    if (nextTeamSize < currentTeamCount) {
      return res.status(400).json({ message: 'Team size cannot be less than current contributors' })
    }

    if (typeof numberOfTeammates !== 'undefined') {
      project.numberOfTeammates = nextTeamSize
    }
    if (typeof visibility === 'string') {
      if (!PROJECT_VISIBILITY.has(visibility)) {
        return res.status(400).json({ message: 'Visibility must be private, college, or global' })
      }
      project.visibility = visibility
    }
    if (typeof rolesNeeded !== 'undefined') {
      project.rolesNeeded = normalizeLabelList(rolesNeeded)
    }
    if (typeof skillsRequired !== 'undefined') {
      project.skillsRequired = normalizeLabelList(skillsRequired)
    }

    await project.save()

    const populated = await Project.findById(project._id)
      .populate('owner', 'name email')
      .populate('teamMembers', 'name email')
      .populate('interestedUsers', 'name email')

    res.json({ message: 'Venture requirements updated', project: populated })
  } catch (error) {
    console.error('Update venture requirements error:', error)
    res.status(500).json({ message: 'Failed to update venture requirements' })
  }
}

exports.updateProjectDetails = async (req, res) => {
  try {
    const { id } = req.params
    const requesterId = req.user?.userId
    const { title, shortPitch, description, tags, executionPlan } = req.body

    if (!requesterId) {
      return res.status(401).json({ message: 'Unauthorized' })
    }

    const project = await Project.findById(id)
    if (!project) {
      return res.status(404).json({ message: 'Venture not found' })
    }

    if (project.owner.toString() !== requesterId.toString()) {
      return res.status(403).json({ message: 'Only the venture owner can update details' })
    }

    if (typeof title === 'string') {
      const normalized = title.trim()
      if (!normalized) {
        return res.status(400).json({ message: 'Title cannot be empty' })
      }
      project.title = normalized
    }

    if (typeof shortPitch === 'string') {
      const normalized = shortPitch.trim()
      if (!normalized) {
        return res.status(400).json({ message: 'Short pitch cannot be empty' })
      }
      project.shortPitch = normalized
    }

    if (typeof description === 'string') {
      const normalized = description.trim()
      project.description = normalized || project.shortPitch || project.title
    }

    if (typeof executionPlan === 'string') {
      const normalized = executionPlan.trim()
      if (!normalized) {
        return res.status(400).json({ message: 'Execution plan cannot be empty' })
      }
      project.executionPlan = normalized
    }

    if (typeof tags !== 'undefined') {
      const normalizedTags = (Array.isArray(tags) ? tags : tags ? [tags] : [])
        .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
        .filter(Boolean)
      project.tags = normalizedTags
    }

    const updatedFingerprint = createIdeaFingerprint({
      title: project.title,
      shortPitch: project.shortPitch,
      description: project.description,
      executionPlan: project.executionPlan,
      category: project.category,
      ownerId: project.owner
    })
    project.security = {
      ...(project.security || {}),
      ideaFingerprint: updatedFingerprint,
      fingerprintAlgorithm: 'sha256',
      fingerprintVersion: 1,
      fingerprintedAt: new Date()
    }

    await project.save()

    const populated = await Project.findById(project._id)
      .populate('owner', 'name email')
      .populate('teamMembers', 'name email')
      .populate('interestedUsers', 'name email')

    res.json({ message: 'Venture details updated', project: populated })
  } catch (error) {
    console.error('Update venture details error:', error)
    res.status(500).json({ message: 'Failed to update venture details' })
  }
}

exports.updateValidationWorkspace = async (req, res) => {
  try {
    const { id } = req.params
    const requesterId = req.user?.userId
    const {
      problemStatement,
      targetUsers,
      coreAssumptions,
      validationTasks,
      validationEvidence,
      confidenceScore
    } = req.body

    if (!requesterId) {
      return res.status(401).json({ message: 'Unauthorized' })
    }

    const project = await Project.findById(id)
    if (!project) {
      return res.status(404).json({ message: 'Venture not found' })
    }

    const requesterIdString = requesterId.toString()
    const isOwner = toId(project.owner) === requesterIdString
    const isTeamMember = (project.teamMembers || []).some((memberId) => toId(memberId) === requesterIdString)
    if (!isOwner && !isTeamMember) {
      return res.status(403).json({ message: 'Only venture contributors can update validation workspace' })
    }

    if (!project.validation) {
      project.validation = {}
    }
    if (!project.validation.workspace) {
      project.validation.workspace = {}
    }

    if (typeof problemStatement !== 'undefined') {
      project.validation.workspace.problemStatement = normalizeLongText(problemStatement, 3000)
    }

    if (typeof targetUsers !== 'undefined') {
      project.validation.workspace.targetUsers = normalizeLongText(targetUsers, 3000)
    }

    if (typeof coreAssumptions !== 'undefined') {
      project.validation.workspace.coreAssumptions = normalizeValidationAssumptions(coreAssumptions)
    }

    if (typeof validationTasks !== 'undefined') {
      project.validation.workspace.tasks = normalizeValidationTasks(validationTasks)
    }

    if (typeof validationEvidence !== 'undefined') {
      project.validation.workspace.evidence = normalizeValidationEvidence(validationEvidence)
      project.validation.workspace.lastFeedbackAt = new Date()
    }

    if (typeof confidenceScore !== 'undefined') {
      const numeric = Number(confidenceScore)
      if (Number.isFinite(numeric)) {
        project.validation.workspace.confidenceScore = Math.max(0, Math.min(100, Math.round(numeric)))
      }
    }

    await project.save()

    const workspace = project.validation.workspace || {}
    const tasks = workspace.tasks || []
    const evidence = workspace.evidence || []
    const completedTasks = tasks.filter((task) => task.status === 'completed').length
    const pendingTasks = Math.max(0, tasks.length - completedTasks)

    const timeline = [
      ...tasks.map((task) => ({
        type: 'task',
        status: task.status,
        title: task.title,
        at: task.updatedAt || task.completedAt || task.dueDate || project.updatedAt
      })),
      ...evidence.map((item) => ({
        type: 'evidence',
        status: 'logged',
        title: item.title,
        at: item.createdAt || project.updatedAt
      }))
    ]
      .filter((entry) => entry.at)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 50)

    return res.json({
      message: 'Validation workspace updated',
      workspace,
      summary: {
        completedTasks,
        pendingTasks,
        totalTasks: tasks.length,
        confidenceScore: workspace.confidenceScore || 0,
        evidenceCount: evidence.length
      },
      timeline
    })
  } catch (error) {
    console.error('Update validation workspace error:', error)
    res.status(500).json({ message: 'Failed to update validation workspace' })
  }
}

exports.removeTeamMember = async (req, res) => {
  try {
    const { id } = req.params
    const requesterId = req.user?.userId || req.body.requesterId
    const { userId } = req.body

    if (!requesterId || !userId) {
      return res.status(400).json({ message: 'requesterId and userId are required' })
    }

    const project = await Project.findById(id)
    if (!project) {
      return res.status(404).json({ message: 'Venture not found' })
    }

    if (project.owner.toString() !== requesterId.toString()) {
      return res.status(403).json({ message: 'Only venture owner can remove team contributors' })
    }

    if (project.owner.toString() === userId.toString()) {
      return res.status(400).json({ message: 'Venture owner cannot be removed' })
    }

    const team = (project.teamMembers || []).map((uid) => uid.toString())
    if (!team.includes(userId.toString())) {
      return res.status(400).json({ message: 'User is not a team contributor' })
    }

    project.teamMembers = project.teamMembers.filter((uid) => uid.toString() !== userId.toString())
    await project.save()

    const populated = await Project.findById(project._id)
      .populate('owner', 'name email')
      .populate('teamMembers', 'name email')
      .populate('interestedUsers', 'name email')
      .populate('messages.sender', 'name email')
      .populate('files.uploadedBy', 'name email')
      .populate('validation.sharedFiles.uploadedBy', 'name email')
      .populate('validation.reviews.reviewer', 'name')

    res.json({ message: 'Contributor removed', project: populated })
  } catch (error) {
    console.error('Error removing team contributor:', error)
    res.status(500).json({ message: 'Failed to remove team contributor' })
  }
}

exports.addProjectMessage = async (req, res) => {
  try {
    const { id } = req.params
    const { text } = req.body
    const userId = req.user.userId

    if (!text || !text.trim()) {
      return res.status(400).json({ message: 'Message text is required' })
    }

    const project = await Project.findById(id)
    if (!project) {
      return res.status(404).json({ message: 'Venture not found' })
    }

    const userIdString = userId.toString()
    const team = (project.teamMembers || []).map((uid) => uid.toString())
    const isOwner = project.owner.toString() === userIdString

    if (!isOwner && !team.includes(userIdString)) {
      return res.status(403).json({ message: 'Only team contributors can build update messages' })
    }

    project.messages.push({ sender: userId, text: text.trim() })
    project.buildPhase.lastActivity = new Date()
    await project.save()

    const messageText = text.trim().toLowerCase()
    if (messageText.includes('@')) {
      const memberIds = [project.owner, ...(project.teamMembers || [])]
        .map((id) => id.toString())
        .filter((id) => id !== userIdString)
      if (memberIds.length > 0) {
        const members = await User.find({ _id: { $in: memberIds } }).select('name')
        const mentioned = members.filter((member) => {
          const name = (member.name || '').trim()
          if (!name) return false
          const parts = name.split(' ').filter(Boolean)
          const patterns = [name, parts[0]].filter(Boolean).map((n) => `@${n.toLowerCase()}`)
          return patterns.some((pattern) => messageText.includes(pattern))
        })

        await Promise.all(
          mentioned.map((member) =>
            createNotification(
              member._id,
              'mention',
              'You were mentioned',
              `You were mentioned in ${project.title}.`,
              project._id,
              userId,
              false,
              `/project/${project._id}`
            )
          )
        )
      }
    }

    const populated = await Project.findById(project._id)
      .populate('owner', 'name email')
      .populate('teamMembers', 'name email')
      .populate('interestedUsers', 'name email')
      .populate('messages.sender', 'name email')
      .populate('files.uploadedBy', 'name email')
      .populate('validation.sharedFiles.uploadedBy', 'name email')
      .populate('validation.reviews.reviewer', 'name')

    res.json({ message: 'Message added', project: populated })
  } catch (error) {
    console.error('Error adding message:', error)
    res.status(500).json({ message: 'Failed to add message' })
  }
}

exports.updateActivity = async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.user.userId

    const project = await Project.findById(id)
    if (!project) {
      return res.status(404).json({ message: 'Venture not found' })
    }

    const isTeamMember = isViewerTeamMember(project, userId.toString()) || toId(project.owner) === userId.toString()
    if (!isTeamMember) {
      return res.status(403).json({ message: 'Only team contributors can update activity' })
    }

    project.buildPhase.lastActivity = new Date()
    await project.save()

    res.json({ message: 'Activity updated' })
  } catch (error) {
    console.error('Update activity error:', error)
    res.status(500).json({ message: 'Failed to update activity' })
  }
}

exports.deleteProject = async (req, res) => {
  try {
    const { id } = req.params
    const requesterId = req.user?.userId

    const project = await Project.findById(id)
    if (!project) {
      return res.status(404).json({ message: 'Venture not found' })
    }

    if (!requesterId || project.owner.toString() !== requesterId.toString()) {
      return res.status(403).json({ message: 'Only the venture owner can delete this venture' })
    }

    const ownerId = project.owner.toString()
    const teamIds = (project.teamMembers || []).map((member) => member.toString())
    const uniqueUserIds = Array.from(new Set([ownerId, ...teamIds]))
    const shouldDeductComplete = ['completed', 'validated'].includes(project.status)

    for (const userId of uniqueUserIds) {
      const user = await User.findById(userId)
      if (!user) continue

      if (userId === ownerId) {
        user.points = (user.points || 0) - POINTS.create_project
        user.projectsCreated = Math.max(0, (user.projectsCreated || 0) - 1)
        if (shouldDeductComplete) {
          user.points -= POINTS.complete_project
          user.projectsCompleted = Math.max(0, (user.projectsCompleted || 0) - 1)
        }
      } else {
        user.points = (user.points || 0) - POINTS.join_project
        user.projectsJoined = Math.max(0, (user.projectsJoined || 0) - 1)
      }

      user.badges = computeBadges(user)
      await user.save()
    }

    await Project.deleteOne({ _id: id })

    res.json({ message: 'Venture deleted successfully' })
  } catch (error) {
    console.error('Delete venture error:', error)
    res.status(500).json({ message: 'Failed to delete venture' })
  }
}

exports.addProjectFile = async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.user.userId

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' })
    }

    const project = await Project.findById(id)
    if (!project) {
      return res.status(404).json({ message: 'Venture not found' })
    }

    const userIdString = userId.toString()
    const team = (project.teamMembers || []).map((uid) => uid.toString())
    const isOwner = project.owner.toString() === userIdString

    if (!isOwner && !team.includes(userIdString)) {
      return res.status(403).json({ message: 'Only team contributors can upload files' })
    }

    project.files.push({
      originalName: req.file.originalname,
      filename: req.file.filename,
      mimetype: req.file.mimetype,
      size: req.file.size,
      uploadedBy: userId
    })

    project.buildPhase.lastActivity = new Date()
    await project.save()

    const populated = await Project.findById(project._id)
      .populate('owner', 'name email')
      .populate('teamMembers', 'name email')
      .populate('interestedUsers', 'name email')
      .populate('messages.sender', 'name email')
      .populate('files.uploadedBy', 'name email')
      .populate('validation.sharedFiles.uploadedBy', 'name email')
      .populate('validation.reviews.reviewer', 'name')

    res.status(201).json({ message: 'File uploaded', project: populated })
  } catch (error) {
    console.error('Upload file error:', error)
    res.status(500).json({ message: 'Failed to upload file' })
  }
}

exports.deleteProjectFile = async (req, res) => {
  try {
    const { id, fileId } = req.params
    const userId = req.user.userId

    const project = await Project.findById(id)
    if (!project) {
      return res.status(404).json({ message: 'Venture not found' })
    }

    const userIdString = userId.toString()
    const team = (project.teamMembers || []).map((uid) => uid.toString())
    const isOwner = project.owner.toString() === userIdString

    if (!isOwner && !team.includes(userIdString)) {
      return res.status(403).json({ message: 'Only team contributors can remove files' })
    }

    const fileIndex = (project.files || []).findIndex(
      (file) => file._id?.toString() === fileId || file.filename === fileId
    )

    if (fileIndex === -1) {
      return res.status(404).json({ message: 'File not found' })
    }

    const file = project.files[fileIndex]
    const uploaderId = file.uploadedBy?.toString()
    if (!isOwner && uploaderId !== userIdString) {
      return res.status(403).json({ message: 'You can only remove files you uploaded' })
    }

    project.files.splice(fileIndex, 1)

    if (project.validation?.sharedFiles?.length) {
      project.validation.sharedFiles = project.validation.sharedFiles.filter(
        (shared) => shared.filename !== file.filename && shared._id?.toString() !== fileId
      )
    }

    project.buildPhase.lastActivity = new Date()
    await project.save()

    const filePath = path.join(__dirname, '..', 'uploads', file.filename)
    fs.unlink(filePath, () => {})

    const populated = await Project.findById(project._id)
      .populate('owner', 'name email')
      .populate('teamMembers', 'name email')
      .populate('interestedUsers', 'name email')
      .populate('messages.sender', 'name email')
      .populate('files.uploadedBy', 'name email')
      .populate('validation.sharedFiles.uploadedBy', 'name email')
      .populate('validation.reviews.reviewer', 'name')

    res.json({ message: 'File removed', project: populated })
  } catch (error) {
    console.error('Delete file error:', error)
    res.status(500).json({ message: 'Failed to remove file' })
  }
}

exports.downloadProjectFile = async (req, res) => {
  try {
    const { id, fileId } = req.params
    const { exp, sig } = req.query
    const viewerId = req.user?.userId ? req.user.userId.toString() : ''

    if (!viewerId) {
      return res.status(401).json({ message: 'Unauthorized' })
    }

    if (!verifyFileSignature({ projectId: id, fileId, userId: viewerId, expiresAt: exp, sig })) {
      logSecurityEvent('file_access_denied', req, {
        projectId: id,
        fileId,
        reason: 'invalid_signature'
      })
      return res.status(403).json({ message: 'File link expired or invalid. Refresh and try again.' })
    }

    const project = await Project.findById(id)
    if (!project) {
      return res.status(404).json({ message: 'Venture not found' })
    }

    const isOwner = toId(project.owner) === viewerId
    const isTeamMember = isViewerTeamMember(project, viewerId)
    const fileInProject = (project.files || []).find(
      (file) => toId(file._id) === fileId || file.filename === fileId
    )
    const fileInValidation = (project.validation?.sharedFiles || []).find(
      (file) => toId(file._id) === fileId || file.filename === fileId
    )
    const file = fileInProject || fileInValidation

    if (!file) {
      return res.status(404).json({ message: 'File not found' })
    }

    const validationVisible = ['validation', 'validated', 'validation_failed'].includes(project.status)
    const canAccessAsValidator = Boolean(fileInValidation && validationVisible)
    if (!isOwner && !isTeamMember && !canAccessAsValidator) {
      logSecurityEvent('file_access_denied', req, {
        projectId: id,
        fileId,
        reason: 'insufficient_access'
      })
      return res.status(403).json({ message: 'You do not have permission to access this file' })
    }

    const safeFilename = path.basename(file.filename || '')
    if (!safeFilename) {
      return res.status(404).json({ message: 'File not found' })
    }

    const absolutePath = path.join(__dirname, '..', 'uploads', safeFilename)
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ message: 'File missing on server' })
    }

    logSecurityEvent('file_download', req, {
      projectId: id,
      fileId,
      source: fileInProject ? 'project_files' : 'validation_shared_files'
    })

    res.download(absolutePath, file.originalName || safeFilename)
  } catch (error) {
    console.error('Download file error:', error)
    res.status(500).json({ message: 'Failed to download file' })
  }
}

exports.startBuildPhase = async (req, res) => {
  try {
    const { id } = req.params
    const requesterId = req.user?.userId

    const project = await Project.findById(id)
    if (!project) {
      return res.status(404).json({ message: 'Venture not found' })
    }

    if (!requesterId || project.owner.toString() !== requesterId.toString()) {
      return res.status(403).json({ message: 'Only the venture owner can start the build phase' })
    }

    project.status = 'building'
    project.buildPhase = {
      startDate: new Date(),
      endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      isActive: true,
      lastActivity: new Date(),
      lastPenaltyAt: project.buildPhase?.lastPenaltyAt,
      totalDurationDays: 14,
      isExtendedTimeline: false,
      extensionCount: 0,
      extensionDaysGranted: 0
    }

    await project.save()

    res.json({ message: 'Build phase started', project })
  } catch (error) {
    console.error('Start build phase error:', error)
    res.status(500).json({ message: 'Failed to start build phase' })
  }
}

exports.completeProject = async (req, res) => {
  try {
    const { id } = req.params
    const requesterId = req.user?.userId

    const project = await Project.findById(id)
    if (!project) {
      return res.status(404).json({ message: 'Venture not found' })
    }

    if (!requesterId || project.owner.toString() !== requesterId.toString()) {
      return res.status(403).json({ message: 'Only the venture owner can complete the venture' })
    }

    if (project.status === 'validated') {
      return res.status(400).json({ message: 'Venture is already validated' })
    }

    // Completion is now tied to successful validation.
    res.status(400).json({
      message: 'Ventures are marked complete only after passing validation. Use "Validate Venture" from Team Workspace.'
    })
  } catch (error) {
    console.error('Complete venture error:', error)
    res.status(500).json({ message: 'Failed to complete venture' })
  }
}

exports.startValidation = async (req, res) => {
  try {
    const { id } = req.params
    const requesterId = req.user?.userId
    const { demoLink, demoNotes, sharedFileIds } = req.body

    const project = await Project.findById(id)
    if (!project) {
      return res.status(404).json({ message: 'Venture not found' })
    }

    if (!requesterId || project.owner.toString() !== requesterId.toString()) {
      return res.status(403).json({ message: 'Only the venture owner can validate' })
    }

    const maxTeamMembers = project.numberOfTeammates || 0
    const teamCount = (project.teamMembers || []).length
    if (teamCount < maxTeamMembers) {
      return res.status(400).json({ message: 'Team is not full yet' })
    }

    const endDate = project.buildPhase?.endDate
    if (!endDate) {
      return res.status(400).json({ message: 'Build phase not started' })
    }

    if (new Date(endDate) < new Date()) {
      return res.status(400).json({ message: 'Time limit expired' })
    }

    if (project.status === 'validation' || project.status === 'validated') {
      return res.status(400).json({ message: 'Venture already in validation' })
    }

    if (project.status === 'validation_failed') {
      return res.status(400).json({
        message: 'This venture needs rework. Use the extend timeline option before sending it to validation again.'
      })
    }

    if (!['building', 'completed'].includes(project.status)) {
      return res.status(400).json({ message: 'Venture must be in build phase before validation' })
    }

    const previousStatus = project.status
    project.status = 'validation'
    project.buildPhase.isActive = false
    if (!project.validation) {
      project.validation = {}
    }
    project.validation.currentReviews = 0
    project.validation.averageRating = 0
    project.validation.criteriaAverages = {
      problemClarity: 0,
      userPainSeverity: 0,
      solutionFit: 0,
      innovation: 0,
      usefulness: 0,
      executionReadiness: 0,
      feasibility30Days: 0,
      evidenceStrength: 0,
      scalabilityPotential: 0,
      teamReadiness: 0,
      confidence: 0
    }
    project.validation.dimensionAverages = {
      desirability: 0,
      feasibility: 0,
      differentiation: 0,
      readiness: 0
    }
    project.validation.signalBreakdown = {
      wouldUse: { yes: 0, maybe: 0, no: 0 },
      verdict: { pass: 0, rework: 0, hold: 0 }
    }
    project.validation.reviews = []
    project.validation.validationStatus = 'pending'
    project.validation.validatedAt = undefined
    project.validation.featuredAt = undefined
    project.validation.lastFailureReason = undefined
    if (previousStatus === 'completed' && !project.validation.completionAwarded) {
      project.validation.completionAwarded = true
    }
    if (typeof demoLink === 'string') {
      project.validation.demoLink = demoLink.trim()
    }
    if (typeof demoNotes === 'string') {
      project.validation.demoNotes = demoNotes.trim()
    }

    const selectedIds = Array.isArray(sharedFileIds)
      ? sharedFileIds
      : sharedFileIds
        ? [sharedFileIds]
        : []
    if (selectedIds.length > 0) {
      const selected = (project.files || []).filter((file) =>
        selectedIds.includes(file._id?.toString()) || selectedIds.includes(file.filename)
      )
      project.validation.sharedFiles = selected
    } else if (Array.isArray(sharedFileIds)) {
      project.validation.sharedFiles = []
    }

    const memberIds = new Set([
      toId(project.owner),
      ...(project.teamMembers || []).map((member) => toId(member))
    ].filter(Boolean))

    const members = memberIds.size
      ? await User.find({ _id: { $in: [...memberIds] } }).select('name email')
      : []

    const certificates = await generateValidationCertificates({ project, members })
    project.validation.certificates = certificates

    await project.save()

    const apiBase = (process.env.PUBLIC_API_BASE || 'https://api.collab.qzz.io').replace(/\/$/, '')
    const certMap = new Map(certificates.map((cert) => [toId(cert.user), cert]))

    const emailResults = await Promise.allSettled(
      members.map(async (member) => {
        if (!member?.email) return
        const cert = certMap.get(toId(member._id))
        if (!cert) return
        const relativePath = cert.url.startsWith('/') ? cert.url.slice(1) : cert.url
        const filePath = path.join(__dirname, '..', relativePath)
        const verifyUrl = buildVerificationUrl(cert.certificateId)
        const downloadUrl = `${apiBase}${cert.url}`

        const subject = 'Your Collab Validation Phase Certificate'
        const text = `Hi ${member.name || 'there'},\n\nYour venture "${project.title}" has entered the Validation phase.\n\nDownload your certificate: ${downloadUrl}\nVerify: ${verifyUrl}\n\n— Collab`
        const html = `
          <div style="font-family: Arial, sans-serif; line-height:1.6;">
            <p>Hi ${member.name || 'there'},</p>
            <p>Your venture <strong>${project.title}</strong> has entered the <strong>Validation</strong> phase.</p>
            <p>You can download your certificate here:</p>
            <p><a href="${downloadUrl}">${downloadUrl}</a></p>
            <p>Verification link:</p>
            <p><a href="${verifyUrl}">${verifyUrl}</a></p>
            <p style="color:#6b7280;">— Collab</p>
          </div>
        `

        return sendEmail({
          to: member.email,
          subject,
          text,
          html,
          attachments: [{
            filename: cert.filename,
            path: filePath,
            contentType: 'application/pdf'
          }]
        })
      })
    )

    const failedEmails = emailResults.filter((result) => result.status === 'rejected').length

    res.json({
      message: 'Venture sent to validation',
      project,
      certificateEmails: {
        total: members.length,
        failed: failedEmails
      }
    })
  } catch (error) {
    console.error('Start validation error:', error)
    res.status(500).json({ message: 'Failed to send venture to validation' })
  }
}

exports.removeFromValidation = async (req, res) => {
  try {
    const { id } = req.params
    const requesterId = req.user?.userId

    const project = await Project.findById(id)
    if (!project) {
      return res.status(404).json({ message: 'Venture not found' })
    }

    if (!requesterId || project.owner.toString() !== requesterId.toString()) {
      return res.status(403).json({ message: 'Only the venture owner can update validation status' })
    }

    if (project.status !== 'validation') {
      return res.status(400).json({ message: 'Venture is not in validation' })
    }

    const now = Date.now()
    const existingEndDate = project.buildPhase?.endDate ? new Date(project.buildPhase.endDate).getTime() : 0
    const hasRemainingTime = existingEndDate > now

    project.status = 'building'
    if (!project.buildPhase) {
      project.buildPhase = {}
    }
    project.buildPhase.isActive = true
    project.buildPhase.lastActivity = new Date()
    project.buildPhase.totalDurationDays = project.buildPhase.totalDurationDays || 14
    project.buildPhase.extensionCount = project.buildPhase.extensionCount || 0
    project.buildPhase.extensionDaysGranted = project.buildPhase.extensionDaysGranted || 0
    project.buildPhase.isExtendedTimeline = Boolean(project.buildPhase.extensionDaysGranted > 0)

    if (!hasRemainingTime) {
      const extensionDays = 7
      project.buildPhase.startDate = new Date()
      project.buildPhase.endDate = new Date(Date.now() + extensionDays * 24 * 60 * 60 * 1000)
      project.buildPhase.extensionCount += 1
      project.buildPhase.extensionDaysGranted += extensionDays
      project.buildPhase.totalDurationDays = 14 + project.buildPhase.extensionDaysGranted
      project.buildPhase.isExtendedTimeline = true
    }

    if (!project.validation) {
      project.validation = {}
    }
    project.validation.currentReviews = 0
    project.validation.averageRating = 0
    project.validation.criteriaAverages = {
      problemClarity: 0,
      userPainSeverity: 0,
      solutionFit: 0,
      innovation: 0,
      usefulness: 0,
      executionReadiness: 0,
      feasibility30Days: 0,
      evidenceStrength: 0,
      scalabilityPotential: 0,
      teamReadiness: 0,
      confidence: 0
    }
    project.validation.dimensionAverages = {
      desirability: 0,
      feasibility: 0,
      differentiation: 0,
      readiness: 0
    }
    project.validation.signalBreakdown = {
      wouldUse: { yes: 0, maybe: 0, no: 0 },
      verdict: { pass: 0, rework: 0, hold: 0 }
    }
    project.validation.reviews = []
    project.validation.validationStatus = 'pending'
    project.validation.validatedAt = undefined
    project.validation.featuredAt = undefined
    project.validation.lastFailureReason = undefined

    await project.save()

    const populated = await Project.findById(project._id)
      .populate('owner', 'name email')
      .populate('teamMembers', 'name email')
      .populate('interestedUsers', 'name email')

    res.json({ message: 'Venture removed from validation', project: populated })
  } catch (error) {
    console.error('Remove validation error:', error)
    res.status(500).json({ message: 'Failed to remove venture from validation' })
  }
}

exports.extendValidationTimeline = async (req, res) => {
  try {
    const { id } = req.params
    const requesterId = req.user?.userId
    const extensionDays = 7

    const project = await Project.findById(id)
    if (!project) {
      return res.status(404).json({ message: 'Venture not found' })
    }

    if (!requesterId || project.owner.toString() !== requesterId.toString()) {
      return res.status(403).json({ message: 'Only the venture owner can extend the timeline' })
    }

    if (project.status !== 'validation_failed') {
      return res.status(400).json({ message: 'Timeline extension is available only after a failed validation' })
    }

    if (!project.buildPhase) {
      project.buildPhase = {}
    }

    project.status = 'building'
    project.buildPhase.startDate = new Date()
    project.buildPhase.endDate = new Date(Date.now() + extensionDays * 24 * 60 * 60 * 1000)
    project.buildPhase.isActive = true
    project.buildPhase.lastActivity = new Date()
    project.buildPhase.extensionCount = (project.buildPhase.extensionCount || 0) + 1
    project.buildPhase.extensionDaysGranted = (project.buildPhase.extensionDaysGranted || 0) + extensionDays
    project.buildPhase.totalDurationDays = 14 + project.buildPhase.extensionDaysGranted
    project.buildPhase.isExtendedTimeline = true

    if (!project.validation) {
      project.validation = {}
    }
    project.validation.validationStatus = 'pending'
    project.validation.currentReviews = 0
    project.validation.averageRating = 0
    project.validation.criteriaAverages = {
      problemClarity: 0,
      userPainSeverity: 0,
      solutionFit: 0,
      innovation: 0,
      usefulness: 0,
      executionReadiness: 0,
      feasibility30Days: 0,
      evidenceStrength: 0,
      scalabilityPotential: 0,
      teamReadiness: 0,
      confidence: 0
    }
    project.validation.dimensionAverages = {
      desirability: 0,
      feasibility: 0,
      differentiation: 0,
      readiness: 0
    }
    project.validation.signalBreakdown = {
      wouldUse: { yes: 0, maybe: 0, no: 0 },
      verdict: { pass: 0, rework: 0, hold: 0 }
    }
    project.validation.reviews = []
    project.validation.validatedAt = undefined
    project.validation.featuredAt = undefined

    await project.save()

    await createNotification(
      project.owner,
      'validation_feedback',
      'Timeline extended for rework',
      `${project.title} has been moved back to the build phase with a 7-day extension.`,
      project._id,
      requesterId,
      false,
      `/project/${project._id}`
    )

    const populated = await Project.findById(project._id)
      .populate('owner', 'name email')
      .populate('teamMembers', 'name email')
      .populate('interestedUsers', 'name email')

    res.json({
      message: 'Venture moved back to dashboard with a 7-day extension',
      project: populated
    })
  } catch (error) {
    console.error('Extend validation timeline error:', error)
    res.status(500).json({ message: 'Failed to extend venture timeline' })
  }
}

exports.submitReview = async (req, res) => {
  req.body.projectId = req.params.id
  return submitValidation(req, res)
}

exports.markReviewHelpful = async (req, res) => {
  try {
    const { id, reviewId } = req.params
    const requesterId = req.user?.userId

    const project = await Project.findById(id)
    if (!project) {
      return res.status(404).json({ message: 'Venture not found' })
    }

    if (!requesterId || project.owner.toString() !== requesterId.toString()) {
      return res.status(403).json({ message: 'Only the venture owner can mark feedback helpful' })
    }

    const reviews = project.validation?.reviews || []
    const review = reviews.id(reviewId)

    if (!review) {
      return res.status(404).json({ message: 'Review not found' })
    }

    if (review.helpful) {
      return res.status(400).json({ message: 'Feedback already marked helpful' })
    }

    review.helpful = true
    await project.save()

    await applyUserStats(review.reviewer, {
      points: POINTS.helpful_feedback,
      inc: { helpfulFeedback: 1 }
    })

    res.json({ message: 'Feedback marked helpful' })
  } catch (error) {
    console.error('Mark helpful error:', error)
    res.status(500).json({ message: 'Failed to mark feedback helpful' })
  }
}
