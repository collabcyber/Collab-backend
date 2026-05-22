const User = require('../models/User')
const College = require('../models/College')
const Project = require('../models/Project')
const Milestone = require('../models/Milestone')
const ContributionLog = require('../models/ContributionLog')
const bcrypt = require('bcryptjs')
const { normalizeLifecycleFilter } = require('../utils/ventureLifecycle')

const normalizeLabel = (value) => {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

const normalizeStringList = (value) => {
  const list = Array.isArray(value) ? value : value ? [value] : []
  const normalized = list
    .map((item) => normalizeLabel(typeof item === 'string' ? item : String(item)))
    .filter(Boolean)
  return [...new Set(normalized)]
}

const normalizeCommitment = (value) => {
  const valid = new Set(['Exploring', 'Casual Contributor', 'Serious Builder', 'Startup Founder'])
  return valid.has(value) ? value : 'Exploring'
}

const toExecutionProfile = (profile = {}) => ({
  goals: Array.isArray(profile.goals) ? profile.goals : [],
  roles: Array.isArray(profile.roles) ? profile.roles : [],
  commitmentLevel: profile.commitmentLevel || 'Exploring',
  industryInterests: Array.isArray(profile.industryInterests) ? profile.industryInterests : [],
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
      sprintStatus: user.sprintStatus || 'none',
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
      role: user.role,
      executionProfile: toExecutionProfile(user.executionProfile)
    })
  } catch (error) {
    console.error('Get execution profile error:', error)
    res.status(500).json({ message: 'Failed to fetch execution profile' })
  }
}

exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.userId
    const {
      name,
      course,
      yearOfStudy,
      skills,
      primaryCategory,
      showContactToTeam,
      phone,
      userGoal,
      executionRoles,
      industryInterests,
      commitmentLevel
    } = req.body

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
    if (!user.executionProfile) user.executionProfile = {}

    if (userGoal !== undefined) {
      const goal = typeof userGoal === 'string' ? userGoal.trim().slice(0, 180) : ''
      user.executionProfile.goals = goal ? [goal] : []
    }
    if (executionRoles !== undefined) {
      user.executionProfile.roles = normalizeStringList(executionRoles).slice(0, 10)
    }
    if (industryInterests !== undefined) {
      user.executionProfile.industryInterests = normalizeStringList(industryInterests).slice(0, 15)
    }
    if (commitmentLevel !== undefined) {
      user.executionProfile.commitmentLevel = normalizeCommitment(commitmentLevel)
    }

    await user.save()

    res.json({ message: 'Execution Profile updated successfully' })
  } catch (error) {
    console.error('Update execution profile error:', error)
    res.status(500).json({ message: 'Failed to update execution profile' })
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

exports.getExecutionProfile = async (req, res) => {
  try {
    const userId = req.user.userId
    const user = await User.findById(userId)
      .populate('college', 'name type')
      .lean()
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    const projects = await Project.find({ $or: [{ owner: userId }, { teamMembers: userId }] })
      .select('title shortPitch lifecycleStage readinessScore momentumStatus owner teamMembers rolesNeeded updatedAt createdAt validation')
      .sort({ updatedAt: -1 })
      .lean()
    const projectIds = projects.map((project) => project._id)

    const [milestones, logs] = await Promise.all([
      Milestone.find({ projectId: { $in: projectIds } })
        .populate('projectId', 'title lifecycleStage')
        .populate('owner', 'name email')
        .lean(),
      ContributionLog.find({ contributor: userId })
        .populate('projectId', 'title lifecycleStage')
        .sort({ timestamp: -1 })
        .limit(100)
        .lean()
    ])

    const ownedMilestones = milestones.filter((milestone) => String(milestone.owner?._id || milestone.owner || '') === String(userId))
    const completedMilestones = ownedMilestones.filter((milestone) => milestone.status === 'completed')
    const resolvedBlockers = milestones.reduce((total, milestone) => {
      const resolved = (milestone.blockerDetails || []).filter((blocker) =>
        blocker.status === 'resolved' && String(blocker.createdBy || '') === String(userId)
      ).length
      return total + resolved
    }, 0)

    const activeDays = new Set(
      logs
        .filter((log) => log.timestamp)
        .map((log) => new Date(log.timestamp).toISOString().slice(0, 10))
    ).size
    const consistency = Math.min(100, Math.round((activeDays / 30) * 100))
    const reliability = ownedMilestones.length
      ? Math.round((completedMilestones.length / ownedMilestones.length) * 100)
      : Math.min(100, logs.length * 5)
    const progressionImpact = projects.reduce((sum, project) => sum + Number(project.readinessScore || 0), 0)
    const avgReadinessImpact = projects.length ? Math.round(progressionImpact / projects.length) : 0
    const collaborationQuality = Math.min(100, Math.round((Number(user.helpfulFeedback || 0) * 12) + (logs.length * 2)))
    const executionCredibility = Math.min(100, Math.round(
      (completedMilestones.length * 10)
      + (projects.length * 6)
      + (resolvedBlockers * 8)
      + (consistency * 0.25)
      + (avgReadinessImpact * 0.25)
    ))

    const stageCounts = projects.reduce((acc, project) => {
      const stage = project.lifecycleStage || 'idea'
      acc[stage] = (acc[stage] || 0) + 1
      return acc
    }, {})

    const activeVentures = projects.filter((project) => !['archived', 'incubation_ready'].includes(project.lifecycleStage))
    const strengths = [
      completedMilestones.length > 0 ? 'Milestone execution' : '',
      resolvedBlockers > 0 ? 'Blocker resolution' : '',
      logs.length >= 5 ? 'Contribution consistency' : '',
      projects.some((project) => ['mvp', 'growth', 'incubation_ready'].includes(project.lifecycleStage)) ? 'Startup progression' : '',
      user.validationsGiven > 0 ? 'Validation feedback' : ''
    ].filter(Boolean)

    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        college: user.college,
        skills: user.skills || [],
        primaryCategory: user.primaryCategory || '',
        executionProfile: toExecutionProfile(user.executionProfile || {})
      },
      reputation: {
        executionCredibility,
        milestonesCompleted: completedMilestones.length,
        milestonesOwned: ownedMilestones.length,
        venturesContributedTo: projects.length,
        activeVentures: activeVentures.length,
        blockerResolutions: resolvedBlockers,
        contributionConsistency: consistency,
        executionReliability: reliability,
        collaborationQuality,
        ventureProgressionImpact: avgReadinessImpact,
        strengths
      },
      stageCounts,
      activeVentures,
      recentContributions: logs.slice(0, 12),
      completedMilestones: completedMilestones.slice(0, 12)
    })
  } catch (error) {
    console.error('Get execution profile error:', error)
    res.status(500).json({ message: 'Failed to load execution profile' })
  }
}

