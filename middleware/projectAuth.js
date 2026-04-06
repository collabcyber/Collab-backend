const Project = require('../models/Project')

const toId = (value) => (value ? value.toString() : '')

const requireProjectOwner = async (req, res, next) => {
  const { id } = req.params
  const userId = req.user?.userId
  if (!id || !userId) {
    return res.status(401).json({ message: 'Unauthorized' })
  }

  const project = await Project.findById(id)
  if (!project) {
    return res.status(404).json({ message: 'Project not found' })
  }

  if (toId(project.owner) !== toId(userId)) {
    return res.status(403).json({ message: 'Only the project owner can perform this action' })
  }

  req.project = project
  return next()
}

const requireTeamMember = async (req, res, next) => {
  const { id } = req.params
  const userId = req.user?.userId
  if (!id || !userId) {
    return res.status(401).json({ message: 'Unauthorized' })
  }

  const project = await Project.findById(id)
  if (!project) {
    return res.status(404).json({ message: 'Project not found' })
  }

  const userIdString = toId(userId)
  const isOwner = toId(project.owner) === userIdString
  const isTeam = (project.teamMembers || []).some((member) => toId(member) === userIdString)
  if (!isOwner && !isTeam) {
    return res.status(403).json({ message: 'Only team members can perform this action' })
  }

  req.project = project
  return next()
}

module.exports = {
  requireProjectOwner,
  requireTeamMember
}
