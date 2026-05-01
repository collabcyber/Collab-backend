const User = require('../models/User')

exports.applyForSprint = async (req, res, next) => {
  try {
    const userId = req.user?.userId
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' })
    }

    const user = await User.findById(userId).select('sprintStatus')
    if (!user) {
      return res.status(401).json({ message: 'User not found' })
    }

    const currentSprintStatus = user.sprintStatus || 'none'

    if (currentSprintStatus !== 'none') {
      return res.status(409).json({
        message: 'Sprint application already exists for this account',
        sprintStatus: currentSprintStatus
      })
    }

    user.sprintStatus = 'applied'
    await user.save()

    return res.status(200).json({
      message: 'Sprint application submitted successfully',
      sprintStatus: user.sprintStatus
    })
  } catch (error) {
    return next(error)
  }
}

exports.updateSprintStatus = async (req, res, next) => {
  try {
    const { userId } = req.params
    const requestedStatus = req.body?.status || 'active'

    const user = await User.findById(userId).select('name email sprintStatus')
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    user.sprintStatus = requestedStatus
    await user.save()

    return res.status(200).json({
      message: 'Sprint status updated successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        sprintStatus: user.sprintStatus
      }
    })
  } catch (error) {
    return next(error)
  }
}
