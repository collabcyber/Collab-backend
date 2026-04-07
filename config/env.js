const { z } = require('zod')

const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  MONGO_URI: z.string().min(10),
  JWT_SECRET: z.string().min(32),
  CORS_ORIGINS: z.string().optional(),
  EMAIL_PROVIDER: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  TWO_FACTOR_ENC_KEY: z.string().optional(),
  SECURITY_ALERT_EMAIL: z.string().optional(),
  SECURITY_ALERT_WEBHOOK: z.string().optional(),
  SECURITY_ALERT_EVENTS: z.string().optional(),
  SECURITY_ALERT_COOLDOWN_SECONDS: z.string().optional(),
  ADMIN_2FA_REQUIRED: z.string().optional()
})

const warn = (message) => {
  console.warn(`[ENV] ${message}`)
}

const validateEnv = () => {
  const env = {
    NODE_ENV: process.env.NODE_ENV,
    MONGO_URI: process.env.MONGO_URI,
    JWT_SECRET: process.env.JWT_SECRET,
    CORS_ORIGINS: process.env.CORS_ORIGINS,
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    EMAIL_FROM: process.env.EMAIL_FROM,
    SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    TWO_FACTOR_ENC_KEY: process.env.TWO_FACTOR_ENC_KEY,
    SECURITY_ALERT_EMAIL: process.env.SECURITY_ALERT_EMAIL,
    SECURITY_ALERT_WEBHOOK: process.env.SECURITY_ALERT_WEBHOOK,
    SECURITY_ALERT_EVENTS: process.env.SECURITY_ALERT_EVENTS,
    SECURITY_ALERT_COOLDOWN_SECONDS: process.env.SECURITY_ALERT_COOLDOWN_SECONDS,
    ADMIN_2FA_REQUIRED: process.env.ADMIN_2FA_REQUIRED
  }

  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ')
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Invalid environment configuration: ${details}`)
    }
    warn(`Invalid environment configuration: ${details}`)
  }

  if (process.env.CORS_ORIGINS?.includes('*')) {
    warn('CORS_ORIGINS contains wildcard. Avoid "*" in production.')
  }

  if (process.env.EMAIL_PROVIDER === 'sendgrid' && !process.env.SENDGRID_API_KEY) {
    warn('SENDGRID_API_KEY is missing while EMAIL_PROVIDER=sendgrid.')
  }

  if (process.env.EMAIL_PROVIDER === 'resend' && !process.env.RESEND_API_KEY) {
    warn('RESEND_API_KEY is missing while EMAIL_PROVIDER=resend.')
  }

  if (process.env.NODE_ENV === 'production' && process.env.TWO_FACTOR_ENC_KEY && process.env.TWO_FACTOR_ENC_KEY.length < 32) {
    warn('TWO_FACTOR_ENC_KEY should be a 32-byte base64 or 64-char hex string.')
  }
}

module.exports = {
  validateEnv
}
