const User = require('../models/User')
const College = require('../models/College')
const generateToken = require('../utils/generateToken')
const jwtConfig = require('../config/jwt')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const mongoose = require('mongoose')
const { randomBytes } = require('crypto')
const speakeasy = require('speakeasy')
const qrcode = require('qrcode')
const { OAuth2Client } = require('google-auth-library')
const { sendEmail } = require('../services/emailService')
const { setAuthCookie, clearAuthCookie } = require('../utils/authCookies')
const { encrypt, decrypt } = require('../utils/crypto')
const { logSecurityEvent } = require('../middleware/securityLogger')
const {
  OTP_EXPIRY_MINUTES,
  OTP_ATTEMPT_LIMIT,
  OTP_RESEND_COOLDOWN_SECONDS,
  generateOtp,
  hashOtp,
  isOtpExpired,
  canResendOtp
} = require('../utils/otp')

const TWO_FACTOR_TOKEN_TTL = '5m'

const emailIsValid = (email) => {
  const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
  return re.test(String(email).toLowerCase())
}

const passwordIsStrong = (password) => {
  return password.length >= 8
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /\d/.test(password)
    && /[!@#$%^&*]/.test(password)
}

const getOwnerEmail = () => process.env.OWNER_EMAIL?.toLowerCase().trim()

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const getFrontendBaseUrl = () => {
  const base = process.env.FRONTEND_URL || 'https://collab-frontend-five.vercel.app'
  return base.replace(/\/$/, '')
}

const buildVerifyLink = (email) => {
  const base = getFrontendBaseUrl()
  return `${base}/verify-email?email=${encodeURIComponent(email)}`
}

const getGoogleClientId = () => process.env.GOOGLE_CLIENT_ID?.trim()

const normalizeLabel = (value) => {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

const normalizeStringList = (input) => {
  const list = Array.isArray(input) ? input : input ? [input] : []
  const normalized = list
    .map((item) => normalizeLabel(typeof item === 'string' ? item : String(item)))
    .filter(Boolean)
  return [...new Set(normalized)]
}

const normalizeExecutionProfileInput = ({
  userGoal,
  executionRoles,
  industryInterests,
  commitmentLevel
} = {}) => {
  const validCommitmentLevels = new Set([
    'Exploring',
    'Team Member',
    'Casual Contributor',
    'Serious Builder',
    'Startup Founder'
  ])

  const normalizedGoal = typeof userGoal === 'string' ? userGoal.trim() : ''
  const goals = normalizedGoal ? [normalizedGoal.slice(0, 180)] : []
  const roles = normalizeStringList(executionRoles).slice(0, 10)
  const interests = normalizeStringList(industryInterests).slice(0, 15)
  const nextCommitment = commitmentLevel === 'Casual Contributor'
    ? 'Team Member'
    : validCommitmentLevels.has(commitmentLevel) ? commitmentLevel : 'Exploring'

  return {
    goals,
    roles,
    commitmentLevel: nextCommitment,
    industryInterests: interests,
    contributionMetrics: {
      milestonesCompleted: 0,
      contributionConsistency: 0,
      collaborationQuality: 0,
      executionReliability: 0
    },
    startupParticipationTimeline: []
  }
}

const normalizeExecutionProfile = (profile = {}) => ({
  goals: Array.isArray(profile.goals) ? profile.goals.filter(Boolean) : [],
  roles: Array.isArray(profile.roles) ? profile.roles.filter(Boolean) : [],
  commitmentLevel: profile.commitmentLevel || 'Exploring',
  industryInterests: Array.isArray(profile.industryInterests) ? profile.industryInterests.filter(Boolean) : [],
  contributionMetrics: {
    milestonesCompleted: Number(profile?.contributionMetrics?.milestonesCompleted || 0),
    contributionConsistency: Number(profile?.contributionMetrics?.contributionConsistency || 0),
    collaborationQuality: Number(profile?.contributionMetrics?.collaborationQuality || 0),
    executionReliability: Number(profile?.contributionMetrics?.executionReliability || 0)
  },
  startupParticipationTimeline: Array.isArray(profile.startupParticipationTimeline)
    ? profile.startupParticipationTimeline
    : []
})

const toUserPayload = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  college: user.college ? { id: user.college._id, name: user.college.name, type: user.college.type } : null,
  college_id: user.college_id || user.college?._id,
  course: user.course,
  yearOfStudy: user.yearOfStudy,
  skills: user.skills,
  primaryCategory: user.primaryCategory,
  role: user.role,
  executionProfile: normalizeExecutionProfile(user.executionProfile)
})

