const { sendEmail } = require('./emailService')

const alertCache = new Map()

const getCooldownMs = () => {
  const seconds = Number(process.env.SECURITY_ALERT_COOLDOWN_SECONDS || 300)
  return Math.max(30, seconds) * 1000
}

const shouldSendAlert = (event) => {
  const now = Date.now()
  const cooldown = getCooldownMs()
  const last = alertCache.get(event) || 0
  if (now - last < cooldown) {
    return false
  }
  alertCache.set(event, now)
  return true
}

const sendWebhookAlert = async (payload) => {
  const webhook = process.env.SECURITY_ALERT_WEBHOOK
  if (!webhook) return
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Security webhook failed: ${response.status} ${text}`)
  }
}

const sendEmailAlert = async (payload) => {
  const target = process.env.SECURITY_ALERT_EMAIL
  if (!target) return
  const subject = `[Collab Security] ${payload.event}`
  const body = JSON.stringify(payload, null, 2)
  await sendEmail({
    to: target,
    subject,
    text: body,
    html: `<pre>${body}</pre>`
  })
}

const queueSecurityAlert = async (payload) => {
  if (!shouldSendAlert(payload.event)) {
    return
  }
  try {
    await Promise.all([
      sendWebhookAlert(payload),
      sendEmailAlert(payload)
    ])
  } catch (error) {
    console.error('Security alert failed:', error)
  }
}

module.exports = {
  queueSecurityAlert
}

