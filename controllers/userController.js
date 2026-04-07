const User = require('../models/User')
const College = require('../models/College')
const bcrypt = require('bcryptjs')

const emailIsValid = (email) => {
  const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
  return re.test(String(email).toLowerCase())
}

const passwordIsStrong = (password) => {
  return typeof password === 'string'
    && password.length >= 8
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /\d/.test(password)
    && /[!@#$%^&*]/.test(password)
}

exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.userId

    const user = await User.findById(userId).select('+password')
      .populate('college', 'name type')

    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      college: user.college ? { id: user.college._id, name: user.college.name, type: user.college.type } : null,
      college_id: user.college_id || user.college?._id,
      course: user.course,
      yearOfStudy: user.yearOfStudy,
      skills: user.skills,
      primaryCategory: user.primaryCategory,
      phone: user.phone || '',
      points: user.points,
      badges: user.badges,
      projectsCreated: user.projectsCreated,
      projectsJoined: user.projectsJoined,
      projectsCompleted: user.projectsCompleted,
      validationsGiven: user.validationsGiven,
      helpfulFeedback: user.helpfulFeedback,
      showContactToTeam: user.showContactToTeam,
      twoFactorEnabled: user.twoFactorEnabled,
      twoFactorPending: user.twoFactorPending,
      role: user.role
    })
  } catch (error) {
    console.error('Get profile error:', error)
    res.status(500).json({ message: 'Failed to fetch profile' })
  }
}

exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.userId
    const { name, course, yearOfStudy, skills, primaryCategory, showContactToTeam, phone } = req.body

    const user = await User.findById(userId).select('+password')
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    if (name) user.name = name.trim()
    if (course) user.course = course.trim()
    if (yearOfStudy) user.yearOfStudy = yearOfStudy
    if (skills) user.skills = Array.isArray(skills) ? skills : [skills]
    if (primaryCategory) user.primaryCategory = primaryCategory
    if (showContactToTeam !== undefined) user.showContactToTeam = showContactToTeam
    if (phone !== undefined) user.phone = phone ? phone.toString().trim() : ''

    await user.save()

    res.json({ message: 'Profile updated successfully' })
  } catch (error) {
    console.error('Update profile error:', error)
    res.status(500).json({ message: 'Failed to update profile' })
  }
}

exports.changePassword = async (req, res) => {
  try {
    const userId = req.user.userId
    const { currentPassword, newPassword } = req.body

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current password and new password are required' })
    }

    const user = await User.findById(userId)
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password)
    if (!isCurrentPasswordValid) {
      return res.status(400).json({ message: 'Current password is incorrect' })
    }

    const passwordIsStrong = (password) => {
      return password.length >= 8
        && /[A-Z]/.test(password)
        && /[a-z]/.test(password)
        && /\d/.test(password)
        && /[!@#$%^&*]/.test(password)
    }

    if (!passwordIsStrong(newPassword)) {
      return res.status(400).json({ message: 'Password must be 8+ chars and include uppercase, lowercase, number, and symbol' })
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10)
    user.password = hashedPassword
    await user.save()

    res.json({ message: 'Password changed successfully' })
  } catch (error) {
    console.error('Change password error:', error)
    res.status(500).json({ message: 'Failed to change password' })
  }
}

exports.getLeaderboard = async (req, res) => {
  try {
    const { college, page = 1, limit = 50 } = req.query
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 50))
    const parsedPage = Math.max(1, parseInt(page, 10) || 1)

    let query = {}
    
    if (college && college !== 'all') {
      query.$or = [{ college }, { college_id: college }]
    }

    const users = await User.find(query)
      .populate('college', 'name type')
      .sort({ points: -1 })
      .limit(parsedLimit)
      .skip((parsedPage - 1) * parsedLimit)
      .select('name points badges college')

    const total = await User.countDocuments(query)

    res.json({
      users,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        pages: Math.ceil(total / parsedLimit)
      }
    })
  } catch (error) {
    console.error('Get leaderboard error:', error)
    res.status(500).json({ message: 'Failed to fetch leaderboard' })
  }
}

exports.getRank = async (req, res) => {
  try {
    const userId = req.user.userId
    const user = await User.findById(userId).select('points college college_id')
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    const higherCount = await User.countDocuments({ points: { $gt: user.points } })
    let collegeRank = null
    const collegeId = user.college || user.college_id
    if (collegeId) {
      const higherCollege = await User.countDocuments({ $or: [{ college: collegeId }, { college_id: collegeId }], points: { $gt: user.points } })
      collegeRank = higherCollege + 1
    }

    res.json({
      rank: higherCount + 1,
      collegeRank
    })
  } catch (error) {
    console.error('Get rank error:', error)
    res.status(500).json({ message: 'Failed to fetch rank' })
  }
}

