const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const PDFDocument = require('pdfkit')

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

const generateCertificatePdf = async ({ userName, projectTitle, collegeName, issuedAt, certificateId }) => {
  const uploadsRoot = path.join(__dirname, '..', 'uploads')
  const certificatesDir = path.join(uploadsRoot, 'certificates')
  ensureDir(certificatesDir)

  const filename = `validation-certificate-${certificateId}.pdf`
  const filePath = path.join(certificatesDir, filename)

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    const stream = fs.createWriteStream(filePath)
    doc.pipe(stream)

    doc.rect(20, 20, doc.page.width - 40, doc.page.height - 40).lineWidth(2).stroke('#6C5CE7')

    doc.fontSize(26).fillColor('#1f2937').text('Collab', { align: 'center' })
    doc.moveDown(0.5)
    doc.fontSize(20).fillColor('#111827').text('Validation Phase Certificate', { align: 'center' })
    doc.moveDown(1)

    doc.fontSize(14).fillColor('#374151')
      .text(`This certifies that`, { align: 'center' })
    doc.moveDown(0.6)
    doc.fontSize(22).fillColor('#111827').text(userName, { align: 'center' })
    doc.moveDown(0.6)
    doc.fontSize(14).fillColor('#374151')
      .text(`is actively working on the project`, { align: 'center' })
    doc.moveDown(0.6)
    doc.fontSize(18).fillColor('#111827').text(`"${projectTitle}"`, { align: 'center' })
    doc.moveDown(0.6)
    doc.fontSize(14).fillColor('#374151')
      .text(`which has entered the Validation phase on ${formatDate(issuedAt)}.`, { align: 'center' })

    if (collegeName) {
      doc.moveDown(0.8)
      doc.fontSize(12).fillColor('#6b7280')
        .text(`College: ${collegeName}`, { align: 'center' })
    }

    doc.moveDown(1.2)
    doc.fontSize(10).fillColor('#6b7280')
      .text(`Certificate ID: ${certificateId}`, { align: 'center' })
    doc.moveDown(0.3)
    doc.fontSize(10).fillColor('#6b7280')
      .text(`Verify: ${buildVerificationUrl(certificateId)}`, { align: 'center' })

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

const generateValidationCertificates = async ({ project, members }) => {
  const issuedAt = new Date()
  const certificates = []

  for (const member of members) {
    const certificateId = crypto.randomUUID()
    const result = await generateCertificatePdf({
      userName: member.name || 'Team Member',
      projectTitle: project.title,
      collegeName: project.college?.name,
      issuedAt,
      certificateId
    })
    certificates.push({
      certificateId,
      user: member._id || member.id || member,
      url: result.relativePath,
      filename: result.filename,
      issuedAt
    })
  }

  return certificates
}

module.exports = {
  generateValidationCertificates,
  buildVerificationUrl
}
