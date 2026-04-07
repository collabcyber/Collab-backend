const express = require('express')
const router = express.Router()
const {
  register,
  login,
  forgotPassword,
  verifyResetOTP,
  resetPassword,
  verifyEmail,
  resendVerificationOTP,
  adminTwoFactorSetup,
  adminTwoFactorConfirm,
  adminTwoFactorVerifyLogin,
  adminTwoFactorDisable,
  logout
} = require('../controllers/authController')
const validate = require('../middleware/validate')
const { auth } = require('../validators')
const { authLimiter, otpLimiter } = require('../middleware/rateLimiters')
const { requireRole } = require('../middleware/rbac')
const { emptyBody } = require('../validators')
const { protect } = require('../middleware/authMiddleware')

router.post('/register', authLimiter, validate(auth.registerBody), register)
router.post('/login', authLimiter, validate(auth.loginBody), login)
router.post('/verify-email', otpLimiter, validate(auth.verifyEmailBody), verifyEmail)
router.post('/resend-otp', otpLimiter, validate(auth.resendVerificationBody), resendVerificationOTP)
router.post('/forgot-password', authLimiter, validate(auth.forgotPasswordBody), forgotPassword)
router.post('/verify-reset-otp', otpLimiter, validate(auth.verifyResetBody), verifyResetOTP)
router.post('/reset-password', authLimiter, validate(auth.resetPasswordBody), resetPassword)
router.post('/admin-2fa/setup', protect, requireRole('admin'), validate(emptyBody), adminTwoFactorSetup)
router.post('/admin-2fa/confirm', protect, requireRole('admin'), validate(auth.adminTwoFactorConfirmBody), adminTwoFactorConfirm)
router.post('/admin-2fa/verify-login', otpLimiter, validate(auth.adminTwoFactorVerifyLoginBody), adminTwoFactorVerifyLogin)
router.post('/admin-2fa/disable', protect, requireRole('admin'), validate(auth.adminTwoFactorDisableBody), adminTwoFactorDisable)
router.post('/logout', logout)

module.exports = router