exports.getUserProjects = async (req, res) => {
  try {
    const userId = req.user.userId
    const { status = 'all', page = 1, limit = 10 } = req.query
    const parsedLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 10))
    const parsedPage = Math.max(1, parseInt(page, 10) || 1)

    let query = { $or: [{ owner: userId }, { teamMembers: userId }] }
    
    if (status !== 'all') {
      query.status = status
    }

    const Project = require('../models/Project')
    const projects = await Project.find(query)
      .populate('owner', 'name email')
      .populate('teamMembers', 'name email')
      .sort({ createdAt: -1 })
      .limit(parsedLimit)
      .skip((parsedPage - 1) * parsedLimit)

    const total = await Project.countDocuments(query)

    res.json({
      projects,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        pages: Math.ceil(total / parsedLimit)
      }
    })
  } catch (error) {
    console.error('Get user projects error:', error)
    res.status(500).json({ message: 'Failed to fetch user projects' })
  }
}

exports.getAllUsers = async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' })
    }

    const { page = 1, limit = 50 } = req.query
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 50))
    const parsedPage = Math.max(1, parseInt(page, 10) || 1)

    const users = await User.find({})
      .select('name email role emailVerified points lastActive createdAt')
      .sort({ createdAt: -1 })
      .limit(parsedLimit)
      .skip((parsedPage - 1) * parsedLimit)

    const total = await User.countDocuments({})

    res.json({
      users,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        pages: Math.ceil(total / parsedLimit)
      }
    })
  } catch (error) {
    console.error('Get all users error:', error)
    res.status(500).json({ message: 'Failed to fetch users' })
  }
}

exports.getUserById = async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' })
    }

    const user = await User.findById(req.params.id)
      .populate('college', 'name type')
      .select('-password')

    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    res.json({ user })
  } catch (error) {
    console.error('Get user by id error:', error)
    res.status(500).json({ message: 'Failed to fetch user' })
  }
}

exports.createUserByAdmin = async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' })
    }

    const {
      name,
      email,
      password,
      role = 'user',
      emailVerified = true,
      course,
      yearOfStudy,
      skills,
      primaryCategory,
      phone,
      showContactToTeam
    } = req.body

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required' })
    }

    if (!emailIsValid(email)) {
      return res.status(400).json({ message: 'Enter a valid email' })
    }

    if (!passwordIsStrong(password)) {
      return res.status(400).json({
        message: 'Password must be 8+ chars and include uppercase, lowercase, number, and symbol'
      })
    }

    const existing = await User.findOne({ email: email.toLowerCase().trim() })
    if (existing) {
      return res.status(409).json({ message: 'Email already registered' })
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      role: role === 'admin' ? 'admin' : 'user',
      emailVerified: Boolean(emailVerified),
      course: course?.trim() || '',
      yearOfStudy: yearOfStudy || '',
      skills: Array.isArray(skills) ? skills : skills ? [skills] : [],
      primaryCategory: primaryCategory || '',
      phone: phone ? phone.toString().trim() : '',
      showContactToTeam: Boolean(showContactToTeam)
    })

    res.status(201).json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified
      }
    })
  } catch (error) {
    console.error('Create user by admin error:', error)
    res.status(500).json({ message: 'Failed to create user' })
  }
}

exports.updateUserByAdmin = async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' })
    }

    const user = await User.findById(req.params.id)
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    const {
      name,
      role,
      emailVerified,
      points,
      course,
      yearOfStudy,
      skills,
      primaryCategory,
      phone,
      showContactToTeam
    } = req.body

    if (name !== undefined) user.name = name.toString().trim()
    if (role) user.role = role === 'admin' ? 'admin' : 'user'
    if (emailVerified !== undefined) user.emailVerified = Boolean(emailVerified)
    if (points !== undefined && Number.isFinite(Number(points))) user.points = Number(points)
    if (course !== undefined) user.course = course ? course.toString().trim() : ''
    if (yearOfStudy !== undefined) user.yearOfStudy = yearOfStudy || ''
    if (skills !== undefined) user.skills = Array.isArray(skills) ? skills : skills ? [skills] : []
    if (primaryCategory !== undefined) user.primaryCategory = primaryCategory || ''
    if (phone !== undefined) user.phone = phone ? phone.toString().trim() : ''
    if (showContactToTeam !== undefined) user.showContactToTeam = Boolean(showContactToTeam)

    await user.save()

    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
        points: user.points
      }
    })
  } catch (error) {
    console.error('Update user by admin error:', error)
    res.status(500).json({ message: 'Failed to update user' })
  }
}

