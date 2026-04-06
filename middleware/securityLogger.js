const logSecurityEvent = (event, req, details = {}) => {
  const payload = {
    event,
    ip: req.ip,
    method: req.method,
    path: req.originalUrl,
    userId: req.user?.userId,
    timestamp: new Date().toISOString(),
    ...details
  }
  console.warn('[SECURITY]', JSON.stringify(payload))
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
