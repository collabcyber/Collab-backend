exports.notFound = (req, res, next) => {
  res.status(404).json({ message: 'Route not found' })
}

exports.errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || err.status || 500
  let message = err.message || 'Server error'
  if (process.env.NODE_ENV === 'production' && statusCode >= 500) {
    message = 'Server error'
  }
  console.error('Unhandled error:', err)
  res.status(statusCode).json({ message })
}
