exports.notFound = (req, res, next) => {
  res.status(404).json({ message: 'Route not found' })
}

exports.errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || err.status || 500
  const message = err.message || 'Server error'
  console.error('Unhandled error:', err)
  res.status(statusCode).json({ message })
}
