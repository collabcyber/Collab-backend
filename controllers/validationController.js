const Project = require('../models/Project')
const { createNotification } = require('./notificationController')
const { applyUserStats, POINTS } = require('../utils/points')
const { updateLifecycleStage } = require('../utils/ventureLifecycle')

const RATING_KEYS = [
  'problemClarity',
  'userPainSeverity',
  'solutionFit',
  'innovation',
  'usefulness',
  'executionReadiness',
  'feasibility30Days',
  'evidenceStrength',
  'scalabilityPotential',
  'teamReadiness',
  'confidence'
]

const CORE_KEYS = [
  'problemClarity',
  'solutionFit',
  'usefulness',
  'executionReadiness',
  'feasibility30Days',
  'evidenceStrength'
]

const DIMENSION_KEYS = ['desirability', 'feasibility', 'differentiation', 'readiness']
const WOULD_USE_OPTIONS = ['yes', 'maybe', 'no']
const VERDICT_OPTIONS = ['pass', 'rework', 'hold']

const roundScore = (value) => Math.round(value * 100) / 100
const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length
const toReadinessScore = (value, fallback = 0) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return Math.max(0, Math.min(100, Math.round(fallback)))
  return Math.max(0, Math.min(100, Math.round(numeric)))
}

const parseScore = (value) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  if (numeric < 1 || numeric > 5) return null
  return numeric
}

const normalizeChoice = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '')
const getRequiredText = (value) => (typeof value === 'string' ? value.trim() : '')

const parseCriteriaPayload = (criteria) => {
  if (!criteria || typeof criteria !== 'object') {
    return { valid: false, message: 'Validation scorecard is required' }
  }

  const parsed = {}
  for (const key of RATING_KEYS) {
    const parsedValue = parseScore(criteria[key])
    if (parsedValue === null) {
      return { valid: false, message: `${key} rating must be between 1 and 5` }
    }
    parsed[key] = parsedValue
  }

  const wouldUse = normalizeChoice(criteria.wouldUse)
  if (!WOULD_USE_OPTIONS.includes(wouldUse)) {
    return { valid: false, message: 'wouldUse must be one of yes/maybe/no' }
  }
  parsed.wouldUse = wouldUse

  const finalVerdict = normalizeChoice(criteria.finalVerdict)
  if (!VERDICT_OPTIONS.includes(finalVerdict)) {
    return { valid: false, message: 'finalVerdict must be pass/rework/hold' }
  }
  parsed.finalVerdict = finalVerdict

  return { valid: true, parsed }
}

const deriveReviewMetrics = (criteria) => {
  const wouldUseScoreMap = { yes: 5, maybe: 3, no: 1 }
  const verdictScoreMap = { pass: 5, rework: 3, hold: 1 }

  const desirability = average([
    criteria.problemClarity,
    criteria.userPainSeverity,
    criteria.solutionFit,
    criteria.usefulness,
    wouldUseScoreMap[criteria.wouldUse]
  ])
  const feasibility = average([
    criteria.executionReadiness,
    criteria.feasibility30Days,
    criteria.teamReadiness
  ])
  const differentiation = average([
    criteria.innovation,
    criteria.scalabilityPotential
  ])
  const readiness = average([
    criteria.evidenceStrength,
    criteria.executionReadiness,
    criteria.confidence
  ])

  const weightedOverall = (
    criteria.problemClarity * 0.12 +
    criteria.userPainSeverity * 0.1 +
    criteria.solutionFit * 0.14 +
    criteria.innovation * 0.08 +
    criteria.usefulness * 0.12 +
    criteria.executionReadiness * 0.12 +
    criteria.feasibility30Days * 0.09 +
    criteria.evidenceStrength * 0.08 +
    criteria.scalabilityPotential * 0.07 +
    criteria.teamReadiness * 0.04 +
    criteria.confidence * 0.04
  )

  return {
    rating: roundScore(weightedOverall),
    dimensions: {
      desirability: roundScore(desirability),
      feasibility: roundScore(feasibility),
      differentiation: roundScore(differentiation),
      readiness: roundScore(readiness)
    },
    verdictScore: verdictScoreMap[criteria.finalVerdict]
  }
}

