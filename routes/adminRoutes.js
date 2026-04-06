const express = require('express')
const router = express.Router()
const { adminStats } = require('../controllers/adminController')
const validate = require('../middleware/validate')
const { requireRole } = require('../middleware/rbac')
const { emptyBody } = require('../validators')

router.get('/stats', requireRole('admin'), validate(emptyBody), adminStats)

module.exports = router