exports.register = async (req, res) => {
  try {
    const { 
      name, 
      email, 
      password, 
      college_id,
      collegeId,
      college,
      collegeName,
      customCollegeName,
      collegeType,
      course, 
      yearOfStudy, 
      skills, 
      primaryCategory,
      phone,
      userGoal,
      executionRoles,
      industryInterests,
      commitmentLevel
    } = req.body

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required' })
    }

    if (!emailIsValid(email)) {
      return res.status(400).json({ message: 'Enter a valid email' })
    }

    if (!passwordIsStrong(password)) {
      return res.status(400).json({ message: 'Password must be 8+ chars and include uppercase, lowercase, number, and symbol' })
    }

    const existingUser = await User.findOne({ email: email.toLowerCase().trim() })
    if (existingUser) {
      if (!existingUser.emailVerified) {
        if (!canResendOtp(existingUser.emailVerificationLastSent)) {
          const waitSeconds = OTP_RESEND_COOLDOWN_SECONDS
          return res.status(429).json({ message: `Please wait ${waitSeconds}s before requesting another OTP.` })
        }

        const otp = generateOtp()
        const expires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000)
        const verifyLink = buildVerifyLink(existingUser.email)

        existingUser.emailVerificationOTP = undefined
        existingUser.emailVerificationOTPHash = hashOtp(otp)
        existingUser.emailVerificationOTPAttempts = 0
        existingUser.emailVerificationExpires = expires
        existingUser.emailVerificationLastSent = new Date()
        await existingUser.save()

        try {
          await sendEmail({
            to: existingUser.email,
            subject: 'Email Verification OTP',
            text: `Your email verification OTP is ${otp}. It expires in ${OTP_EXPIRY_MINUTES} minutes. Verify here: ${verifyLink}`,
            html: `<p>Your email verification OTP is <strong>${otp}</strong>.</p><p>It expires in ${OTP_EXPIRY_MINUTES} minutes.</p><p>Verify here: <a href="${verifyLink}">${verifyLink}</a></p>`
          })
        } catch (mailError) {
          return res.status(500).json({ message: 'Failed to resend verification email. Please try again.' })
        }

        return res.status(200).json({
          message: 'Email already registered but not verified. OTP resent.',
          email: existingUser.email,
          requiresVerification: true
        })
      }

      return res.status(409).json({ message: 'Email already registered' })
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const selectedCollegeId = collegeId || college_id || college
    const normalizedSelected = typeof selectedCollegeId === 'string' ? selectedCollegeId.trim() : selectedCollegeId
    const othersName = customCollegeName || collegeName

    let collegeDoc = null

    // Handle college selection
    if (normalizedSelected && normalizedSelected !== 'null' && normalizedSelected !== 'others' && normalizedSelected !== 'Other') {
      if (!mongoose.Types.ObjectId.isValid(normalizedSelected)) {
        return res.status(400).json({ message: 'Invalid college selection' })
      }
      collegeDoc = await College.findById(normalizedSelected)
      if (!collegeDoc) {
        return res.status(400).json({ message: 'Invalid college selection' })
      }
    } else if (othersName) {
      const trimmedName = othersName.trim()
      if (!trimmedName) {
        return res.status(400).json({ message: 'Custom college name is required' })
      }

      collegeDoc = await College.findOne({ name: new RegExp(`^${escapeRegex(trimmedName)}$`, 'i') })
      if (!collegeDoc) {
        collegeDoc = await College.findOneAndUpdate(
          { name: new RegExp(`^${escapeRegex(trimmedName)}$`, 'i') },
          {
            $setOnInsert: {
              name: trimmedName,
              type: ['Engineering', 'Management', 'Law', 'Medical', 'Other'].includes(collegeType) ? collegeType : 'Other'
            }
          },
          { new: true, upsert: true }
        )
      }
    }

    if (!collegeDoc) {
      return res.status(400).json({ message: 'College selection is required' })
    }

    const otp = generateOtp()
    const expires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000)
    const verifyLink = buildVerifyLink(email.toLowerCase().trim())

    const normalizedSkills = Array.isArray(skills) ? skills : (skills ? [skills] : [])

    const user = new User({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      role: 'user',
      college: collegeDoc._id,
      college_id: collegeDoc._id,
      course: course || '',
      yearOfStudy: yearOfStudy || '',
      skills: normalizedSkills,
      primaryCategory: primaryCategory || '',
      phone: phone ? phone.toString().trim() : '',
      executionProfile: normalizeExecutionProfileInput({
        userGoal,
        executionRoles,
        industryInterests,
        commitmentLevel
      }),
      emailVerified: false,
      emailVerificationOTP: undefined,
      emailVerificationOTPHash: hashOtp(otp),
      emailVerificationOTPAttempts: 0,
      emailVerificationLastSent: new Date(),
      emailVerificationExpires: expires
    })

    await user.save()

    try {
      await sendEmail({
        to: user.email,
        subject: 'Email Verification OTP',
        text: `Your email verification OTP is ${otp}. It expires in ${OTP_EXPIRY_MINUTES} minutes. Verify here: ${verifyLink}`,
        html: `<p>Your email verification OTP is <strong>${otp}</strong>.</p><p>It expires in ${OTP_EXPIRY_MINUTES} minutes.</p><p>Verify here: <a href="${verifyLink}">${verifyLink}</a></p>`
      })
    } catch (mailError) {
      await User.deleteOne({ _id: user._id })
      return res.status(500).json({ message: 'Failed to send verification email. Please try again.' })
    }

    res.status(201).json({
      message: 'Registration successful. Please check your email for OTP to verify.',
      email: user.email
    })
  } catch (error) {
    console.error('Registration error:', error)
    if (error.code === 11000) {
      return res.status(409).json({ message: 'Email already registered' })
    }
    res.status(500).json({ message: 'Registration failed' })
  }
}