exports.getUserProjects = async (req, res) => {
  try {
    const userId = req.user.userId
    const { status = 'all', lifecycleStage, page = 1, limit = 10 } = req.query
    const parsedLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 10))
    const parsedPage = Math.max(1, parseInt(page, 10) || 1)

    let query = { $or: [{ owner: userId }, { teamMembers: userId }] }
    
    const lifecycleFilter = lifecycleStage || status
    if (lifecycleFilter !== 'all') {
      query.lifecycleStage = normalizeLifecycleFilter(lifecycleFilter)
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
    console.error('Get user ventures error:', error)
    res.status(500).json({ message: 'Failed to fetch user ventures' })
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
      showContactToTeam,
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
      showContactToTeam: Boolean(showContactToTeam),
      executionProfile: {
        goals: userGoal ? [String(userGoal).trim().slice(0, 180)] : [],
        roles: normalizeStringList(executionRoles).slice(0, 10),
        commitmentLevel: normalizeCommitment(commitmentLevel),
        industryInterests: normalizeStringList(industryInterests).slice(0, 15),
        contributionMetrics: {
          milestonesCompleted: 0,
          contributionConsistency: 0,
          collaborationQuality: 0,
          executionReliability: 0
        },
        startupParticipationTimeline: []
      }
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
      showContactToTeam,
      userGoal,
      executionRoles,
      industryInterests,
      commitmentLevel
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
    if (!user.executionProfile) user.executionProfile = {}
    if (userGoal !== undefined) {
      const goal = String(userGoal || '').trim().slice(0, 180)
      user.executionProfile.goals = goal ? [goal] : []
    }
    if (executionRoles !== undefined) {
      user.executionProfile.roles = normalizeStringList(executionRoles).slice(0, 10)
    }
    if (industryInterests !== undefined) {
      user.executionProfile.industryInterests = normalizeStringList(industryInterests).slice(0, 15)
    }
    if (commitmentLevel !== undefined) {
      user.executionProfile.commitmentLevel = normalizeCommitment(commitmentLevel)
    }

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
        message: 'User owns ventures. Transfer ownership or delete those ventures first.'
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
      Project.countDocuments({ lifecycleStage: { $ne: 'archived' } }),
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
