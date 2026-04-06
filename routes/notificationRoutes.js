const express = require('express')
const router = express.Router()
const {
  getNotifications,
  markAsRead,
  markAllAsRead
} = require('../controllers/notificationController')
const { z } = require('zod')
const validate = require('../middleware/validate')
const { objectId, paginationQuery, emptyBody } = require('../validators')

router.get('/', validate(z.object({ query: paginationQuery.passthrough() })), getNotifications)
router.put('/:id/read', validate(z.object({ params: z.object({ id: objectId }) })), markAsRead)
router.put('/read-all', validate(emptyBody), markAllAsRead)

module.exports = router
