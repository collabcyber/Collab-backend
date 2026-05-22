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
    enum: ['strong_momentum', 'facing_blockers', 'needs_team_decision', 'need_contributors', 'pivoting', 'preparing_launch'],
    default: 'needs_team_decision'
  },
  teamCheckIn: {
    status: {
      type: String,
      enum: ['strong_momentum', 'facing_blockers', 'needs_team_decision', 'need_contributors', 'pivoting', 'preparing_launch']
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
      whoSpokenTo: { type: String, default: '' },
      repeatedProblems: { type: String, default: '' },
      surprisingInsights: { type: String, default: '' },
      useOrPaySignal: { type: String, default: '' },
      feedbackChanges: { type: String, default: '' },
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
          enum: ['screenshot', 'survey_pdf', 'interview_notes', 'feedback_form', 'recording', 'testing_proof', 'survey', 'interview', 'waitlist', 'feedback', 'experiment', 'insight', 'other'],
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
  if (this.momentumStatus === 'need_contributors') {
    this.momentumStatus = 'needs_team_decision'
  }
  if (this.teamCheckIn?.status === 'need_contributors') {
    this.teamCheckIn.status = 'needs_team_decision'
  }
  next()
})

// Indexes for performance
ProjectSchema.index({ category: 1, lifecycleStage: 1 })
ProjectSchema.index({ owner: 1, createdAt: -1 })
ProjectSchema.index({ 'validation.validationStatus': 1, updatedAt: -1 })
ProjectSchema.index({ visibility: 1, college: 1 })

module.exports = mongoose.model('Project', ProjectSchema)
