require('../config/loadEnv')
const mongoose = require('mongoose')
const Project = require('../models/Project')
const Certificate = require('../models/Certificate')

const run = async () => {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is missing. Set it in .env or pass it inline.')
    process.exit(1)
  }

  await mongoose.connect(process.env.MONGO_URI)

  const cursor = Project.find({ 'validation.certificates.0': { $exists: true } }).cursor()
  let ops = []
  let upserts = 0

  for await (const project of cursor) {
    const certs = project.validation?.certificates || []
    for (const cert of certs) {
      if (!cert?.certificateId) continue
      ops.push({
        updateOne: {
          filter: { certificateId: cert.certificateId },
          update: {
            $setOnInsert: {
              certificateId: cert.certificateId,
              project: project._id,
              user: cert.user,
              college: project.college || null,
              projectTitle: project.title,
              userName: cert.userName,
              collegeName: project.college?.name || null
            },
            $set: {
              url: cert.url,
              filename: cert.filename,
              issuedAt: cert.issuedAt || new Date()
            }
          },
          upsert: true
        }
      })

      if (ops.length >= 500) {
        const res = await Certificate.bulkWrite(ops, { ordered: false })
        upserts += res.upsertedCount || 0
        ops = []
      }
    }
  }

  if (ops.length) {
    const res = await Certificate.bulkWrite(ops, { ordered: false })
    upserts += res.upsertedCount || 0
  }

  console.log(`Migration complete. Upserted ${upserts} certificates.`)
  await mongoose.disconnect()
}

run().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
