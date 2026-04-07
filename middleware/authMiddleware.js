const jwt = require('jsonwebtoken')
const User = require('../models/User')
const { setAuthCookie } = require('../utils/authCookies')
const jwtConfig = require('../config/jwt')

exports.protect = async (req, res, next) => {
  try {
    const headerToken = req.headers.authorization?.split(' ')[1]
    const cookieToken = req.cookies?.accessToken
    const token = cookieToken || headerToken
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

    const nowSeconds = Math.floor(Date.now() / 1000)
    if (decoded?.exp && decoded.exp - nowSeconds < 5 * 60) {
      const refreshed = jwt.sign(
        { userId: user._id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: jwtConfig.accessExpiresIn }
      )
      setAuthCookie(res, refreshed)
    }

    if (user.role === 'admin' && user.twoFactorEnabled && decoded?.tfa !== true) {
      return res.status(401).json({ message: 'Two-factor authentication required' })
    }

    req.user = { userId: user._id, email: user.email, role: user.role }
    next()
  } catch (error) {
    console.error('Auth middleware error:', error)
    res.status(401).json({ message: 'Invalid token' })
  }
}
