const Project = require('../models/Project')
const { createNotification } = require('./notificationController')
const { applyUserStats, POINTS } = require('../utils/points')

exports.listValidations = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query
    const parsedLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20))
    const parsedPage = Math.max(1, parseInt(page, 10) || 1)

    const projects = await Project.find({ status: 'validation' })
      .populate('owner', 'name')
      .sort({ updatedAt: -1 })
      .limit(parsedLimit)
      .skip((parsedPage - 1) * parsedLimit)

    const total = await Project.countDocuments({ status: 'validation' })

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
    console.error('List validations error:', error)
    res.status(500).json({ message: 'Failed to fetch validation projects' })
  }
}

exports.submitValidation = async (req, res) => {
  try {
    const { projectId, rating, feedback } = req.body
    const reviewerId = req.user?.userId

    if (!reviewerId) {
      return res.status(401).json({ message: 'Unauthorized' })
    }

    if (!projectId) {
      return res.status(400).json({ message: 'projectId is required' })
    }

    const numericRating = Number(rating)
    if (!Number.isFinite(numericRating) || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({ message: 'Rating must be between 1 and 5' })
    }

    if (!feedback || !feedback.trim()) {
      return res.status(400).json({ message: 'Feedback is required' })
    }

    const project = await Project.findById(projectId)
    if (!project) {
      return res.status(404).json({ message: 'Project not found' })
    }

    if (project.status !== 'validation') {
      return res.status(400).json({ message: 'Project is not in validation' })
    }

    const reviewerIdString = reviewerId.toString()
    if (project.owner?.toString() === reviewerIdString) {
      return res.status(400).json({ message: 'Owners cannot review their own project' })
    }

    const teamIds = (project.teamMembers || []).map((id) => id.toString())
    if (teamIds.includes(reviewerIdString)) {
      return res.status(400).json({ message: 'Team members cannot review their own project' })
    }

    if (!project.validation) {
      project.validation = {}
    }

    if (!Array.isArray(project.validation.reviews)) {
      project.validation.reviews = []
    }

    const alreadyReviewed = project.validation.reviews.some((review) =>
      review.reviewer?.toString() === reviewerIdString
    )

    if (alreadyReviewed) {
      return res.status(400).json({ message: 'You have already submitted feedback' })
    }

    project.validation.reviews.push({
      reviewer: reviewerId,
      rating: numericRating,
      feedback: feedback.trim()
    })

    const currentReviews = project.validation.currentReviews || 0
    const currentAverage = project.validation.averageRating || 0
    const newReviewCount = currentReviews + 1
    const newAverage = ((currentAverage * currentReviews) + numericRating) / newReviewCount

    project.validation.currentReviews = newReviewCount
    project.validation.averageRating = Math.round(newAverage * 100) / 100
    project.validation.validationStatus = project.validation.validationStatus || 'pending'

    const reviewsRequired = project.validation.reviewsRequired || 30
    if (newReviewCount >= reviewsRequired) {
      if (project.validation.averageRating >= 3.5) {
        project.validation.validationStatus = 'passed'
        project.validation.validatedAt = new Date()
        project.validation.featuredAt = new Date()
        project.status = 'validated'
      } else {
        project.validation.validationStatus = 'failed'
        project.status = 'archived'
      }
    }

    await project.save()

    await applyUserStats(reviewerId, {
      points: POINTS.validation_given,
      inc: { validationsGiven: 1 }
    })

    await createNotification(
      project.owner,
      'validation_feedback',
      'New validation feedback',
      `Your project ${project.title} received new feedback.`,
      project._id,
      reviewerId,
      false,
      `/project/${project._id}`
    )

    if (project.validation.validationStatus === 'passed') {
      await createNotification(
        project.owner,
        'project_featured',
        'Project validated',
        `${project.title} has been validated and featured!`,
        project._id,
        reviewerId,
        false,
        `/project/${project._id}`
      )
    }

    if (project.validation.validationStatus === 'failed') {
      await createNotification(
        project.owner,
        'validation_feedback',
        'Project did not pass validation',
        `${project.title} did not reach the minimum rating.`,
        project._id,
        reviewerId,
        false,
        `/project/${project._id}`
      )
    }

    res.status(201).json({
      message: 'Feedback submitted',
      projectId: project._id,
      currentReviews: project.validation.currentReviews,
      averageRating: project.validation.averageRating,
      validationStatus: project.validation.validationStatus
    })
  } catch (error) {
    console.error('Submit validation error:', error)
    res.status(500).json({ message: 'Failed to submit validation feedback' })
  }
}