const buildFailureSummary = ({ averageRating, criteriaAverages, dimensionAverages, signalBreakdown, reviewsRequired }) => {
  const passShare = reviewsRequired > 0
    ? roundScore(((signalBreakdown.verdict.pass || 0) / reviewsRequired) * 100)
    : 0
  const holdShare = reviewsRequired > 0
    ? roundScore(((signalBreakdown.verdict.hold || 0) / reviewsRequired) * 100)
    : 0
  const useIntentShare = reviewsRequired > 0
    ? roundScore((((signalBreakdown.wouldUse.yes || 0) + (signalBreakdown.wouldUse.maybe || 0)) / reviewsRequired) * 100)
    : 0

  const weakestCriteria = CORE_KEYS
    .map((key) => ({ key, value: criteriaAverages[key] || 0 }))
    .sort((a, b) => a.value - b.value)
    .slice(0, 3)
    .map((item) => `${item.key} ${item.value}/5`)

  const weakestDimensions = DIMENSION_KEYS
    .map((key) => ({ key, value: dimensionAverages[key] || 0 }))
    .sort((a, b) => a.value - b.value)
    .slice(0, 2)
    .map((item) => `${item.key} ${item.value}/5`)

  const recommendation = averageRating < 3 || holdShare >= 35
    ? 'Recommendation: major rework needed before re-submission.'
    : 'Recommendation: use the 7-day extension, fix these gaps, and re-submit.'

  return [
    `Validation scorecard did not pass after ${reviewsRequired} reviews.`,
    `Overall ${averageRating}/5 (target >= 3.8).`,
    `Pass votes ${passShare}%, hold votes ${holdShare}%, likely-user intent ${useIntentShare}%.`,
    `Weak criteria: ${weakestCriteria.join(', ')}.`,
    `Weak dimensions: ${weakestDimensions.join(', ')}.`,
    recommendation
  ].join(' ')
}

exports.listValidations = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query
    const parsedLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20))
    const parsedPage = Math.max(1, parseInt(page, 10) || 1)

    const filter = { 'validation.validationStatus': 'in_review' }
    const projects = await Project.find(filter)
      .populate('owner', 'name')
      .sort({ updatedAt: -1 })
      .limit(parsedLimit)
      .skip((parsedPage - 1) * parsedLimit)

    const total = await Project.countDocuments(filter)

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
    res.status(500).json({ message: 'Failed to fetch validation ventures' })
  }
}

