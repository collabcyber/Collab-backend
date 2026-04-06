const User = require('../models/User')
const College = require('../models/College')
const generateToken = require('../utils/generateToken')
const jwtConfig = require('../config/jwt')
const bcrypt = require('bcryptjs')
const mongoose = require('mongoose')
const { sendEmail } = require('../services/emailService')
const { setAuthCookie, clearAuthCookie } = require('../utils/authCookies')
const {
  OTP_EXPIRY_MINUTES,
  OTP_ATTEMPT_LIMIT,
  OTP_RESEND_COOLDOWN_SECONDS,
  generateOtp,
  hashOtp,
  isOtpExpired,
  canResendOtp
} = require('../utils/otp')

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

const calculatePoints = (action) => {
  const points = {
    create_project: 15,
    join_project: 8,
    complete_project: 25,
    validation_given: 3,
    helpful_feedback: 5,
    inactivity_penalty: -10
  }
  return points[action] || 0
}

const awardBadges = (user, action) => {
  const badges = []
  
  if (user.projectsCreated >= 1) badges.push('🚀 Builder')
  if (user.projectsJoined >= 3) badges.push('🤝 Collaborator')
  if (user.validationsGiven >= 10) badges.push('🧠 Validator')
  if (user.inactivePenalties === 0 && user.lastActive > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) {
    badges.push('🔥 Consistent')
  }
  if (user.points >= 100) badges.push('🏆 Top Performer')
  
  return badges
}

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const getFrontendBaseUrl = () => {
  const base = process.env.FRONTEND_URL || 'https://collab-frontend-five.vercel.app'
  return base.replace(/\/$/, '')
}

const buildVerifyLink = (email) => {
  const base = getFrontendBaseUrl()
  return `${base}/verify-email?email=${encodeURIComponent(email)}`
}

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
      phone
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
    if (!email || !otp) {
      return res.status(400).json({ message: 'Email and OTP are required' })
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() })
      .select('+password')
      .populate('college')
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    if (user.emailVerified) {
      return res.status(400).json({ message: 'Email already verified' })
    }

    if ((user.emailVerificationOTPAttempts || 0) >= OTP_ATTEMPT_LIMIT) {
      return res.status(429).json({ message: 'Too many invalid attempts. Please request a new OTP.' })
    }

    const providedHash = hashOtp(String(otp))
    const storedHash = user.emailVerificationOTPHash
    const legacyOtp = user.emailVerificationOTP
    const isMatch = storedHash ? providedHash === storedHash : legacyOtp === otp

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
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        college: user.college ? { id: user.college._id, name: user.college.name, type: user.college.type } : null,
        college_id: user.college_id || user.college?._id,
        course: user.course,
        yearOfStudy: user.yearOfStudy,
        skills: user.skills,
        primaryCategory: user.primaryCategory,
        points: user.points,
        badges: user.badges,
        role: user.role
      },
      message: 'Email verified successfully'
    })
  } catch (error) {
    console.error('verifyEmail error:', error)
    res.status(500).json({ message: 'Email verification failed' })
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
      .select('+emailVerificationOTP +emailVerificationOTPHash +emailVerificationOTPAttempts')
      .populate('college')
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' })
    }

    if (!user.emailVerified) {
      return res.status(401).json({ message: 'Please verify your email first' })
    }

    const isPasswordValid = await bcrypt.compare(password, user.password)
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid email or password' })
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

    const token = generateToken(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: jwtConfig.accessExpiresIn }
    )
    setAuthCookie(res, token)

    res.status(200).json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        college: user.college ? { id: user.college._id, name: user.college.name, type: user.college.type } : null,
        college_id: user.college_id || user.college?._id,
        course: user.course,
        yearOfStudy: user.yearOfStudy,
        skills: user.skills,
        primaryCategory: user.primaryCategory,
        points: user.points,
        badges: user.badges,
        role: user.role
      }
    })
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ message: 'Login failed' })
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
    if (!email || !otp) {
      return res.status(400).json({ message: 'Email and OTP are required' })
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() })
      .select('+resetPasswordOTP +resetPasswordOTPHash')
    if (!user) {
      return res.status(400).json({ message: 'Invalid OTP' })
    }

    if ((user.resetPasswordOTPAttempts || 0) >= OTP_ATTEMPT_LIMIT) {
      return res.status(429).json({ message: 'Too many invalid attempts. Please request a new OTP.' })
    }

    const providedHash = hashOtp(String(otp))
    const storedHash = user.resetPasswordOTPHash
    const legacyOtp = user.resetPasswordOTP
    const isMatch = storedHash ? providedHash === storedHash : legacyOtp === otp

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

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ message: 'Email, OTP and new password are required' })
    }

    if (!passwordIsStrong(newPassword)) {
      return res.status(400).json({ message: 'Password must be 8+ chars and include uppercase, lowercase, number, and symbol' })
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() })

    if (!user || !user.resetPasswordExpires) {
      return res.status(400).json({ message: 'Invalid OTP or email' })
    }

    const providedHash = hashOtp(String(otp))
    const storedHash = user.resetPasswordOTPHash
    const legacyOtp = user.resetPasswordOTP
    const isMatch = storedHash ? providedHash === storedHash : legacyOtp === otp

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