exports.verifyEmail = async (req, res) => {
  try {
    const { email, otp } = req.body
    const normalizedOtp = String(otp || '').replace(/\D/g, '')
    if (!email || !normalizedOtp) {
      return res.status(400).json({ message: 'Email and OTP are required' })
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() })
      .select('+password +emailVerificationOTP +emailVerificationOTPHash')
      .populate('college')
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    if (user.emailVerified) {
      return res.status(400).json({ message: 'Email already verified' })
    }

    if ((user.emailVerificationOTPAttempts || 0) >= OTP_ATTEMPT_LIMIT) {
      logSecurityEvent('otp_lockout', req, { userId: user._id })
      return res.status(429).json({ message: 'Too many invalid attempts. Please request a new OTP.' })
    }

    const providedHash = hashOtp(normalizedOtp)
    const storedHash = user.emailVerificationOTPHash
    const legacyOtp = user.emailVerificationOTP
    const isMatch = storedHash ? providedHash === storedHash : legacyOtp === normalizedOtp

    if (!isMatch) {
      user.emailVerificationOTPAttempts = (user.emailVerificationOTPAttempts || 0) + 1
      await user.save()
      if (user.emailVerificationOTPAttempts >= OTP_ATTEMPT_LIMIT) {
        user.emailVerificationOTP = undefined
        user.emailVerificationOTPHash = undefined
        user.emailVerificationExpires = undefined
        await user.save()
        return res.status(429).json({ message: 'Too many invalid attempts. Please request a new OTP.' })
      }
      return res.status(400).json({ message: 'Invalid OTP' })
    }

    if (isOtpExpired(user.emailVerificationExpires)) {
      user.emailVerificationOTP = undefined
      user.emailVerificationOTPHash = undefined
      user.emailVerificationExpires = undefined
      await user.save()
      return res.status(400).json({ message: 'OTP expired' })
    }

    user.emailVerified = true
    user.emailVerificationOTP = undefined
    user.emailVerificationOTPHash = undefined
    user.emailVerificationOTPAttempts = 0
    user.emailVerificationLastSent = undefined
    user.emailVerificationExpires = undefined
    if (!user.college_id && user.college) {
      user.college_id = user.college._id
    }
    const ownerEmail = getOwnerEmail()
    if (ownerEmail && user.email?.toLowerCase() === ownerEmail) {
      user.role = 'admin'
    }

    await user.save()

    const token = generateToken(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: jwtConfig.accessExpiresIn }
    )
    setAuthCookie(res, token)

    res.json({
      user: toUserPayload(user),
      message: 'Email verified successfully'
    })
  } catch (error) {
    console.error('verifyEmail error:', error)
    res.status(500).json({ message: 'Email verification failed' })
  }
}

