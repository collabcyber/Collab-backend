require('./config/loadEnv')
const connectDB = require('./config/db')
const { validateEnv } = require('./config/env')
const mongoose = require('mongoose')
const { seedColleges } = require('./services/collegeService')
const { initRedis, closeRedis } = require('./config/redisClient')
const fs = require('fs')
const path = require('path')

const PORT = process.env.PORT || 5001

let app
let server

const startServer = async () => {
  try {
    validateEnv()
    await initRedis()
    app = require('./app')

    const uploadsDir = path.join(__dirname, 'uploads')
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true })
    }

    await connectDB(process.env.MONGO_URI)
    await seedColleges()

    server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`)
    })
  } catch (err) {
    console.error('Failed to start server', err)
    process.exit(1)
  }
}

startServer()

process.on('SIGINT', async () => {
  try {
    if (server) {
      server.close()
    }
    await mongoose.connection.close()
    await closeRedis()
  } finally {
    process.exit()
  }
})

process.on('unhandledRejection', async (err) => {
  console.error('Unhandled rejection:', err)
  try {
    await closeRedis()
  } catch (_) {}

  if (server) {
    server.close(() => process.exit(1))
  } else {
    process.exit(1)
  }
})
