const express = require('express')
const { z } = require('zod')
const validate = require('../middleware/validate')
const { checkpoint } = require('../validators')
const { submitCheckpoint, getProjectCheckpoints } = require('../controllers/checkpointController')

const router = express.Router()

router.post('/submit', validate(checkpoint.checkpointSubmitBody), submitCheckpoint)

router.get(
  '/:projectId',
  validate(z.object({ params: checkpoint.checkpointProjectParams })),
  getProjectCheckpoints
)

module.exports = router