exports.resendVerificationOTP = async (req, res) => {
  try {
    const { email } = req.body
    if (!email || !emailIsValid(email)) {
      return res.status(400).json({ message: 'Enter a valid email' })
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() })
      .select('+emailVerificationOTP +emailVerificationOTPHash +emailVerificationOTPAttempts')
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    if (user.emailVerified) {
      return res.status(400).json({ message: 'Email already verified' })
    }

    if (!canResendOtp(user.emailVerificationLastSent)) {
      const waitSeconds = OTP_RESEND_COOLDOWN_SECONDS
      return res.status(429).json({ message: `Please wait ${waitSeconds}s before requesting another OTP.` })
    }

    const otp = generateOtp()
    const expires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000)
    const verifyLink = buildVerifyLink(user.email)

    user.emailVerificationOTP = undefined
    user.emailVerificationOTPHash = hashOtp(otp)
    user.emailVerificationOTPAttempts = 0
    user.emailVerificationLastSent = new Date()
    user.emailVerificationExpires = expires
    await user.save()

    try {
      await sendEmail({
        to: user.email,
        subject: 'Email Verification OTP',
        text: `Your email verification OTP is ${otp}. It expires in ${OTP_EXPIRY_MINUTES} minutes. Verify here: ${verifyLink}`,
        html: `<p>Your email verification OTP is <strong>${otp}</strong>.</p><p>It expires in ${OTP_EXPIRY_MINUTES} minutes.</p><p>Verify here: <a href="${verifyLink}">${verifyLink}</a></p>`
      })
    } catch (mailError) {
      return res.status(500).json({ message: 'Failed to resend verification email. Please try again.' })
    }

    return res.status(200).json({
      message: 'OTP resent. Please check your email.',
      email: user.email
    })
  } catch (error) {
    console.error('resendVerificationOTP error:', error)
    res.status(500).json({ message: 'Failed to resend OTP' })
  }
}

const getTwoFactorSecret = (user) => {
  if (!user?.twoFactorSecret) {
    return null
  }
  try {
    return decrypt(user.twoFactorSecret)
  } catch (error) {
    console.error('Failed to decrypt 2FA secret:', error)
    return null
  }
}

exports.adminTwoFactorSetup = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('+twoFactorSecret')
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    if (user.twoFactorEnabled) {
      return res.status(400).json({ message: 'Two-factor authentication is already enabled' })
    }

    const secret = speakeasy.generateSecret({
      name: `Collab (${user.email})`
    })

    user.twoFactorSecret = encrypt(secret.base32)
    user.twoFactorPending = true
    await user.save()

    const qrCodeDataUrl = await qrcode.toDataURL(secret.otpauth_url)

    res.json({
      message: 'Scan the QR code with your authenticator app and confirm the code.',
      otpauthUrl: secret.otpauth_url,
      qrCodeDataUrl
    })
  } catch (error) {
    console.error('adminTwoFactorSetup error:', error)
    res.status(500).json({ message: 'Failed to start two-factor setup' })
  }
}

