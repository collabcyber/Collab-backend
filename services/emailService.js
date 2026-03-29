const nodemailer = require('nodemailer')

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

exports.sendEmail = async ({ to, subject, text, html }) => {
  try {
    const transporter = await getTransporter()
    const fromAddress = process.env.EMAIL_FROM || process.env.EMAIL_USER
    const sendTimeoutMs = Number(process.env.EMAIL_SEND_TIMEOUT_MS || 12000)

    const sendPromise = transporter.sendMail({
      from: `Collab <${fromAddress}>`,
      to,
      subject,
      text,
      html
    })

    const timeoutPromise = new Promise((_, reject) => {
      const timer = setTimeout(() => {
        try {
          transporter.close()
        } catch (closeError) {
          // ignore close errors
        }
        reject(new Error('Email send timeout'))
      }, sendTimeoutMs)
      sendPromise.finally(() => clearTimeout(timer))
    })

    const info = await Promise.race([sendPromise, timeoutPromise])

    return { success: true, messageId: info.messageId }
  } catch (error) {
    console.error('Email service error:', error)
    throw error
  }
}
