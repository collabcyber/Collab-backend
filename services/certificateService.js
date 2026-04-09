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

    const pageWidth = doc.page.width
    const contentX = 60
    const contentWidth = pageWidth - 120

    const centerText = (text, y, size, color = '#111827') => {
      doc.fontSize(size).fillColor(color)
      doc.text(text, contentX, y, { width: contentWidth, align: 'center' })
    }

    doc.rect(20, 20, pageWidth - 40, doc.page.height - 40).lineWidth(2).stroke('#6C5CE7')

    let y = 90
    centerText('Collab', y, 28, '#1f2937')
    y += 42
    centerText('Validation Phase Certificate', y, 20, '#111827')
    y += 55

    centerText('This certifies that', y, 14, '#374151')
    y += 32
    centerText(userName, y, 24, '#111827')
    y += 36
    centerText('is actively working on the project', y, 14, '#374151')
    y += 32
    centerText(`"${projectTitle}"`, y, 18, '#111827')
    y += 34
    centerText(`which has entered the Validation phase on ${formatDate(issuedAt)}.`, y, 14, '#374151')
    y += 46

    if (collegeName) {
      centerText(`College: ${collegeName}`, y, 12, '#6b7280')
      y += 28
    }

    y = Math.max(y, doc.page.height - 160)
    centerText(`Certificate ID: ${certificateId}`, y, 10, '#6b7280')
    y += 18
    centerText(`Verify: ${buildVerificationUrl(certificateId)}`, y, 10, '#6b7280')

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
