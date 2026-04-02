const jwt = require('jsonwebtoken')
const User = require('../models/User')

exports.protect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1]
    if (!token) {
      return res.status(401).json({ message: 'No token provided' })
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const user = await User.findById(decoded.userId)
    if (!user) {
      return res.status(401).json({ message: 'User not found' })
    }

    const ownerEmail = process.env.OWNER_EMAIL?.toLowerCase().trim()
    if (ownerEmail && user.email?.toLowerCase() === ownerEmail && user.role !== 'admin') {
      user.role = 'admin'
      await user.save()
    }

    const lastActive = user.lastActive ? new Date(user.lastActive).getTime() : 0
    if (!lastActive || Date.now() - lastActive > 2 * 60 * 1000) {
      user.lastActive = new Date()
      await user.save()
    }

    req.user = { userId: user._id, email: user.email, role: user.role }
    next()
  } catch (error) {
    console.error('Auth middleware error:', error)
    res.status(401).json({ message: 'Invalid token' })
  }
}
