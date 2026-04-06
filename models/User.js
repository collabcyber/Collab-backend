const mongoose = require('mongoose')

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, select: false },
  role: { type: String, default: 'user' },
  emailVerified: { type: Boolean, default: false },
  emailVerificationOTP: { type: String, select: false },
  emailVerificationOTPHash: { type: String, select: false },
  emailVerificationExpires: Date,
  emailVerificationOTPAttempts: { type: Number, default: 0 },
  emailVerificationLastSent: Date,
  resetPasswordOTP: { type: String, select: false },
  resetPasswordOTPHash: { type: String, select: false },
  resetPasswordExpires: Date,
  resetPasswordOTPAttempts: { type: Number, default: 0 },
  resetPasswordLastSent: Date,
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College' },
  college_id: { type: mongoose.Schema.Types.ObjectId, ref: 'College' },
  course: { type: String, required: false },
  yearOfStudy: { type: String, required: false },
  skills: [{ type: String, required: false }],
  primaryCategory: { type: String, required: false },
  phone: { type: String, required: false, trim: true },
  points: { type: Number, default: 0 },
  badges: [{ type: String, required: false }],
  projectsCreated: { type: Number, default: 0 },
  projectsJoined: { type: Number, default: 0 },
  projectsCompleted: { type: Number, default: 0 },
  validationsGiven: { type: Number, default: 0 },
  helpfulFeedback: { type: Number, default: 0 },
  inactivePenalties: { type: Number, default: 0 },
  showContactToTeam: { type: Boolean, default: false },
  lastActive: { type: Date, default: Date.now }
}, { timestamps: true })

module.exports = mongoose.model('User', UserSchema)
