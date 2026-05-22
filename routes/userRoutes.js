const express = require('express')
const router = express.Router()
const { z } = require('zod')
const {
  getProfile,
  updateProfile,
  changePassword,
  getLeaderboard,
  getRank,
  getExecutionProfile,
  getUserProjects,
  getAllUsers,
  getUserActivity,
  getAdminStats,
  getUserById,
  createUserByAdmin,
  updateUserByAdmin,
  deleteUserByAdmin
} = require('../controllers/userController')
const validate = require('../middleware/validate')
const { requireRole } = require('../middleware/rbac')
const { user, objectId, userProjectsQuery, leaderboardQuery, activityQuery, paginationQuery, emptyBody } = require('../validators')

router.get('/me', validate(emptyBody), getProfile)
router.put('/me', validate(user.updateProfileBody), updateProfile)
router.put('/change-password', validate(user.changePasswordBody), changePassword)
router.get('/leaderboard', validate(z.object({ query: leaderboardQuery })), getLeaderboard)
router.get('/rank', validate(emptyBody), getRank)
router.get('/execution-profile', validate(emptyBody), getExecutionProfile)
router.get('/projects', validate(z.object({ query: userProjectsQuery })), getUserProjects)
router.get('/all', requireRole('admin'), validate(z.object({ query: paginationQuery.passthrough() })), getAllUsers)
router.get('/activity', requireRole('admin'), validate(z.object({ query: activityQuery })), getUserActivity)
router.get('/admin-stats', requireRole('admin'), validate(emptyBody), getAdminStats)
router.get('/:id', requireRole('admin'), validate(z.object({ params: z.object({ id: objectId }) })), getUserById)
router.post('/', requireRole('admin'), validate(user.adminCreateUserBody), createUserByAdmin)
router.patch('/:id', requireRole('admin'), validate(z.object({ params: z.object({ id: objectId }), body: user.adminUpdateUserBody })), updateUserByAdmin)
router.delete('/:id', requireRole('admin'), validate(z.object({ params: z.object({ id: objectId }) })), deleteUserByAdmin)

module.exports = router
