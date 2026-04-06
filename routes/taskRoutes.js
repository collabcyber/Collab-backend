const express = require('express')
const router = express.Router()
const { createTask } = require('../controllers/taskController')
const validate = require('../middleware/validate')
const { emptyBody } = require('../validators')

router.post('/', validate(emptyBody), createTask)

module.exports = router
