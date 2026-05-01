const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const mongoSanitize = require('express-mongo-sanitize')
const cookieParser = require('cookie-parser')
const path = require('path')
const { protect } = require('./middleware/authMiddleware')
const { errorHandler, notFound } = require('./middleware/errorMiddleware')
const { apiLimiter } = require('./middleware/rateLimiters')
const { requestLogger } = require('./middleware/securityLogger')
const { createAuthAttemptLimiter } = require('./middleware/authRateLimiter')

const app = express()
const authAttemptLimiter = createAuthAttemptLimiter()

app.set('trust proxy', 1)
app.disable('x-powered-by')

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      scriptSrc: [
        "'self'",
        'https://accounts.google.com',
        'https://apis.google.com'
      ],
      scriptSrcElem: [
        "'self'",
        'https://accounts.google.com',
        'https://apis.google.com'
      ],
      connectSrc: [
        "'self'",
        'https://accounts.google.com',
        'https://oauth2.googleapis.com'
      ],
      frameSrc: [
        "'self'",
        'https://accounts.google.com'
      ],
      imgSrc: [
        "'self'",
        'data:',
        'https://*.gstatic.com',
        'https://*.googleusercontent.com'
      ]
    }
  }
}))

app.use(mongoSanitize({ replaceWith: '_' }))
app.use(cookieParser())
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: false, limit: '1mb' }))
app.use(apiLimiter)
app.use(requestLogger)

const envOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

const allowedOrigins = new Set([
  'https://collab-frontend-five.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...envOrigins
])

const isAllowedVercelPreview = (origin) => {
  if (!origin) return false
  if (!origin.endsWith('.vercel.app')) return false
  return origin.includes('collab-frontend')
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)

    if (allowedOrigins.has(origin) || isAllowedVercelPreview(origin)) {
      return callback(null, true)
    }

    return callback(new Error('Not allowed by CORS'))
  },
  credentials: true
}))

app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'test') {
    console.log(`${req.method} ${req.originalUrl}`)
  }
  next()
})

app.get('/', (req, res) => res.send('API running'))

// Auth routes
const authRoutes = require('./routes/authRoutes')
app.post('/api/auth/login', authAttemptLimiter)
app.post('/api/auth/google', authAttemptLimiter)
app.use('/auth', authRoutes)
app.use('/api/auth', authRoutes)

// College routes
const collegeRoutes = require('./routes/collegeRoutes')
app.use('/colleges', collegeRoutes)
app.use('/api/colleges', collegeRoutes)

// Public routes
const publicRoutes = require('./routes/publicRoutes')
app.use('/public', publicRoutes)
app.use('/api/public', publicRoutes)

// Project routes (protected)
const projectRoutes = require('./routes/projectRoutes')
app.use('/projects', protect, projectRoutes)
app.use('/api/projects', protect, projectRoutes)

// User routes (protected)
const userRoutes = require('./routes/userRoutes')
app.use('/users', protect, userRoutes)
app.use('/api/users', protect, userRoutes)

// Notification routes (protected)
const notificationRoutes = require('./routes/notificationRoutes')
app.use('/notifications', protect, notificationRoutes)
app.use('/api/notifications', protect, notificationRoutes)

// Validation routes (protected)
const validationRoutes = require('./routes/validationRoutes')
app.use('/validations', protect, validationRoutes)
app.use('/api/validations', protect, validationRoutes)

app.use(notFound)
app.use(errorHandler)

module.exports = app
