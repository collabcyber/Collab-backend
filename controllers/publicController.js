const User = require('../models/User')
const Project = require('../models/Project')
const Certificate = require('../models/Certificate')

exports.getPublicStats = async (req, res) => {
  try {
    const windowDays = 30
    const activeSince = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)

    const [activeUsers, totalProjects] = await Promise.all([
      User.countDocuments({ lastActive: { $gte: activeSince } }),
      Project.countDocuments({ lifecycleStage: { $ne: 'archived' } })
    ])

    res.json({
      stats: {
        activeUsers,
        totalProjects,
        activeUsersWindowDays: windowDays
      }
    })
  } catch (error) {
    console.error('Public stats error:', error)
    res.status(500).json({ message: 'Failed to load stats' })
  }
}

exports.getCertificate = async (req, res) => {
  try {
    const { certificateId } = req.params
    if (!certificateId) {
      return res.status(400).json({ message: 'Certificate id is required' })
    }

    const certificate = await Certificate.findOne({ certificateId })
      .populate('user', 'name')
      .populate('project', 'title')
      .populate('college', 'name')

    if (certificate) {
      const apiBase = (process.env.PUBLIC_API_BASE || 'https://api.collab.qzz.io').replace(/\/$/, '')
      const downloadUrl = `${apiBase}${certificate.url}`
      return res.json({
        certificate: {
          certificateId: certificate.certificateId,
          issuedAt: certificate.issuedAt,
          downloadUrl,
          user: certificate.user ? {
            id: certificate.user._id || certificate.user,
            name: certificate.user.name || certificate.userName || 'Team Contributor'
          } : undefined,
          project: certificate.project ? {
            id: certificate.project._id || certificate.project,
            title: certificate.project.title || certificate.projectTitle
          } : {
            id: certificate.project,
            title: certificate.projectTitle
          },
          college: certificate.college?.name || certificate.collegeName || null
        }
      })
    }

    const project = await Project.findOne({
      'validation.certificates.certificateId': certificateId
    })
      .populate('validation.certificates.user', 'name')
      .populate('college', 'name')

    if (!project || !project.validation?.certificates) {
      return res.status(404).json({ message: 'Certificate not found' })
    }

    const cert = project.validation.certificates.find(
      (item) => item.certificateId === certificateId
    )

    if (!cert) {
      return res.status(404).json({ message: 'Certificate not found' })
    }

    const apiBase = (process.env.PUBLIC_API_BASE || 'https://api.collab.qzz.io').replace(/\/$/, '')
    const downloadUrl = `${apiBase}${cert.url}`

    res.json({
      certificate: {
        certificateId: cert.certificateId,
        issuedAt: cert.issuedAt,
        downloadUrl,
        user: cert.user ? {
          id: cert.user._id || cert.user,
          name: cert.user.name || 'Team Contributor'
        } : undefined,
        project: {
          id: project._id,
          title: project.title
        },
        college: project.college?.name || null
      }
    })
  } catch (error) {
    console.error('Public certificate error:', error)
    res.status(500).json({ message: 'Failed to load certificate' })
  }
}
