const User = require('../models/User')

const checkSprintActive = async (req, res, next) => {
  try {
    const userId = req.user?.userId
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' })
    }

    const user = await User.findById(userId).select('sprintStatus')
    if (!user) {
      return res.status(401).json({ message: 'User not found' })
    }

    if (user.sprintStatus !== 'active') {
      return res.status(403).json({ message: 'You must join an active sprint to create a project' })
    }

    return next()
  } catch (error) {
    return next(error)
  }
}

module.exports = { checkSprintActive }
