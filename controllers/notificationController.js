const Notification = require('../models/Notification')
const User = require('../models/User')

exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user.userId
    const { page = 1, limit = 20 } = req.query
    const parsedLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20))
    const parsedPage = Math.max(1, parseInt(page, 10) || 1)

    const notifications = await Notification.find({ recipient: userId })
      .populate('relatedUser', 'name')
      .populate('relatedProject', 'title')
      .sort({ createdAt: -1 })
      .limit(parsedLimit)
      .skip((parsedPage - 1) * parsedLimit)

    const total = await Notification.countDocuments({ recipient: userId })
    const unreadCount = await Notification.countDocuments({ recipient: userId, isRead: false })

    res.json({
      notifications,
      unreadCount,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        pages: Math.ceil(total / parsedLimit)
      }
    })
  } catch (error) {
    console.error('Get notifications error:', error)
    res.status(500).json({ message: 'Failed to fetch notifications' })
  }
}

exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.user.userId

    const notification = await Notification.findOne({ _id: id, recipient: userId })
    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' })
    }

    notification.isRead = true
    await notification.save()

    res.json({ message: 'Notification marked as read' })
  } catch (error) {
    console.error('Mark notification as read error:', error)
    res.status(500).json({ message: 'Failed to mark notification as read' })
  }
}

exports.markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.userId

    await Notification.updateMany(
      { recipient: userId, isRead: false },
      { isRead: true }
    )

    res.json({ message: 'All notifications marked as read' })
  } catch (error) {
    console.error('Mark all notifications as read error:', error)
    res.status(500).json({ message: 'Failed to mark all notifications as read' })
  }
}

exports.createNotification = async (recipient, type, title, message, relatedProject, relatedUser, actionRequired, actionUrl) => {
  try {
    await new Notification({
      recipient,
      type,
      title,
      message,
      relatedProject,
      relatedUser,
      actionRequired: actionRequired || false,
      actionUrl
    }).save()

    return true
  } catch (error) {
    console.error('Create notification error:', error)
    return false
  }
}
