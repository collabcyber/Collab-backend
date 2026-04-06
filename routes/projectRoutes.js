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
  joinProject,
  respondToJoinRequest,
  addTeamMember,
  removeTeamMember,
  addProjectMessage,
  deleteProject,
  addProjectFile,
  deleteProjectFile,
  startValidation,
  startBuildPhase,
  completeProject,
  updateActivity,
  submitReview,
  markReviewHelpful,
  getValidationProjects,
  getProjectOptions,
  updateProjectRequirements,
  updateProjectDetails,
  removeFromValidation
} = require('../controllers/projectController')
const validate = require('../middleware/validate')
const { requireProjectOwner, requireTeamMember } = require('../middleware/projectAuth')
const { project, objectId, projectsQuery, paginationQuery, emptyBody } = require('../validators')

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
router.get('/validation', validate(z.object({ query: paginationQuery.passthrough() })), getValidationProjects)
router.get('/:id', validate(z.object({ params: z.object({ id: objectId }) })), getProjectById)
router.delete('/:id', validate(z.object({ params: z.object({ id: objectId }) })), requireProjectOwner, deleteProject)
router.put('/:id/details', validate(z.object({ params: z.object({ id: objectId }), body: project.updateProjectDetailsBody })), requireProjectOwner, updateProjectDetails)
router.put('/:id/requirements', validate(z.object({ params: z.object({ id: objectId }), body: project.updateProjectRequirementsBody })), requireProjectOwner, updateProjectRequirements)
router.post('/:id/validate', validate(z.object({ params: z.object({ id: objectId }), body: project.startValidationBody })), requireProjectOwner, startValidation)
router.post('/:id/validation/remove', validate(z.object({ params: z.object({ id: objectId }) })), requireProjectOwner, removeFromValidation)
router.post('/:id/start-build', validate(z.object({ params: z.object({ id: objectId }) })), requireProjectOwner, startBuildPhase)
router.post('/:id/complete', validate(z.object({ params: z.object({ id: objectId }) })), requireProjectOwner, completeProject)
router.post('/:id/update-activity', validate(z.object({ params: z.object({ id: objectId }) })), requireTeamMember, updateActivity)

// Team Management
router.post('/:id/join', validate(z.object({ params: z.object({ id: objectId }), body: project.joinRequestBody })), joinProject)
router.post('/:id/interest', validate(z.object({ params: z.object({ id: objectId }), body: project.joinRequestBody })), joinProject)
router.post('/:id/respond', validate(z.object({ params: z.object({ id: objectId }), body: project.respondRequestBody })), requireProjectOwner, respondToJoinRequest)
router.post('/:id/add-member', validate(z.object({ params: z.object({ id: objectId }), body: project.addMemberBody })), requireProjectOwner, addTeamMember)
router.post('/:id/remove-member', validate(z.object({ params: z.object({ id: objectId }), body: project.removeMemberBody })), requireProjectOwner, removeTeamMember)
router.post('/:id/messages', validate(z.object({ params: z.object({ id: objectId }), body: project.messageBody })), requireTeamMember, addProjectMessage)
router.post('/:id/files', validate(z.object({ params: z.object({ id: objectId }) })), requireTeamMember, upload.single('file'), addProjectFile)
router.delete('/:id/files/:fileId', validate(z.object({ params: z.object({ id: objectId, fileId: z.string() }) })), requireTeamMember, deleteProjectFile)

// Validation feedback
router.post('/:id/review', validate(z.object({ params: z.object({ id: objectId }), body: project.validationSubmitBody })), submitReview)
router.put('/:id/reviews/:reviewId/helpful', validate(z.object({ params: z.object({ id: objectId, reviewId: objectId }) })), requireProjectOwner, markReviewHelpful)

module.exports = router
