const mongoose = require('mongoose')
const { VENTURE_LIFECYCLE } = require('../utils/ventureLifecycle')

const MilestoneSchema = new mongoose.Schema({
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 180
  },
  description: {
    type: String,
    default: '',
    trim: true,
    maxlength: 4000
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  lifecycleStage: {
    type: String,
    enum: VENTURE_LIFECYCLE,
    default: 'idea'
  },
  dueDate: {
    type: Date
  },
  dependencies: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Milestone'
  }],
  blockers: [{
    type: String,
    trim: true,
    maxlength: 300
  }],
  blockerDetails: [{
    blockerId: { type: String, required: true },
    type: {
      type: String,
      enum: ['technical', 'design', 'validation', 'team', 'contributor'],
      default: 'technical'
    },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    status: {
      type: String,
      enum: ['open', 'resolved'],
      default: 'open'
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now },
    resolvedAt: { type: Date }
  }],
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'blocked'],
    default: 'pending'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  completedAt: {
    type: Date
  }
}, { timestamps: true })

MilestoneSchema.index({ projectId: 1, status: 1, dueDate: 1 })
MilestoneSchema.index({ projectId: 1, lifecycleStage: 1, priority: 1 })

module.exports = mongoose.model('Milestone', MilestoneSchema)
