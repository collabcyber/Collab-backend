const fs = require('fs')
const path = require('path')
const Project = require('../models/Project')
const User = require('../models/User')
const { createNotification } = require('./notificationController')
const { applyUserStats, POINTS, computeBadges } = require('../utils/points')
const { submitValidation } = require('./validationController')

const toId = (value) => (value ? value.toString() : '')

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

  if (!isOwner) {
    project.interestedUsers = []
  }

  if (!isOwner && !isTeamMember) {
    project.teamMembers = (project.teamMembers || []).map((member) => ({
      _id: member._id,
      name: member.name || 'Member'
    }))
    project.files = []
    project.messages = []
    if (project.owner) {
      const ownerId = project.owner._id || project.owner
      project.owner = {
        _id: ownerId,
        name: project.owner.name || 'Owner'
      }
    }
  }

  if (!isOwner && !isTeamMember && project.validation?.reviews) {
    project.validation.reviews = []
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

    const project = new Project({
      title: normalizedTitle,
      shortPitch: normalizedShortPitch,
      description: normalizedDescription,
      category: normalizedCategory,
      tags: (Array.isArray(tags) ? tags : tags ? [tags] : []).filter(Boolean),
      rolesNeeded: normalizedRoles,
      skillsRequired: normalizedSkills,
      numberOfTeammates: Math.min(10, Math.max(1, parseInt(numberOfTeammates, 10) || 1)),
      visibility: visibility || 'college',
      college: owner?.college || owner?.college_id || undefined,
      executionPlan: normalizedExecutionPlan,
      owner: userId,
      teamMembers: [userId],
      status: 'planning',
      buildPhase: {
        startDate: new Date(),
        endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        isActive: true,
        lastActivity: new Date()
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
      message: 'Project created successfully',
      project: populatedProject
    })
  } catch (error) {
    console.error('Create project error:', error)
    res.status(500).json({ message: 'Failed to create project' })
  }
}

exports.getProjects = async (req, res) => {
  try {
    const { college, category, skills, status, roles } = req.query
    const filter = {}
    const viewer = await User.findById(req.user.userId).select('college college_id')
    const viewerCollege = (viewer?.college || viewer?.college_id) ? (viewer.college || viewer.college_id).toString() : null

    if (viewerCollege) {
      filter.$or = [
        { visibility: 'global' },
        { visibility: 'college', college: viewerCollege }
      ]
    } else {
      filter.visibility = 'global'
    }
    if (status && status !== 'all') {
      filter.status = status
    } else {
      filter.status = { $ne: 'archived' }
    }

    if (college && college !== 'all') {
      filter.college = college
    }

    if (category && category !== 'all') {
      filter.category = category
    }

    if (skills) {
      const skillsArray = Array.isArray(skills)
        ? skills
        : skills.split(',').map((skill) => skill.trim()).filter(Boolean)
      if (skillsArray.length > 0) {
        filter.skillsRequired = { $in: normalizeLabelList(skillsArray) }
      }
    }

    if (roles) {
      const rolesArray = Array.isArray(roles)
        ? roles
        : roles.split(',').map((role) => role.trim()).filter(Boolean)
      if (rolesArray.length > 0) {
        filter.rolesNeeded = { $in: normalizeLabelList(rolesArray) }
      }
    }

    const projects = await Project.find(filter)
      .populate('owner', 'name')
      .populate('college', 'name type')
      .sort({ createdAt: -1 })

    res.json({ projects })
  } catch (error) {
    console.error('Get projects error:', error)
    res.status(500).json({ message: 'Failed to fetch projects' })
  }
}

exports.getValidationProjects = async (req, res) => {
  try {
    const projects = await Project.find({ status: 'validation' })
      .populate('owner', 'name')
      .sort({ updatedAt: -1 })

    res.json({ projects })
  } catch (error) {
    console.error('Get validation projects error:', error)
    res.status(500).json({ message: 'Failed to fetch validation projects' })
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
    console.error('Get project options error:', error)
    res.status(500).json({ message: 'Failed to fetch project options' })
  }
}

exports.getProjectById = async (req, res) => {
  try {
    const { id } = req.params
    const viewerId = req.user?.userId ? req.user.userId.toString() : ''

    const project = await Project.findById(id)
      .populate('owner', 'name email phone lastActive')
      .populate('teamMembers', 'name email phone lastActive')
      .populate('interestedUsers', 'name email phone lastActive')
      .populate('messages.sender', 'name email')
      .populate('files.uploadedBy', 'name email')
      .populate('validation.sharedFiles.uploadedBy', 'name email')
      .populate('validation.reviews.reviewer', 'name')

    if (!project) {
      return res.status(404).json({ message: 'Project not found' })
    }

    const isOwner = toId(project.owner?._id) === viewerId
    const isTeamMember = isViewerTeamMember(project, viewerId) || isOwner

    if (project.visibility === 'college' && !isOwner && !isTeamMember) {
      const viewer = await User.findById(viewerId).select('college college_id')
      const viewerCollege = (viewer?.college || viewer?.college_id) ? (viewer.college || viewer.college_id).toString() : null
      const projectCollege = project.college ? project.college.toString() : null
      if (viewerCollege && projectCollege && viewerCollege !== projectCollege) {
        return res.status(403).json({ message: 'This project is visible to its college only' })
      }
    }

    if (isTeamMember) {
      await maybeApplyInactivityPenalty(project)
    }

    const sanitized = sanitizeProjectForViewer(project, viewerId)

    res.json(sanitized)
  } catch (error) {
    console.error('Get project error:', error)
    res.status(500).json({ message: 'Failed to fetch project' })
  }
}

