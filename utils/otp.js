const crypto = require('crypto')

const OTP_EXPIRY_MINUTES = 5
const OTP_ATTEMPT_LIMIT = 5
const OTP_RESEND_COOLDOWN_SECONDS = 60

const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString()

const hashOtp = (otp) =>
  crypto.createHash('sha256').update(otp).digest('hex')

const isOtpExpired = (expiresAt) => !expiresAt || new Date(expiresAt) < new Date()

const canResendOtp = (lastSent) => {
  if (!lastSent) return true
  const diffSeconds = (Date.now() - new Date(lastSent).getTime()) / 1000
  return diffSeconds >= OTP_RESEND_COOLDOWN_SECONDS
}

module.exports = {
  OTP_EXPIRY_MINUTES,
  OTP_ATTEMPT_LIMIT,
  OTP_RESEND_COOLDOWN_SECONDS,
  generateOtp,
  hashOtp,
  isOtpExpired,
  canResendOtp
}
