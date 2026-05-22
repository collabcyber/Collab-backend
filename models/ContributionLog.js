const mongoose = require('mongoose')

const ContributionLogSchema = new mongoose.Schema({
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
    index: true
  },
  contributor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  milestoneId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Milestone'
  },
  action: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  impact: {
    type: String,
    default: '',
    trim: true,
    maxlength: 1000
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true })

ContributionLogSchema.index({ projectId: 1, timestamp: -1 })
ContributionLogSchema.index({ contributor: 1, timestamp: -1 })
ContributionLogSchema.index({ milestoneId: 1, timestamp: -1 })

module.exports = mongoose.model('ContributionLog', ContributionLogSchema)
