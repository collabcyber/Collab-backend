const mongoose = require('mongoose')
const { VENTURE_LIFECYCLE, inferLifecycleStage } = require('../utils/ventureLifecycle')

const ProjectSchema = new mongoose.Schema({
  // Universal Fields
  title: { type: String, required: true },
  shortPitch: { type: String, required: true, maxlength: 200 },
  description: { type: String, required: true },
  category: { 
    type: String, 
    required: true,
    enum: ['Tech & Product', 'Business & Startup', 'Design & Creative', 'Marketing & Content', 'Services & Operations']
  },
  tags: [{ type: String }],
  rolesNeeded: [{ type: String }],
  skillsRequired: [{ type: String }],
  numberOfTeammates: { type: Number, required: true, min: 1, max: 10 },
  visibility: { 
    type: String, 
    required: true,
    enum: ['private', 'college', 'global'],
    default: 'private'
  },
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College' },
  
  // Category-Specific Fields
  techProduct: {
    problem: String,
    targetUsers: String,
    features: [String],
    techStack: [String]
  },
  businessStartup: {
    marketGap: String,
    targetAudience: String,
    businessModel: String,
    revenueIdea: String
  },
  designCreative: {
    designGoal: String,
    tools: [String],
    deliverables: [String]
  },
  marketingContent: {
    platform: String,
    niche: String,
    contentStrategy: String
  },
  servicesOperations: {
    serviceType: String,
    targetClients: String,
    pricing: String,
    executionPlan: String
  },
  
  // Execution Plan (MANDATORY)
  executionPlan: { type: String, required: true },
  security: {
    ideaFingerprint: { type: String },
    fingerprintAlgorithm: { type: String, default: 'sha256' },
    fingerprintVersion: { type: Number, default: 1 },
    fingerprintedAt: { type: Date }
  },
  
  // Venture Lifecycle
  lifecycleStage: {
    type: String,
    enum: VENTURE_LIFECYCLE,
    default: 'idea'
  },
  readinessScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  momentumStatus: {
    type: String,
    enum: ['strong_momentum', 'facing_blockers', 'need_contributors', 'pivoting', 'preparing_launch'],
    default: 'need_contributors'
  },
  teamCheckIn: {
    status: {
      type: String,
      enum: ['strong_momentum', 'facing_blockers', 'need_contributors', 'pivoting', 'preparing_launch']
    },
    note: { type: String, default: '' },
    updatedAt: { type: Date },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  interestedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  teamMembers: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    joinedAt: { type: Date, default: Date.now }
  }],
  
  // Build Phase
  buildPhase: {
    startDate: { type: Date },
    endDate: { type: Date },
    isActive: { type: Boolean, default: false },
    lastActivity: { type: Date, default: Date.now },
    lastPenaltyAt: { type: Date },
    totalDurationDays: { type: Number, default: 14 },
    isExtendedTimeline: { type: Boolean, default: false },
    extensionCount: { type: Number, default: 0 },
    extensionDaysGranted: { type: Number, default: 0 }
  },
  
  // Validation System
  validation: {
    workspace: {
      problemStatement: { type: String, default: '' },
      targetUsers: { type: String, default: '' },
      coreAssumptions: [{ type: String }],
      tasks: [{
        taskId: { type: String, required: true },
        title: { type: String, required: true },
        status: { type: String, enum: ['pending', 'completed'], default: 'pending' },
        dueDate: { type: Date },
        updatedAt: { type: Date, default: Date.now },
        completedAt: { type: Date }
      }],
      evidence: [{
        evidenceId: { type: String, required: true },
        kind: {
          type: String,
          enum: ['survey', 'interview', 'waitlist', 'feedback', 'experiment', 'insight', 'other'],
          default: 'other'
        },
        title: { type: String, required: true },
        summary: { type: String, default: '' },
        link: { type: String, default: '' },
        createdAt: { type: Date, default: Date.now }
      }],
      confidenceScore: { type: Number, min: 0, max: 100, default: 0 },
      lastFeedbackAt: { type: Date }
    },
    reviewsRequired: { type: Number, default: 30 },
    currentReviews: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
    criteriaAverages: {
      problemClarity: { type: Number, default: 0 },
      userPainSeverity: { type: Number, default: 0 },
      solutionFit: { type: Number, default: 0 },
      innovation: { type: Number, default: 0 },
      usefulness: { type: Number, default: 0 },
      executionReadiness: { type: Number, default: 0 },
      feasibility30Days: { type: Number, default: 0 },
      evidenceStrength: { type: Number, default: 0 },
      scalabilityPotential: { type: Number, default: 0 },
      teamReadiness: { type: Number, default: 0 },
      confidence: { type: Number, default: 0 }
    },
    dimensionAverages: {
      desirability: { type: Number, default: 0 },
      feasibility: { type: Number, default: 0 },
      differentiation: { type: Number, default: 0 },
      readiness: { type: Number, default: 0 }
    },
    signalBreakdown: {
      wouldUse: {
        yes: { type: Number, default: 0 },
        maybe: { type: Number, default: 0 },
        no: { type: Number, default: 0 }
      },
      verdict: {
        pass: { type: Number, default: 0 },
        rework: { type: Number, default: 0 },
        hold: { type: Number, default: 0 }
      }
    },
    demoLink: { type: String },
    demoNotes: { type: String },
    sharedFiles: [{
      originalName: { type: String, required: true },
      filename: { type: String, required: true },
      mimetype: { type: String, required: true },
      size: { type: Number, required: true },
      uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      uploadedAt: { type: Date, default: Date.now }
    }],
    reviews: [{
      reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      rating: { type: Number, min: 1, max: 5, required: true },
      criteria: {
        problemClarity: { type: Number, min: 1, max: 5 },
        userPainSeverity: { type: Number, min: 1, max: 5 },
        solutionFit: { type: Number, min: 1, max: 5 },
        innovation: { type: Number, min: 1, max: 5 },
        usefulness: { type: Number, min: 1, max: 5 },
        executionReadiness: { type: Number, min: 1, max: 5 },
        feasibility30Days: { type: Number, min: 1, max: 5 },
        evidenceStrength: { type: Number, min: 1, max: 5 },
        scalabilityPotential: { type: Number, min: 1, max: 5 },
        teamReadiness: { type: Number, min: 1, max: 5 },
        confidence: { type: Number, min: 1, max: 5 },
        wouldUse: { type: String, enum: ['yes', 'maybe', 'no'] },
        finalVerdict: { type: String, enum: ['pass', 'rework', 'hold'] }
      },
      feedback: { type: String, required: true },
      topStrengths: { type: String },
      topGaps: { type: String },
      biggestRisk: { type: String },
      next7DayAction: { type: String },
      helpful: { type: Boolean, default: false },
      createdAt: { type: Date, default: Date.now }
    }],
    validationStatus: { 
      type: String, 
      enum: ['pending', 'in_review', 'passed', 'failed'],
      default: 'pending'
    },
    certificates: [{
      certificateId: { type: String, required: true },
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      url: { type: String, required: true },
      filename: { type: String, required: true },
      issuedAt: { type: Date, default: Date.now }
    }],
    completionAwarded: { type: Boolean, default: false },
    lastFailureReason: { type: String },
    validatedAt: Date,
    featuredAt: Date
  },
  
  // Messages
  messages: [{
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true },
    createdAt: { type: Date, default: Date.now }
  }],

  // Files
  files: [{
    originalName: { type: String, required: true },
    filename: { type: String, required: true },
    mimetype: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    uploadedAt: { type: Date, default: Date.now }
  }]
}, { timestamps: true })

ProjectSchema.pre('validate', function(next) {
  this.lifecycleStage = inferLifecycleStage(this)
  next()
})

// Indexes for performance
ProjectSchema.index({ category: 1, lifecycleStage: 1 })
ProjectSchema.index({ owner: 1, createdAt: -1 })
ProjectSchema.index({ 'validation.validationStatus': 1, 'validation.averageRating': -1 })
ProjectSchema.index({ visibility: 1, college: 1 })

module.exports = mongoose.model('Project', ProjectSchema)
