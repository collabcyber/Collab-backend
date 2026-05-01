const { createClient } = require('redis')

let redisClient = null

function buildRedisUrlFromParts() {
  const host = process.env.REDISHOST
  const port = process.env.REDISPORT || '6379'
  if (!host) return null

  const user = process.env.REDISUSER || 'default'
  const password = process.env.REDISPASSWORD

  if (!password) {
    return `redis://${host}:${port}`
  }

  return `redis://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}`
}

function resolveRedisUrl() {
  const directUrl =
    process.env.REDIS_URL ||
    process.env.REDIS_PRIVATE_URL ||
    process.env.REDIS_PUBLIC_URL ||
    process.env.REDIS_TLS_URL

  if (directUrl && directUrl.trim()) {
    return directUrl.trim()
  }

  return buildRedisUrlFromParts()
}

async function initRedis() {
  if (redisClient && redisClient.isOpen) {
    return redisClient
  }

  const redisUrl = resolveRedisUrl()
  if (!redisUrl) {
    throw new Error(
      'Redis is not configured. Set REDIS_URL (or REDIS_PRIVATE_URL / REDIS_PUBLIC_URL), or REDISHOST/REDISPORT/REDISPASSWORD.'
    )
  }

  redisClient = createClient({
    url: redisUrl,
    socket: {
      connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 10000),
      reconnectStrategy: (retries) => Math.min(3000, 100 + retries * 100)
    }
  })

  redisClient.on('error', (err) => {
    console.error('[redis] client error:', err.message)
  })

  redisClient.on('reconnecting', () => {
    console.warn('[redis] reconnecting...')
  })

  await redisClient.connect()
  await redisClient.ping()
  console.log('[redis] connected')

  return redisClient
}

function getRedisClient() {
  if (!redisClient || !redisClient.isOpen) {
    throw new Error('Redis client is not connected')
  }

  return redisClient
}

async function closeRedis() {
  if (!redisClient) return

  try {
    if (typeof redisClient.close === 'function') {
      await redisClient.close() // node-redis v5+
    } else {
      await redisClient.quit() // node-redis v4 fallback
    }
  } catch (err) {
    console.error('[redis] close error:', err.message)
  }
}

module.exports = {
  initRedis,
  getRedisClient,
  closeRedis
}
