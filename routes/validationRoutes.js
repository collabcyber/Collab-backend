const express = require('express')
const router = express.Router()
const { submitValidation, listValidations } = require('../controllers/validationController')
const { z } = require('zod')
const validate = require('../middleware/validate')
const { project, paginationQuery } = require('../validators')

router.get('/', validate(z.object({ query: paginationQuery.passthrough() })), listValidations)
router.post('/', validate(project.validationSubmitBody), submitValidation)

module.exports = router