exports.submitValidation = async (req, res) => {
  try {
    const {
      projectId,
      feedback,
      topStrengths,
      topGaps,
      biggestRisk,
      next7DayAction,
      criteria
    } = req.body
    const reviewerId = req.user?.userId

    if (!reviewerId) {
      return res.status(401).json({ message: 'Unauthorized' })
    }

    if (!projectId) {
      return res.status(400).json({ message: 'projectId is required' })
    }

    const parsedCriteria = parseCriteriaPayload(criteria)
    if (!parsedCriteria.valid) {
      return res.status(400).json({ message: parsedCriteria.message })
    }

    const normalizedFeedback = getRequiredText(feedback)
    const normalizedStrengths = getRequiredText(topStrengths)
    const normalizedGaps = getRequiredText(topGaps)
    const normalizedRisk = getRequiredText(biggestRisk)
    const normalizedAction = getRequiredText(next7DayAction)

    if (!normalizedFeedback) {
      return res.status(400).json({ message: 'Feedback is required' })
    }
    if (!normalizedStrengths) {
      return res.status(400).json({ message: 'Top strengths are required' })
    }
    if (!normalizedGaps) {
      return res.status(400).json({ message: 'Top gaps are required' })
    }
    if (!normalizedRisk) {
      return res.status(400).json({ message: 'Biggest risk is required' })
    }
    if (!normalizedAction) {
      return res.status(400).json({ message: 'One 7-day action is required' })
    }

    const project = await Project.findById(projectId)
    if (!project) {
      return res.status(404).json({ message: 'Venture not found' })
    }

    if (project.validation?.validationStatus !== 'in_review') {
      return res.status(400).json({ message: 'Venture is not in validation' })
    }

    const reviewerIdString = reviewerId.toString()
    if (project.owner?.toString() === reviewerIdString) {
      return res.status(400).json({ message: 'Owners cannot review their own venture' })
    }

    const teamIds = (project.teamMembers || []).map((id) => id.toString())
    if (teamIds.includes(reviewerIdString)) {
      return res.status(400).json({ message: 'Team contributors cannot review their own venture' })
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

    const derived = deriveReviewMetrics(parsedCriteria.parsed)

    project.validation.reviews.push({
      reviewer: reviewerId,
      rating: derived.rating,
      criteria: parsedCriteria.parsed,
      feedback: normalizedFeedback,
      topStrengths: normalizedStrengths,
      topGaps: normalizedGaps,
      biggestRisk: normalizedRisk,
      next7DayAction: normalizedAction
    })

    const currentReviews = project.validation.currentReviews || 0
    const currentAverage = project.validation.averageRating || 0
    const newReviewCount = currentReviews + 1

    project.validation.currentReviews = newReviewCount
    project.validation.averageRating = roundScore(
      ((currentAverage * currentReviews) + derived.rating) / newReviewCount
    )

    const currentCriteriaAverages = project.validation.criteriaAverages || {}
    const criteriaAverages = {
      ...currentCriteriaAverages
    }
    for (const key of RATING_KEYS) {
      const existing = Number(currentCriteriaAverages[key]) || 0
      criteriaAverages[key] = roundScore(
        ((existing * currentReviews) + parsedCriteria.parsed[key]) / newReviewCount
      )
    }
    project.validation.criteriaAverages = criteriaAverages

    const currentDimensionAverages = project.validation.dimensionAverages || {}
    const dimensionAverages = {
      ...currentDimensionAverages
    }
    for (const key of DIMENSION_KEYS) {
      const existing = Number(currentDimensionAverages[key]) || 0
      dimensionAverages[key] = roundScore(
        ((existing * currentReviews) + derived.dimensions[key]) / newReviewCount
      )
    }
    project.validation.dimensionAverages = dimensionAverages

    const currentSignals = project.validation.signalBreakdown || {}
    const signalBreakdown = {
      wouldUse: {
        yes: Number(currentSignals?.wouldUse?.yes) || 0,
        maybe: Number(currentSignals?.wouldUse?.maybe) || 0,
        no: Number(currentSignals?.wouldUse?.no) || 0
      },
      verdict: {
        pass: Number(currentSignals?.verdict?.pass) || 0,
        rework: Number(currentSignals?.verdict?.rework) || 0,
        hold: Number(currentSignals?.verdict?.hold) || 0
      }
    }
    signalBreakdown.wouldUse[parsedCriteria.parsed.wouldUse] += 1
    signalBreakdown.verdict[parsedCriteria.parsed.finalVerdict] += 1
    project.validation.signalBreakdown = signalBreakdown

    project.validation.validationStatus = project.validation.validationStatus || 'pending'

    const reviewsRequired = project.validation.reviewsRequired || 30
    let awardCompletionPoints = false

    if (newReviewCount >= reviewsRequired) {
      const passShare = (signalBreakdown.verdict.pass || 0) / newReviewCount
      const likelyUserShare = ((signalBreakdown.wouldUse.yes || 0) + (signalBreakdown.wouldUse.maybe || 0)) / newReviewCount
      const lowestCoreScore = Math.min(...CORE_KEYS.map((key) => Number(criteriaAverages[key]) || 0))
      const meetsThreshold = (
        project.validation.averageRating >= 3.8 &&
        (dimensionAverages.desirability || 0) >= 3.5 &&
        (dimensionAverages.feasibility || 0) >= 3.3 &&
        lowestCoreScore >= 3 &&
        passShare >= 0.55 &&
        likelyUserShare >= 0.7
      )

      if (meetsThreshold) {
        project.validation.validationStatus = 'passed'
        project.validation.validatedAt = new Date()
        project.validation.featuredAt = new Date()
        project.validation.lastFailureReason = undefined
        updateLifecycleStage(project, 'incubation_ready')
        project.momentumStatus = 'preparing_launch'
        project.teamCheckIn = {
          status: 'preparing_launch',
          note: 'Validation passed. Venture is now incubation-ready.',
          updatedAt: new Date(),
          updatedBy: reviewerId
        }
        project.readinessScore = toReadinessScore(
          Math.max(
            Number(project.readinessScore || 0),
            Number(project.validation.averageRating || 0) * 20,
            85
          ),
          project.readinessScore
        )
        if (!project.validation.completionAwarded) {
          awardCompletionPoints = true
          project.validation.completionAwarded = true
        }
      } else {
        project.validation.validationStatus = 'failed'
        project.validation.validatedAt = undefined
        project.validation.featuredAt = undefined
        updateLifecycleStage(project, 'pivoted')
        project.momentumStatus = 'facing_blockers'
        project.validation.lastFailureReason = buildFailureSummary({
          averageRating: project.validation.averageRating,
          criteriaAverages,
          dimensionAverages,
          signalBreakdown,
          reviewsRequired: newReviewCount
        })
        project.teamCheckIn = {
          status: 'facing_blockers',
          note: 'Validation failed. Rework core gaps and resubmit.',
          updatedAt: new Date(),
          updatedBy: reviewerId
        }
        project.readinessScore = toReadinessScore(
          Math.min(Number(project.readinessScore || 0), 55),
          project.readinessScore
        )
      }
    }

    await project.save()

    if (awardCompletionPoints) {
      await applyUserStats(project.owner, {
        points: POINTS.complete_project,
        inc: { projectsCompleted: 1 }
      })
    }

    await applyUserStats(reviewerId, {
      points: POINTS.validation_given,
      inc: { validationsGiven: 1 }
    })

    await createNotification(
      project.owner,
      'validation_feedback',
      'New validation feedback',
      `Your venture ${project.title} received new scorecard feedback.`,
      project._id,
      reviewerId,
      false,
      `/project/${project._id}`
    )

    if (project.validation.validationStatus === 'passed') {
      await createNotification(
        project.owner,
        'project_featured',
        'Venture validated',
        `${project.title} has passed validation and is now incubation-ready.`,
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
        'Validation outcome: rework required',
        project.validation.lastFailureReason || `${project.title} did not pass the validation scorecard.`,
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
      readinessScore: project.readinessScore,
      lifecycleStage: project.lifecycleStage,
      momentumStatus: project.momentumStatus,
      criteriaAverages: project.validation.criteriaAverages,
      dimensionAverages: project.validation.dimensionAverages,
      signalBreakdown: project.validation.signalBreakdown,
      lastFailureReason: project.validation.lastFailureReason,
      validationStatus: project.validation.validationStatus
    })
  } catch (error) {
    console.error('Submit validation error:', error)
    res.status(500).json({ message: 'Failed to submit validation feedback' })
  }
}
