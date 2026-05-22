const express = require('express')
const path = require('path')
const fs = require('fs')
const multer = require('multer')
const router = express.Router()
const { z } = require('zod')
const {
  createProject,
  getProjects,
  getProjectById,
  addTeamMember,
  removeTeamMember,
  addProjectMessage,
  deleteProject,
  addProjectFile,
  downloadProjectFile,
  deleteProjectFile,
  startValidation,
  startBuildPhase,
  completeProject,
  updateActivity,
  getProjectOptions,
  updateProjectRequirements,
  updateProjectDetails,
  updateValidationWorkspace,
  removeFromValidation,
  extendValidationTimeline,
  getMilestones,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  getContributionLogs,
  createContributionLog,
  updateTeamCheckIn,
  getContinuationPlan,
  getIncubationPacket,
  applyContinuationAction
} = require('../controllers/projectController')
const validate = require('../middleware/validate')
const { requireProjectOwner, requireTeamMember } = require('../middleware/projectAuth')
const {
  project,
  objectId,
  projectsQuery,
  emptyBody,
  milestone,
  contribution,
  checkIn
} = require('../validators')

const uploadsDir = path.join(__dirname, '..', 'uploads')
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9-_]/g, '_')
    const unique = `${base}-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`
    cb(null, unique)
  }
})
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } })

// Basic CRUD
router.post('/', validate(project.createProjectBody), createProject)
router.get('/', validate(z.object({ query: projectsQuery })), getProjects)
router.get('/options', validate(emptyBody), getProjectOptions)
router.get('/:id', validate(z.object({ params: z.object({ id: objectId }) })), getProjectById)
router.delete('/:id', validate(z.object({ params: z.object({ id: objectId }) })), requireProjectOwner, deleteProject)
router.put('/:id/details', validate(z.object({ params: z.object({ id: objectId }), body: project.updateProjectDetailsBody })), requireProjectOwner, updateProjectDetails)
router.put('/:id/requirements', validate(z.object({ params: z.object({ id: objectId }), body: project.updateProjectRequirementsBody })), requireProjectOwner, updateProjectRequirements)
router.put('/:id/validation/workspace', validate(z.object({ params: z.object({ id: objectId }), body: project.updateValidationWorkspaceBody })), requireTeamMember, updateValidationWorkspace)
router.post('/:id/validate', validate(z.object({ params: z.object({ id: objectId }), body: project.startValidationBody })), requireProjectOwner, startValidation)
router.post('/:id/validation/remove', validate(z.object({ params: z.object({ id: objectId }) })), requireProjectOwner, removeFromValidation)
router.post('/:id/validation/extend', validate(z.object({ params: z.object({ id: objectId }), body: project.retryValidationBody })), requireProjectOwner, extendValidationTimeline)
router.post('/:id/start-build', validate(z.object({ params: z.object({ id: objectId }) })), requireProjectOwner, startBuildPhase)
router.post('/:id/complete', validate(z.object({ params: z.object({ id: objectId }) })), requireProjectOwner, completeProject)
router.post('/:id/update-activity', validate(z.object({ params: z.object({ id: objectId }) })), requireTeamMember, updateActivity)
router.patch('/:id/team-checkin', validate(z.object({ params: z.object({ id: objectId }), body: checkIn.checkInBody })), requireTeamMember, updateTeamCheckIn)
router.get('/:id/continuation', validate(z.object({ params: z.object({ id: objectId }) })), requireTeamMember, getContinuationPlan)
router.post('/:id/continuation', validate(z.object({ params: z.object({ id: objectId }), body: checkIn.continuationBody })), requireTeamMember, applyContinuationAction)
router.get('/:id/incubation-packet', validate(z.object({ params: z.object({ id: objectId }) })), requireTeamMember, getIncubationPacket)

// Team Management
router.post('/:id/add-member', validate(z.object({ params: z.object({ id: objectId }), body: project.addMemberBody })), requireProjectOwner, addTeamMember)
router.post('/:id/remove-member', validate(z.object({ params: z.object({ id: objectId }), body: project.removeMemberBody })), requireProjectOwner, removeTeamMember)
router.post('/:id/messages', validate(z.object({ params: z.object({ id: objectId }), body: project.messageBody })), requireTeamMember, addProjectMessage)
router.post('/:id/files', validate(z.object({ params: z.object({ id: objectId }) })), requireTeamMember, upload.single('file'), addProjectFile)
router.get('/:id/files/:fileId/download', validate(z.object({
  params: z.object({ id: objectId, fileId: z.string().min(1) }),
  query: z.object({
    exp: z.string().min(1),
    sig: z.string().min(16)
  })
})), downloadProjectFile)
router.delete('/:id/files/:fileId', validate(z.object({ params: z.object({ id: objectId, fileId: z.string() }) })), requireTeamMember, deleteProjectFile)

// Milestones & execution logs
router.get('/:id/milestones', validate(z.object({ params: z.object({ id: objectId }) })), requireTeamMember, getMilestones)
router.post('/:id/milestones', validate(z.object({ params: z.object({ id: objectId }), body: milestone.milestoneCreateBody })), requireTeamMember, createMilestone)
router.patch('/:id/milestones/:milestoneId', validate(z.object({ params: milestone.milestoneParams, body: milestone.milestoneUpdateBody })), requireTeamMember, updateMilestone)
router.delete('/:id/milestones/:milestoneId', validate(z.object({ params: milestone.milestoneParams })), requireProjectOwner, deleteMilestone)
router.get('/:id/contribution-logs', validate(z.object({ params: z.object({ id: objectId }) })), requireTeamMember, getContributionLogs)
router.post('/:id/contribution-logs', validate(z.object({ params: z.object({ id: objectId }), body: contribution.contributionCreateBody })), requireTeamMember, createContributionLog)

module.exports = router
