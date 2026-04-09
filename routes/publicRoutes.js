const express = require('express')
const router = express.Router()
const { getPublicStats, getCertificate } = require('../controllers/publicController')
const validate = require('../middleware/validate')
const { emptyBody } = require('../validators')

router.get('/stats', validate(emptyBody), getPublicStats)
router.get('/certificates/:certificateId', validate(emptyBody), getCertificate)

module.exports = router
