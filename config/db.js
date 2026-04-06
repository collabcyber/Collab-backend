const mongoose = require('mongoose')

mongoose.set('strictQuery', true)
mongoose.set('sanitizeFilter', true)

function connectDB(uri) {
  return mongoose.connect(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000
  })
  .then((conn) => {
    console.log(`MongoDB connected: ${conn.connection.host}:${conn.connection.port}`)
    return conn
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message || err)
    throw err
  })
}

module.exports = connectDB
