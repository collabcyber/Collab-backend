const express = require('express')
const router = express.Router()
const { register, login, forgotPassword, verifyResetOTP, resetPassword, verifyEmail, logout } = require('../controllers/authController')
const validate = require('../middleware/validate')
const { auth } = require('../validators')
const { authLimiter, otpLimiter } = require('../middleware/rateLimiters')

router.post('/register', authLimiter, validate(auth.registerBody), register)
router.post('/login', authLimiter, validate(auth.loginBody), login)
router.post('/verify-email', otpLimiter, validate(auth.verifyEmailBody), verifyEmail)
router.post('/forgot-password', authLimiter, validate(auth.forgotPasswordBody), forgotPassword)
router.post('/verify-reset-otp', otpLimiter, validate(auth.verifyResetBody), verifyResetOTP)
router.post('/reset-password', authLimiter, validate(auth.resetPasswordBody), resetPassword)
router.post('/logout', logout)

module.exports = router
