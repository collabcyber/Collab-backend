const rateLimit = require('express-rate-limit')
const { logSecurityEvent } = require('./securityLogger')

const getClientIp = (req) =>
  req.headers['cf-connecting-ip']
    || req.headers['x-real-ip']
    || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.ip

const createLimiter = (options) =>
  rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: options.message || 'Too many requests' },
    keyGenerator: getClientIp,
    handler: (req, res) => {
      logSecurityEvent('rate_limit', req, {
        limit: options.max,
        windowMs: options.windowMs
      })
      res.status(429).json({ message: options.message || 'Too many requests' })
    }
  })

const apiLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: 'Too many requests. Please slow down.'
})

const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many auth attempts. Please try again later.'
})

const otpLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: 'Too many OTP attempts. Please try again later.'
})

module.exports = {
  apiLimiter,
  authLimiter,
  otpLimiter
}
