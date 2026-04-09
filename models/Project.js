const mongoose = require('mongoose')

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
    enum: ['college', 'global'],
    default: 'college'
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
  
  // Project Status & Team
  status: { 
    type: String, 
    required: true,
    enum: ['planning', 'building', 'completed', 'validation', 'validated', 'archived'],
    default: 'planning'
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
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date },
    isActive: { type: Boolean, default: true },
    lastActivity: { type: Date, default: Date.now },
    lastPenaltyAt: { type: Date }
  },
  
  // Validation System
  validation: {
    reviewsRequired: { type: Number, default: 30 },
    currentReviews: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
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
      feedback: { type: String, required: true },
      helpful: { type: Boolean, default: false },
      createdAt: { type: Date, default: Date.now }
    }],
    validationStatus: { 
      type: String, 
      enum: ['pending', 'passed', 'failed'],
      default: 'pending'
    },
    certificates: [{
      certificateId: { type: String, required: true },
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      url: { type: String, required: true },
      filename: { type: String, required: true },
      issuedAt: { type: Date, default: Date.now }
    }],
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

// Indexes for performance
ProjectSchema.index({ category: 1, status: 1 })
ProjectSchema.index({ owner: 1, createdAt: -1 })
ProjectSchema.index({ 'validation.validationStatus': 1, 'validation.averageRating': -1 })
ProjectSchema.index({ visibility: 1, college: 1 })

module.exports = mongoose.model('Project', ProjectSchema)