exports.adminTwoFactorConfirm = async (req, res) => {
  try {
    const { code } = req.body
    const user = await User.findById(req.user.userId).select('+twoFactorSecret')
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    const secret = getTwoFactorSecret(user)
    if (!secret) {
      return res.status(400).json({ message: 'Two-factor setup not initialized' })
    }

    const verified = speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token: code,
      window: 1
    })

    if (!verified) {
      logSecurityEvent('admin_2fa_failed', req, { reason: 'invalid_code', userId: user._id })
      return res.status(400).json({ message: 'Invalid authentication code' })
    }

    user.twoFactorEnabled = true
    user.twoFactorPending = false
    user.twoFactorLastVerified = new Date()
    await user.save()

    res.json({ message: 'Two-factor authentication enabled' })
  } catch (error) {
    console.error('adminTwoFactorConfirm error:', error)
    res.status(500).json({ message: 'Failed to enable two-factor authentication' })
  }
}

exports.adminTwoFactorVerifyLogin = async (req, res) => {
  try {
    const { token, code } = req.body
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    if (decoded?.type !== 'admin-2fa') {
      return res.status(401).json({ message: 'Invalid two-factor session' })
    }

    const user = await User.findById(decoded.userId)
      .select('+twoFactorSecret')
      .populate('college')
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    if (!user.twoFactorEnabled) {
      return res.status(400).json({ message: 'Two-factor is not enabled for this account' })
    }

    const secret = getTwoFactorSecret(user)
    if (!secret) {
      return res.status(400).json({ message: 'Two-factor setup not initialized' })
    }

    const verified = speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token: code,
      window: 1
    })

    if (!verified) {
      logSecurityEvent('admin_2fa_failed', req, { reason: 'invalid_code', userId: user._id })
      return res.status(401).json({ message: 'Invalid authentication code' })
    }

    user.twoFactorLastVerified = new Date()
    await user.save()

    const accessToken = generateToken(
      { userId: user._id, email: user.email, tfa: true },
      process.env.JWT_SECRET,
      { expiresIn: jwtConfig.accessExpiresIn }
    )
    setAuthCookie(res, accessToken)

    res.json({
      message: 'Two-factor authentication successful',
      user: toUserPayload(user)
    })
  } catch (error) {
    console.error('adminTwoFactorVerifyLogin error:', error)
    res.status(500).json({ message: 'Failed to verify two-factor authentication' })
  }
}

exports.adminTwoFactorDisable = async (req, res) => {
  try {
    const { code } = req.body
    const user = await User.findById(req.user.userId).select('+twoFactorSecret')
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    if (!user.twoFactorEnabled) {
      return res.status(400).json({ message: 'Two-factor authentication is already disabled' })
    }

    const secret = getTwoFactorSecret(user)
    if (!secret) {
      return res.status(400).json({ message: 'Two-factor setup not initialized' })
    }

    const verified = speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token: code,
      window: 1
    })

    if (!verified) {
      logSecurityEvent('admin_2fa_failed', req, { reason: 'invalid_code', userId: user._id })
      return res.status(401).json({ message: 'Invalid authentication code' })
    }

    user.twoFactorEnabled = false
    user.twoFactorPending = false
    user.twoFactorSecret = undefined
    user.twoFactorLastVerified = undefined
    await user.save()

    res.json({ message: 'Two-factor authentication disabled' })
  } catch (error) {
    console.error('adminTwoFactorDisable error:', error)
    res.status(500).json({ message: 'Failed to disable two-factor authentication' })
  }
}

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' })
    }

    if (!emailIsValid(email)) {
      return res.status(400).json({ message: 'Enter a valid email' })
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() })
      .select('+password +emailVerificationOTP +emailVerificationOTPHash +emailVerificationOTPAttempts')
      .populate('college')
    if (!user) {
      logSecurityEvent('auth_failure', req, { reason: 'user_not_found' })
      return res.status(401).json({ message: 'Invalid email or password' })
    }

    if (!user.emailVerified) {
      logSecurityEvent('auth_failure', req, { reason: 'email_unverified', userId: user._id })
      return res.status(401).json({ message: 'Please verify your email first' })
    }

    const isPasswordValid = await bcrypt.compare(password, user.password)
    if (!isPasswordValid) {
      logSecurityEvent('auth_failure', req, { reason: 'invalid_password', userId: user._id })
      return res.status(401).json({ message: 'Invalid email or password' })
    }

    if (user.role === 'admin' && !passwordIsStrong(password)) {
      logSecurityEvent('weak_admin_password', req, { userId: user._id })
      return res.status(403).json({
        message: 'Admin password is too weak. Please reset your password to continue.'
      })
    }

    // Update last activity
    if (!user.college_id && user.college) {
      user.college_id = user.college._id
    }
    const ownerEmail = getOwnerEmail()
    if (ownerEmail && user.email?.toLowerCase() === ownerEmail && user.role !== 'admin') {
      user.role = 'admin'
    }
    user.lastActive = new Date()
    await user.save()

    if (user.role === 'admin' && user.twoFactorEnabled) {
      const twoFactorToken = generateToken(
        { userId: user._id, type: 'admin-2fa' },
        process.env.JWT_SECRET,
        { expiresIn: TWO_FACTOR_TOKEN_TTL }
      )
      return res.status(200).json({
        message: 'Two-factor authentication required',
        twoFactorRequired: true,
        twoFactorToken
      })
    }

    const token = generateToken(
      { userId: user._id, email: user.email, tfa: user.role === 'admin' ? true : undefined },
      process.env.JWT_SECRET,
      { expiresIn: jwtConfig.accessExpiresIn }
    )
    setAuthCookie(res, token)

    res.status(200).json({
      user: toUserPayload(user)
    })
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ message: 'Login failed' })
  }
}

