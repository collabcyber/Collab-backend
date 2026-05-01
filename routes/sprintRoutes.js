const express = require('express')
const router = express.Router()
const { z } = require('zod')
const validate = require('../middleware/validate')
const { objectId, sprint } = require('../validators')
const { requireRole } = require('../middleware/rbac')
const { applyForSprint, updateSprintStatus } = require('../controllers/sprintController')

router.post('/apply', validate(sprint.sprintApplyBody), applyForSprint)

router.patch(
  '/status/:userId',
  requireRole('admin'),
  validate(
    z.object({
      params: z.object({ userId: objectId }),
      body: sprint.sprintStatusUpdateBody
    })
  ),
  updateSprintStatus
)

module.exports = router
