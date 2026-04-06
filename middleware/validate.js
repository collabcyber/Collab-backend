const { ZodError, z } = require('zod')

const wrapSchema = (schema) => {
  if (schema && schema.shape && (schema.shape.body || schema.shape.params || schema.shape.query)) {
    return schema
  }
  return z.object({
    body: schema,
    params: z.object({}).passthrough(),
    query: z.object({}).passthrough()
  })
}

const validate = (schema) => (req, res, next) => {
  try {
    const normalized = wrapSchema(schema)
    const parsed = normalized.safeParse({
      body: req.body,
      params: req.params,
      query: req.query
    })

    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
      return res.status(400).json({ message: 'Validation error', errors: issues })
    }

    req.validated = parsed.data
    return next()
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: err.errors })
    }
    return next(err)
  }
}

module.exports = validate
