const express = require('express')
const router = express.Router()
const { getPublicStats } = require('../controllers/publicController')
const validate = require('../middleware/validate')
const { emptyBody } = require('../validators')

router.get('/stats', validate(emptyBody), getPublicStats)

module.exports = router
