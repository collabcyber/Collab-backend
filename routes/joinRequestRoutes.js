const express = require('express')
const router = express.Router()
const { requestToJoin } = require('../controllers/joinRequestController')
const validate = require('../middleware/validate')
const { emptyBody } = require('../validators')

router.post('/', validate(emptyBody), requestToJoin)

module.exports = router
