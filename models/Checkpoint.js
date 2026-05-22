const mongoose = require('mongoose')

const PHASES = ['problem', 'plan', 'build', 'mvp', 'validation', 'demo']

const CheckpointSchema = new mongoose.Schema({
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
    index: true
  },
  phase: {
    type: String,
    enum: PHASES,
    required: true
  },
  submissionLink: {
    type: String,
    default: '',
    trim: true
  },
  description: {
    type: String,
    default: '',
    trim: true,
    maxlength: 2000
  },
  executionEntry: {
    progressNarrative: {
      type: String,
      default: '',
      trim: true,
      maxlength: 2500
    },
    nextMilestone: {
      type: String,
      default: '',
      trim: true,
      maxlength: 300
    },
    blockers: [{
      type: String,
      trim: true,
      maxlength: 240
    }],
    evidenceLinks: [{
      type: String,
      trim: true,
      maxlength: 1000
    }],
    reflections: [{
      questionKey: {
        type: String,
        required: true,
        trim: true,
        maxlength: 120
      },
      question: {
        type: String,
        required: true,
        trim: true,
        maxlength: 240
      },
      answer: {
        type: String,
        required: true,
        trim: true,
        maxlength: 2000
      }
    }]
  },
  submittedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  submittedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true })

CheckpointSchema.index({ projectId: 1, phase: 1 }, { unique: true })
CheckpointSchema.index({ projectId: 1, submittedAt: -1 })

module.exports = mongoose.model('Checkpoint', CheckpointSchema)
