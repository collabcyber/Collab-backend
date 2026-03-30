const express = require('express')
const path = require('path')
const fs = require('fs')
const multer = require('multer')
const router = express.Router()
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
router.post('/', createProject)
router.get('/', getProjects)
router.get('/options', getProjectOptions)
router.get('/validation', getValidationProjects)
router.get('/:id', getProjectById)
router.delete('/:id', deleteProject)
router.put('/:id/details', updateProjectDetails)
router.put('/:id/requirements', updateProjectRequirements)
router.post('/:id/validate', startValidation)
router.post('/:id/validation/remove', removeFromValidation)
router.post('/:id/start-build', startBuildPhase)
router.post('/:id/complete', completeProject)
router.post('/:id/update-activity', updateActivity)

// Team Management
router.post('/:id/join', joinProject)
router.post('/:id/interest', joinProject)
router.post('/:id/respond', respondToJoinRequest)
router.post('/:id/add-member', addTeamMember)
router.post('/:id/remove-member', removeTeamMember)
router.post('/:id/messages', addProjectMessage)
router.post('/:id/files', upload.single('file'), addProjectFile)
router.delete('/:id/files/:fileId', deleteProjectFile)

// Validation feedback
router.post('/:id/review', submitReview)
router.put('/:id/reviews/:reviewId/helpful', markReviewHelpful)

module.exports = router
