const { queueSecurityAlert } = require('../services/securityAlertService')

const parseAlertEvents = () => {
  const raw = process.env.SECURITY_ALERT_EVENTS
  if (!raw) {
    return new Set(['rate_limit', 'auth_failure', 'otp_lockout', 'admin_2fa_failed', 'weak_admin_password'])
  }
  return new Set(raw.split(',').map((item) => item.trim()).filter(Boolean))
}

const alertEvents = parseAlertEvents()

const getClientIp = (req) =>
  req.headers['cf-connecting-ip']
    || req.headers['x-real-ip']
    || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.ip

const logSecurityEvent = (event, req, details = {}) => {
  const payload = {
    event,
    ip: getClientIp(req),
    method: req.method,
    path: req.originalUrl,
    userId: req.user?.userId,
    timestamp: new Date().toISOString(),
    ...details
  }
  console.warn('[SECURITY]', JSON.stringify(payload))

  const shouldAlert = alertEvents.has(event)
    || (event === 'http_error' && (details.status || 0) >= 500)

  if (shouldAlert) {
    setImmediate(() => {
      queueSecurityAlert(payload).catch(() => {})
    })
  }
}

const requestLogger = (req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    const duration = Date.now() - start
    const status = res.statusCode
    if (status >= 400) {
      logSecurityEvent('http_error', req, { status, durationMs: duration })
    }
  })
  next()
}

module.exports = {
  logSecurityEvent,
  requestLogger
}