exports.joinProject = async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.user.userId

    const project = await Project.findById(id)
    if (!project) {
      return res.status(404).json({ message: 'Project not found' })
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
      return res.status(400).json({ message: 'Owner cannot join their own project' })
    }

    if (team.includes(userIdString)) {
      return res.status(400).json({ message: 'Already a team member' })
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
    console.error('Join project error:', error)
    res.status(500).json({ message: 'Failed to join project' })
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
      return res.status(404).json({ message: 'Project not found' })
    }

    if (project.owner.toString() !== requesterId.toString()) {
      return res.status(403).json({ message: 'Only project owner can respond to requests' })
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
      return res.status(404).json({ message: 'Project not found' })
    }

    const maxTeamMembers = project.numberOfTeammates || 0
    const currentTeamCount = (project.teamMembers || []).length

    if (currentTeamCount >= maxTeamMembers) {
      return res.status(400).json({ message: 'Team is full' })
    }

    if (project.owner.toString() !== requesterId.toString()) {
      return res.status(403).json({ message: 'Only project owner can add team members' })
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

    res.json({ message: 'Member added', project: populated })
  } catch (error) {
    console.error('Error adding team member:', error)
    res.status(500).json({ message: 'Failed to add team member' })
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
      return res.status(404).json({ message: 'Project not found' })
    }

    if (project.owner.toString() !== requesterId.toString()) {
      return res.status(403).json({ message: 'Only the project owner can update requirements' })
    }

    const nextTeamSize = Number.isFinite(Number(numberOfTeammates))
      ? parseInt(numberOfTeammates, 10)
      : project.numberOfTeammates

    const currentTeamCount = (project.teamMembers || []).length
    if (nextTeamSize < 1 || nextTeamSize > 10) {
      return res.status(400).json({ message: 'Team size must be between 1 and 10' })
    }

    if (nextTeamSize < currentTeamCount) {
      return res.status(400).json({ message: 'Team size cannot be less than current members' })
    }

    if (typeof numberOfTeammates !== 'undefined') {
      project.numberOfTeammates = nextTeamSize
    }
    if (typeof visibility === 'string' && ['college', 'global'].includes(visibility)) {
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

    res.json({ message: 'Project requirements updated', project: populated })
  } catch (error) {
    console.error('Update project requirements error:', error)
    res.status(500).json({ message: 'Failed to update project requirements' })
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
      return res.status(404).json({ message: 'Project not found' })
    }

    if (project.owner.toString() !== requesterId.toString()) {
      return res.status(403).json({ message: 'Only the project owner can update details' })
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

    await project.save()

    const populated = await Project.findById(project._id)
      .populate('owner', 'name email')
      .populate('teamMembers', 'name email')
      .populate('interestedUsers', 'name email')

    res.json({ message: 'Project details updated', project: populated })
  } catch (error) {
    console.error('Update project details error:', error)
    res.status(500).json({ message: 'Failed to update project details' })
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
      return res.status(404).json({ message: 'Project not found' })
    }

    if (project.owner.toString() !== requesterId.toString()) {
      return res.status(403).json({ message: 'Only project owner can remove team members' })
    }

    if (project.owner.toString() === userId.toString()) {
      return res.status(400).json({ message: 'Project owner cannot be removed' })
    }

    const team = (project.teamMembers || []).map((uid) => uid.toString())
    if (!team.includes(userId.toString())) {
      return res.status(400).json({ message: 'User is not a team member' })
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

    res.json({ message: 'Member removed', project: populated })
  } catch (error) {
    console.error('Error removing team member:', error)
    res.status(500).json({ message: 'Failed to remove team member' })
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
      return res.status(404).json({ message: 'Project not found' })
    }

    const userIdString = userId.toString()
    const team = (project.teamMembers || []).map((uid) => uid.toString())
    const isOwner = project.owner.toString() === userIdString

    if (!isOwner && !team.includes(userIdString)) {
      return res.status(403).json({ message: 'Only team members can post messages' })
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
      return res.status(404).json({ message: 'Project not found' })
    }

    const isTeamMember = isViewerTeamMember(project, userId.toString()) || toId(project.owner) === userId.toString()
    if (!isTeamMember) {
      return res.status(403).json({ message: 'Only team members can update activity' })
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
      return res.status(404).json({ message: 'Project not found' })
    }

    if (!requesterId || project.owner.toString() !== requesterId.toString()) {
      return res.status(403).json({ message: 'Only the project owner can delete this project' })
    }

    const ownerId = project.owner.toString()
    const teamIds = (project.teamMembers || []).map((member) => member.toString())
    const uniqueUserIds = Array.from(new Set([ownerId, ...teamIds]))
    const shouldDeductComplete = ['completed', 'validation', 'validated', 'archived'].includes(project.status)

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

    res.json({ message: 'Project deleted successfully' })
  } catch (error) {
    console.error('Delete project error:', error)
    res.status(500).json({ message: 'Failed to delete project' })
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
      return res.status(404).json({ message: 'Project not found' })
    }

    const userIdString = userId.toString()
    const team = (project.teamMembers || []).map((uid) => uid.toString())
    const isOwner = project.owner.toString() === userIdString

    if (!isOwner && !team.includes(userIdString)) {
      return res.status(403).json({ message: 'Only team members can upload files' })
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
      return res.status(404).json({ message: 'Project not found' })
    }

    const userIdString = userId.toString()
    const team = (project.teamMembers || []).map((uid) => uid.toString())
    const isOwner = project.owner.toString() === userIdString

    if (!isOwner && !team.includes(userIdString)) {
      return res.status(403).json({ message: 'Only team members can remove files' })
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

exports.startBuildPhase = async (req, res) => {
  try {
    const { id } = req.params
    const requesterId = req.user?.userId

    const project = await Project.findById(id)
    if (!project) {
      return res.status(404).json({ message: 'Project not found' })
    }

    if (!requesterId || project.owner.toString() !== requesterId.toString()) {
      return res.status(403).json({ message: 'Only the project owner can start the build phase' })
    }

    project.status = 'building'
    project.buildPhase = {
      startDate: new Date(),
      endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      isActive: true,
      lastActivity: new Date(),
      lastPenaltyAt: project.buildPhase?.lastPenaltyAt
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
      return res.status(404).json({ message: 'Project not found' })
    }

    if (!requesterId || project.owner.toString() !== requesterId.toString()) {
      return res.status(403).json({ message: 'Only the project owner can complete the project' })
    }

    if (project.status === 'completed' || project.status === 'validation' || project.status === 'validated') {
      return res.status(400).json({ message: 'Project already completed' })
    }

    project.status = 'completed'
    project.buildPhase.isActive = false

    await project.save()

    await applyUserStats(project.owner, {
      points: POINTS.complete_project,
      inc: { projectsCompleted: 1 }
    })

    res.json({ message: 'Project marked as completed', project })
  } catch (error) {
    console.error('Complete project error:', error)
    res.status(500).json({ message: 'Failed to complete project' })
  }
}

exports.startValidation = async (req, res) => {
  try {
    const { id } = req.params
    const requesterId = req.user?.userId
    const { demoLink, demoNotes, sharedFileIds } = req.body

    const project = await Project.findById(id)
    if (!project) {
      return res.status(404).json({ message: 'Project not found' })
    }

    if (!requesterId || project.owner.toString() !== requesterId.toString()) {
      return res.status(403).json({ message: 'Only the project owner can validate' })
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
      return res.status(400).json({ message: 'Project already in validation' })
    }

    if (project.status !== 'completed') {
      await applyUserStats(project.owner, {
        points: POINTS.complete_project,
        inc: { projectsCompleted: 1 }
      })
    }

    project.status = 'validation'
    project.buildPhase.isActive = false
    if (!project.validation) {
      project.validation = {}
    }
    project.validation.validationStatus = 'pending'
    project.validation.demoLink = demoLink ? demoLink.trim() : project.validation.demoLink
    project.validation.demoNotes = demoNotes ? demoNotes.trim() : project.validation.demoNotes

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
    }

    await project.save()

    res.json({ message: 'Project sent to validation', project })
  } catch (error) {
    console.error('Start validation error:', error)
    res.status(500).json({ message: 'Failed to send project to validation' })
  }
}