exports.googleAuth = async (req, res) => {
  try {
    const { credential, college_id, collegeId, college } = req.body
    if (!credential || typeof credential !== 'string') {
      return res.status(400).json({ message: 'Google credential is required' })
    }

    const googleClientId = getGoogleClientId()
    if (!googleClientId) {
      return res.status(500).json({ message: 'Google auth is not configured' })
    }

    let googlePayload
    try {
      const client = new OAuth2Client(googleClientId)
      const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: googleClientId
      })
      googlePayload = ticket.getPayload()
    } catch (verifyError) {
      logSecurityEvent('auth_failure', req, { reason: 'google_token_invalid' })
      return res.status(401).json({ message: 'Invalid Google token' })
    }

    const googleEmail = googlePayload?.email?.toLowerCase().trim()
    if (!googleEmail || !googlePayload?.email_verified || !googlePayload?.sub) {
      logSecurityEvent('auth_failure', req, { reason: 'google_payload_invalid' })
      return res.status(401).json({ message: 'Unable to verify Google account email' })
    }

    let selectedCollege = collegeId || college_id || college
    selectedCollege = typeof selectedCollege === 'string' ? selectedCollege.trim() : selectedCollege
    let selectedCollegeDoc = null
    if (selectedCollege && selectedCollege !== 'null') {
      if (!mongoose.Types.ObjectId.isValid(selectedCollege)) {
        return res.status(400).json({ message: 'Invalid college selection' })
      }
      selectedCollegeDoc = await College.findById(selectedCollege)
      if (!selectedCollegeDoc) {
        return res.status(400).json({ message: 'Invalid college selection' })
      }
    }

    let isNewUser = false
    let user = await User.findOne({ email: googleEmail })
      .select('+password +emailVerificationOTP +emailVerificationOTPHash +emailVerificationOTPAttempts')
      .populate('college')

    if (!user) {
      isNewUser = true
      const generatedPassword = `${randomBytes(24).toString('hex')}Aa1!`
      const hashedPassword = await bcrypt.hash(generatedPassword, 10)
      const ownerEmail = getOwnerEmail()
      const defaultRole = ownerEmail && googleEmail === ownerEmail ? 'admin' : 'user'

      user = new User({
        name: (googlePayload.name || googleEmail.split('@')[0] || 'Google User').trim(),
        email: googleEmail,
        password: hashedPassword,
        role: defaultRole,
        authProvider: 'google',
        googleId: googlePayload.sub,
        emailVerified: true,
        emailVerificationOTP: undefined,
        emailVerificationOTPHash: undefined,
        emailVerificationOTPAttempts: 0,
        emailVerificationLastSent: undefined,
        emailVerificationExpires: undefined,
        college: selectedCollegeDoc?._id || undefined,
        college_id: selectedCollegeDoc?._id || undefined,
        course: '',
        yearOfStudy: '',
        skills: [],
        primaryCategory: '',
        phone: ''
      })
    } else {
      if (user.googleId && user.googleId !== googlePayload.sub) {
        logSecurityEvent('auth_failure', req, { reason: 'google_subject_mismatch', userId: user._id })
        return res.status(401).json({ message: 'Google account does not match this user' })
      }
      if (!user.googleId) {
        user.googleId = googlePayload.sub
      }
      if (!user.authProvider || user.authProvider === 'local') {
        user.authProvider = 'google'
      }

      if (!user.emailVerified) {
        user.emailVerified = true
        user.emailVerificationOTP = undefined
        user.emailVerificationOTPHash = undefined
        user.emailVerificationOTPAttempts = 0
        user.emailVerificationLastSent = undefined
        user.emailVerificationExpires = undefined
      }

      if (!user.college && selectedCollegeDoc) {
        user.college = selectedCollegeDoc._id
        user.college_id = selectedCollegeDoc._id
      }
    }

    if (!user.college_id && user.college) {
      user.college_id = user.college._id || user.college
    }
    const ownerEmail = getOwnerEmail()
    if (ownerEmail && user.email?.toLowerCase() === ownerEmail && user.role !== 'admin') {
      user.role = 'admin'
    }

    user.lastActive = new Date()
    await user.save()

    if (!user.college || typeof user.college === 'string' || user.college instanceof mongoose.Types.ObjectId) {
      user = await User.findById(user._id).populate('college')
    }

    if (user.role === 'admin' && user.twoFactorEnabled) {
      const twoFactorToken = generateToken(
        { userId: user._id, type: 'admin-2fa' },
        process.env.JWT_SECRET,
        { expiresIn: TWO_FACTOR_TOKEN_TTL }
      )
      return res.status(200).json({
        message: 'Two-factor authentication required',
        twoFactorRequired: true,
        twoFactorToken
      })
    }

    const token = generateToken(
      { userId: user._id, email: user.email, tfa: user.role === 'admin' ? true : undefined },
      process.env.JWT_SECRET,
      { expiresIn: jwtConfig.accessExpiresIn }
    )
    setAuthCookie(res, token)

    res.status(200).json({
      message: isNewUser ? 'Google account connected successfully' : 'Logged in with Google',
      isNewUser,
      user: toUserPayload(user)
    })
  } catch (error) {
    console.error('googleAuth error:', error)
    res.status(500).json({ message: 'Google authentication failed' })
  }
}

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body
    if (!email || !emailIsValid(email)) {
      return res.status(400).json({ message: 'Enter a valid email to reset password' })
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() })
      .select('+resetPasswordOTP +resetPasswordOTPHash +resetPasswordOTPAttempts')
    if (!user) {
      return res.status(404).json({ message: 'No account found for that email' })
    }

    if (!canResendOtp(user.resetPasswordLastSent)) {
      const waitSeconds = OTP_RESEND_COOLDOWN_SECONDS
      return res.status(429).json({ message: `Please wait ${waitSeconds}s before requesting another OTP.` })
    }

    const otp = generateOtp()
    const expires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000)

    user.resetPasswordOTP = undefined
    user.resetPasswordOTPHash = hashOtp(otp)
    user.resetPasswordOTPAttempts = 0
    user.resetPasswordLastSent = new Date()
    user.resetPasswordExpires = expires
    await user.save()

    try {
      await sendEmail({
        to: user.email,
        subject: 'Password Reset OTP',
        text: `Your password reset OTP is ${otp}. It expires in ${OTP_EXPIRY_MINUTES} minutes.`,
        html: `<p>Your password reset OTP is <strong>${otp}</strong>.</p><p>It expires in ${OTP_EXPIRY_MINUTES} minutes.</p>`
      })
    } catch (mailError) {
      return res.status(500).json({ message: 'Failed to send OTP email. Please try again.' })
    }

    res.json({ message: 'OTP sent to email' })
  } catch (error) {
    console.error('forgotPassword error:', error)
    res.status(500).json({ message: 'Failed to send OTP' })
  }
}

