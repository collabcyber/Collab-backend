const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const PDFDocument = require('pdfkit')
const Certificate = require('../models/Certificate')

const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

const formatDate = (value) => {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  } catch {
    return '—'
  }
}

const buildVerificationUrl = (certificateId) => {
  const apiBase = process.env.PUBLIC_API_BASE || 'https://api.collab.qzz.io'
  return `${apiBase.replace(/\/$/, '')}/api/public/certificates/${certificateId}`
}

const generateCertificatePdf = async ({
  userName,
  projectTitle,
  collegeName,
  issuedAt,
  certificateId,
  memberRole = 'Startup Team Member',
  contributionSummary = 'Contributed to startup execution inside Collab.',
  milestonesCompleted = 0,
  stageAchieved = 'Validation'
}) => {
  const uploadsRoot = path.join(__dirname, '..', 'uploads')
  const certificatesDir = path.join(uploadsRoot, 'certificates')
  ensureDir(certificatesDir)

  const filename = `startup-execution-certificate-${certificateId}.pdf`
  const filePath = path.join(certificatesDir, filename)

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 })
    const stream = fs.createWriteStream(filePath)
    doc.pipe(stream)

    const pageWidth = doc.page.width
    const pageHeight = doc.page.height
    const contentX = 60
    const contentWidth = pageWidth - 120

    const centerText = (text, y, size, font = 'Times-Roman', color = '#111827') => {
      doc.font(font).fontSize(size).fillColor(color)
      doc.text(text, contentX, y, { width: contentWidth, align: 'center' })
    }

    const templatePath = path.join(__dirname, '..', 'assets', 'certificate-template.png')
    if (fs.existsSync(templatePath)) {
      doc.image(templatePath, 0, 0, { fit: [pageWidth, pageHeight], align: 'center', valign: 'center' })
    } else {
      doc.rect(20, 20, pageWidth - 40, pageHeight - 40).lineWidth(2).stroke('#6C5CE7')
    }

    const certY = pageHeight * 0.40
    const workY = pageHeight * 0.56
    const nameSize = 34
    const nameY = Math.round(((certY + 14) + workY - nameSize) / 2) - 8

    centerText('Startup Execution Certificate', pageHeight * 0.30, 24, 'Times-Bold')
    centerText('This certifies that', certY, 14)
    centerText(userName, nameY, nameSize, 'Times-Italic')
    centerText(`served as ${memberRole} for the startup`, workY, 13)
    centerText(`"${projectTitle}"`, pageHeight * 0.60, 16, 'Times-Italic')
    centerText(`Stage achieved: ${stageAchieved} | Milestones completed: ${milestonesCompleted}`, pageHeight * 0.64, 12)
    centerText(contributionSummary, pageHeight * 0.68, 11)

    if (collegeName) {
      centerText(`College: ${collegeName.toUpperCase()}`, pageHeight * 0.74, 12)
    }

    const footerY1 = pageHeight * 0.90
    const footerY2 = pageHeight * 0.93
    centerText(`Certificate ID: ${certificateId}`, footerY1, 9, 'Times-Roman', '#374151')
    centerText(`Verify: ${buildVerificationUrl(certificateId)}`, footerY2, 9, 'Times-Roman', '#374151')

    doc.end()
    stream.on('finish', resolve)
    stream.on('error', reject)
  })

  return {
    filename,
    relativePath: `/uploads/certificates/${filename}`,
    certificateId
  }
}

const generateValidationCertificates = async ({ project, members, milestoneSummary = {}, contributionSummaries = new Map() }) => {
  const issuedAt = new Date()
  const certificates = []

  for (const member of members) {
    const certificateId = crypto.randomUUID()
    const userId = member._id || member.id || member
    const userName = member.name || 'Team Member'
    const role = userId?.toString?.() === project.owner?.toString?.() ? 'Startup Lead' : 'Startup Team Member'
    const contributionSummary = contributionSummaries.get?.(userId?.toString?.()) || 'Contributed to startup execution, validation preparation, and incubation readiness work.'
    const result = await generateCertificatePdf({
      userName: member.name || 'Team Member',
      projectTitle: project.title,
      collegeName: project.college?.name,
      issuedAt,
      certificateId,
      memberRole: role,
      contributionSummary,
      milestonesCompleted: milestoneSummary.completed || 0,
      stageAchieved: project.lifecycleStage ? project.lifecycleStage.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Validation'
    })
    certificates.push({
      certificateId,
      user: userId,
      userName,
      url: result.relativePath,
      filename: result.filename,
      issuedAt
    })
  }


  if (certificates.length) {
    await Certificate.insertMany(
      certificates.map((cert) => ({
        certificateId: cert.certificateId,
        project: project._id,
        user: cert.user,
        college: project.college || null,
        projectTitle: project.title,
        userName: cert.userName,
        collegeName: project.college?.name || null,
        issuedAt: cert.issuedAt,
        url: cert.url,
        filename: cert.filename
      }))
    )
  }

  return certificates
}

module.exports = {
  generateValidationCertificates,
  buildVerificationUrl
}