exports.removeFromValidation = async (req, res) => {
  try {
    const { id } = req.params
    const requesterId = req.user?.userId

    const project = await Project.findById(id)
    if (!project) {
      return res.status(404).json({ message: 'Project not found' })
    }

    if (!requesterId || project.owner.toString() !== requesterId.toString()) {
      return res.status(403).json({ message: 'Only the project owner can update validation status' })
    }

    if (project.status !== 'validation') {
      return res.status(400).json({ message: 'Project is not in validation' })
    }

    project.status = 'completed'
    project.buildPhase.isActive = false
    if (!project.validation) {
      project.validation = {}
    }
    project.validation.currentReviews = 0
    project.validation.averageRating = 0
    project.validation.reviews = []
    project.validation.validationStatus = 'pending'
    project.validation.validatedAt = undefined
    project.validation.featuredAt = undefined

    await project.save()

    const populated = await Project.findById(project._id)
      .populate('owner', 'name email')
      .populate('teamMembers', 'name email')
      .populate('interestedUsers', 'name email')

    res.json({ message: 'Project removed from validation', project: populated })
  } catch (error) {
    console.error('Remove validation error:', error)
    res.status(500).json({ message: 'Failed to remove project from validation' })
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
      return res.status(404).json({ message: 'Project not found' })
    }

    if (!requesterId || project.owner.toString() !== requesterId.toString()) {
      return res.status(403).json({ message: 'Only the project owner can mark feedback helpful' })
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