exports.verifyResetOTP = async (req, res) => {
  try {
    const { email, otp } = req.body
    const normalizedOtp = String(otp || '').replace(/\D/g, '')
    if (!email || !normalizedOtp) {
      return res.status(400).json({ message: 'Email and OTP are required' })
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() })
      .select('+resetPasswordOTP +resetPasswordOTPHash')
    if (!user) {
      return res.status(400).json({ message: 'Invalid OTP' })
    }

    if ((user.resetPasswordOTPAttempts || 0) >= OTP_ATTEMPT_LIMIT) {
      logSecurityEvent('otp_lockout', req, { userId: user._id })
      return res.status(429).json({ message: 'Too many invalid attempts. Please request a new OTP.' })
    }

    const providedHash = hashOtp(normalizedOtp)
    const storedHash = user.resetPasswordOTPHash
    const legacyOtp = user.resetPasswordOTP
    const isMatch = storedHash ? providedHash === storedHash : legacyOtp === normalizedOtp

    if (!isMatch) {
      user.resetPasswordOTPAttempts = (user.resetPasswordOTPAttempts || 0) + 1
      await user.save()
      if (user.resetPasswordOTPAttempts >= OTP_ATTEMPT_LIMIT) {
        user.resetPasswordOTP = undefined
        user.resetPasswordOTPHash = undefined
        user.resetPasswordExpires = undefined
        await user.save()
        return res.status(429).json({ message: 'Too many invalid attempts. Please request a new OTP.' })
      }
      return res.status(400).json({ message: 'Invalid OTP' })
    }

    if (isOtpExpired(user.resetPasswordExpires)) {
      user.resetPasswordOTP = undefined
      user.resetPasswordOTPHash = undefined
      user.resetPasswordExpires = undefined
      await user.save()
      return res.status(400).json({ message: 'OTP expired' })
    }

    res.json({ message: 'OTP verified' })
  } catch (error) {
    console.error('verifyResetOTP error:', error)
    res.status(500).json({ message: 'OTP verification failed' })
  }
}

exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body
    const normalizedOtp = String(otp || '').replace(/\D/g, '')

    if (!email || !normalizedOtp || !newPassword) {
      return res.status(400).json({ message: 'Email, OTP and new password are required' })
    }

    if (!passwordIsStrong(newPassword)) {
      return res.status(400).json({ message: 'Password must be 8+ chars and include uppercase, lowercase, number, and symbol' })
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() })

    if (!user || !user.resetPasswordExpires) {
      return res.status(400).json({ message: 'Invalid OTP or email' })
    }

    const providedHash = hashOtp(normalizedOtp)
    const storedHash = user.resetPasswordOTPHash
    const legacyOtp = user.resetPasswordOTP
    const isMatch = storedHash ? providedHash === storedHash : legacyOtp === normalizedOtp

    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid OTP or email' })
    }

    if (isOtpExpired(user.resetPasswordExpires)) {
      return res.status(400).json({ message: 'OTP expired' })
    }

    user.password = await bcrypt.hash(newPassword, 10)
    user.resetPasswordOTP = undefined
    user.resetPasswordOTPHash = undefined
    user.resetPasswordOTPAttempts = 0
    user.resetPasswordLastSent = undefined
    user.resetPasswordExpires = undefined
    await user.save()

    res.json({ message: 'Password updated successfully' })
  } catch (error) {
    console.error('resetPassword error:', error)
    res.status(500).json({ message: 'Failed to reset password' })
  }
}

exports.logout = async (req, res) => {
  clearAuthCookie(res)
  res.json({ message: 'Logged out successfully' })
}
