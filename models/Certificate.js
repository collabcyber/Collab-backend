const mongoose = require('mongoose')

const CertificateSchema = new mongoose.Schema({
  certificateId: { type: String, required: true, unique: true, index: true },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  college: { type: mongoose.Schema.Types.ObjectId, ref: 'College' },
  projectTitle: { type: String, required: true },
  userName: { type: String },
  collegeName: { type: String },
  issuedAt: { type: Date, default: Date.now },
  url: { type: String, required: true },
  filename: { type: String, required: true }
}, { timestamps: true })

CertificateSchema.index({ project: 1, user: 1 })
CertificateSchema.index({ issuedAt: -1 })

module.exports = mongoose.model('Certificate', CertificateSchema)