exports.deleteUserByAdmin = async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' })
    }

    const user = await User.findById(req.params.id)
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    const Project = require('../models/Project')
    const ownedCount = await Project.countDocuments({ owner: user._id })
    if (ownedCount > 0) {
      return res.status(400).json({
        message: 'User owns projects. Transfer ownership or delete those projects first.'
      })
    }

    await Project.updateMany(
      { teamMembers: user._id },
      { $pull: { teamMembers: user._id, interestedUsers: user._id } }
    )

    await user.deleteOne()

    res.json({ message: 'User deleted' })
  } catch (error) {
    console.error('Delete user by admin error:', error)
    res.status(500).json({ message: 'Failed to delete user' })
  }
}

exports.getUserActivity = async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' })
    }

    const { activeWithin } = req.query
    const now = Date.now()
    let activeSince = null
    if (activeWithin) {
      const minutes = Number(activeWithin)
      if (!Number.isFinite(minutes) || minutes <= 0) {
        return res.status(400).json({ message: 'activeWithin must be a positive number of minutes' })
      }
      activeSince = new Date(now - minutes * 60 * 1000)
    }

    const userQuery = activeSince ? { lastActive: { $gte: activeSince } } : {}
    const users = await User.find(userQuery)
      .select('name email role lastActive points')
      .sort({ lastActive: -1 })

    const userIds = users.map((user) => user._id)
    const Project = require('../models/Project')
    const activeProjects = await Project.find({
      'buildPhase.isActive': true,
      $or: [
        { owner: { $in: userIds } },
        { teamMembers: { $in: userIds } }
      ]
    }).select('title owner teamMembers buildPhase.lastActivity')

    const buildInactivityMap = {}
    activeProjects.forEach((project) => {
      const lastActivity = project.buildPhase?.lastActivity
      const lastMs = lastActivity ? new Date(lastActivity).getTime() : null
      const inactiveForMinutes = lastMs ? Math.round((now - lastMs) / 60000) : null
      const inactiveForHours = lastMs ? Math.round((now - lastMs) / 3600000) : null

      const participants = [
        project.owner?.toString(),
        ...(project.teamMembers || []).map((id) => id.toString())
      ].filter(Boolean)

      participants.forEach((userId) => {
        if (!buildInactivityMap[userId]) {
          buildInactivityMap[userId] = []
        }
        buildInactivityMap[userId].push({
          projectId: project._id,
          title: project.title,
          lastActivity,
          inactiveForMinutes,
          inactiveForHours,
          role: project.owner?.toString() === userId ? 'owner' : 'member'
        })
      })
    })

    const data = users.map((user) => {
      const lastActive = user.lastActive ? new Date(user.lastActive) : null
      const inactiveForMinutes = lastActive ? Math.round((now - lastActive.getTime()) / 60000) : null
      const inactiveForHours = lastActive ? Math.round((now - lastActive.getTime()) / 3600000) : null
      const buildInactivity = buildInactivityMap[user._id.toString()] || []

      return {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        points: user.points,
        lastActive,
        inactiveForMinutes,
        inactiveForHours,
        buildInactivity
      }
    })

    res.json({ users: data })
  } catch (error) {
    console.error('Get user activity error:', error)
    res.status(500).json({ message: 'Failed to fetch user activity' })
  }
}

exports.getAdminStats = async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' })
    }

    const Project = require('../models/Project')
    const now = Date.now()
    const signupWindowDays = 7
    const signupSince = new Date(now - signupWindowDays * 24 * 60 * 60 * 1000)

    const [totalUsers, activeProjects, newSignups, validationAgg] = await Promise.all([
      User.countDocuments({}),
      Project.countDocuments({ status: { $ne: 'archived' } }),
      User.countDocuments({ createdAt: { $gte: signupSince } }),
      Project.aggregate([
        {
          $group: {
            _id: null,
            totalReviews: { $sum: { $ifNull: ['$validation.currentReviews', 0] } }
          }
        }
      ])
    ])

    const validationsRun = validationAgg?.[0]?.totalReviews || 0

    res.json({
      stats: {
        totalUsers,
        activeProjects,
        validationsRun,
        newSignups,
        signupWindowDays
      }
    })
  } catch (error) {
    console.error('Get admin stats error:', error)
    res.status(500).json({ message: 'Failed to fetch admin stats' })
  }
}
