const express = require('express')
const { z } = require('zod')
const validate = require('../middleware/validate')
const { objectId } = require('../validators')
const { getProjectProof } = require('../controllers/projectController')

const router = express.Router()

router.get(
  '/:id/proof',
  validate(z.object({ params: z.object({ id: objectId }) })),
  getProjectProof
)

module.exports = router
