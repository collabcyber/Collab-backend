const crypto = require('crypto')

const getKey = () => {
  const raw = process.env.TWO_FACTOR_ENC_KEY
  if (!raw) {
    throw new Error('TWO_FACTOR_ENC_KEY must be set to enable 2FA')
  }

  let key
  if (raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)) {
    key = Buffer.from(raw, 'hex')
  } else {
    key = Buffer.from(raw, 'base64')
  }

  if (key.length !== 32) {
    throw new Error('TWO_FACTOR_ENC_KEY must be 32 bytes (base64 or hex)')
  }

  return key
}

const encrypt = (plaintext) => {
  const key = getKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

const decrypt = (payload) => {
  const key = getKey()
  const buffer = Buffer.from(payload, 'base64')
  const iv = buffer.subarray(0, 12)
  const tag = buffer.subarray(12, 28)
  const encrypted = buffer.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return decrypted.toString('utf8')
}

module.exports = {
  encrypt,
  decrypt
}

