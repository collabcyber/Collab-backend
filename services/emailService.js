const fs = require('fs')
const path = require('path')
const nodemailer = require('nodemailer')

const getFetch = () => {
  if (typeof fetch !== 'function') {
    throw new Error('Fetch API not available. Upgrade Node to v18+ or add a fetch polyfill.')
  }
  return fetch
}

const sendWithTimeout = async (promise, ms, onTimeout) => {
  let timer
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (onTimeout) onTimeout()
      reject(new Error('Email send timeout'))
    }, ms)
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    clearTimeout(timer)
  }
}

const buildAttachmentPayload = async (attachments = []) => {
  if (!Array.isArray(attachments) || attachments.length === 0) return []

  const results = []
  for (const attachment of attachments) {
    if (!attachment) continue
    const filename = attachment.filename || (attachment.path ? path.basename(attachment.path) : 'attachment')
    let content = attachment.content

    if (!content && attachment.path) {
      content = await fs.promises.readFile(attachment.path)
    }

    if (!content) continue

    const bufferContent = Buffer.isBuffer(content) ? content : Buffer.from(content)
    results.push({
      filename,
      content: bufferContent.toString('base64'),
      type: attachment.contentType || attachment.type || 'application/octet-stream',
      disposition: attachment.disposition || 'attachment'
    })
  }

  return results
}

const sendViaResend = async ({ to, subject, text, html, attachments }) => {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new Error('RESEND_API_KEY must be set when EMAIL_PROVIDER=resend')
  }

  const fromAddress = process.env.EMAIL_FROM || process.env.EMAIL_USER
  if (!fromAddress) {
    throw new Error('EMAIL_FROM must be set for Resend')
  }

  const fetchFn = getFetch()
  const resendAttachments = await buildAttachmentPayload(attachments)
  const controller = new AbortController()
  const timeoutMs = Number(process.env.EMAIL_SEND_TIMEOUT_MS || 12000)
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromAddress,
        to,
        subject,
        text,
        html,
        attachments: resendAttachments.length > 0
          ? resendAttachments.map((item) => ({
            filename: item.filename,
            content: item.content
          }))
          : undefined
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Resend error ${response.status}: ${errorText}`)
    }

    return { success: true, provider: 'resend' }
  } finally {
    clearTimeout(timeout)
  }
}

const sendViaSendGrid = async ({ to, subject, text, html, attachments }) => {
  const apiKey = process.env.SENDGRID_API_KEY
  if (!apiKey) {
    throw new Error('SENDGRID_API_KEY must be set when EMAIL_PROVIDER=sendgrid')
  }

  const fromAddress = process.env.EMAIL_FROM || process.env.EMAIL_USER
  if (!fromAddress) {
    throw new Error('EMAIL_FROM must be set for SendGrid')
  }

  const fetchFn = getFetch()
  const sendGridAttachments = await buildAttachmentPayload(attachments)
  const controller = new AbortController()
  const timeoutMs = Number(process.env.EMAIL_SEND_TIMEOUT_MS || 12000)
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchFn('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: fromAddress },
        subject,
        content: [
          { type: 'text/plain', value: text || '' },
          { type: 'text/html', value: html || '' }
        ],
        attachments: sendGridAttachments.length > 0
          ? sendGridAttachments.map((item) => ({
            content: item.content,
            filename: item.filename,
            type: item.type,
            disposition: item.disposition
          }))
          : undefined
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`SendGrid error ${response.status}: ${errorText}`)
    }

    return { success: true, provider: 'sendgrid' }
  } finally {
    clearTimeout(timeout)
  }
}

const getTransporter = async () => {
  const {
    EMAIL_SERVICE,
    EMAIL_HOST,
    EMAIL_PORT,
    EMAIL_USER,
    EMAIL_PASS
  } = process.env

  if (!EMAIL_USER || !EMAIL_PASS) {
    throw new Error('EMAIL_USER and EMAIL_PASS must be set to send emails')
  }

  const timeoutOptions = {
    connectionTimeout: Number(process.env.EMAIL_CONNECTION_TIMEOUT_MS || 10000),
    greetingTimeout: Number(process.env.EMAIL_GREETING_TIMEOUT_MS || 10000),
    socketTimeout: Number(process.env.EMAIL_SOCKET_TIMEOUT_MS || 10000)
  }

  if (EMAIL_SERVICE) {
    return nodemailer.createTransport({
      service: EMAIL_SERVICE,
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
      },
      ...timeoutOptions
    })
  }

  const host = EMAIL_HOST || 'smtp.gmail.com'
  const port = Number(EMAIL_PORT || 587)

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS
    },
    ...timeoutOptions
  })
}

const mapNodemailerAttachments = (attachments = []) => {
  if (!Array.isArray(attachments) || attachments.length === 0) return undefined
  return attachments
    .filter(Boolean)
    .map((attachment) => ({
      filename: attachment.filename,
      path: attachment.path,
      content: attachment.content,
      contentType: attachment.contentType || attachment.type
    }))
}

exports.sendEmail = async ({ to, subject, text, html, attachments }) => {
  try {
    const provider = (process.env.EMAIL_PROVIDER || '').toLowerCase().trim()
    if (provider === 'resend') {
      return await sendViaResend({ to, subject, text, html, attachments })
    }
    if (provider === 'sendgrid') {
      return await sendViaSendGrid({ to, subject, text, html, attachments })
    }

    const transporter = await getTransporter()
    const fromAddress = process.env.EMAIL_FROM || process.env.EMAIL_USER

    const sendPromise = transporter.sendMail({
      from: `Collab <${fromAddress}>`,
      to,
      subject,
      text,
      html,
      attachments: mapNodemailerAttachments(attachments)
    })

    // Prevent unhandled rejections if the send times out.
    sendPromise.catch(() => {})

    const info = await sendWithTimeout(
      sendPromise,
      Number(process.env.EMAIL_SEND_TIMEOUT_MS || 12000),
      () => {
        try {
          transporter.close()
        } catch (closeError) {
          // ignore close errors
        }
      }
    )

    return { success: true, messageId: info.messageId }
  } catch (error) {
    console.error('Email service error:', error)
    throw error
  }
}
