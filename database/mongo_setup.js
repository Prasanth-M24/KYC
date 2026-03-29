// MongoDB Index Setup Script
// Run: node database/mongo_setup.js
require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') })
const mongoose = require('mongoose')

async function setup() {
  await mongoose.connect(process.env.MONGO_URI)
  console.log('MongoDB connected')

  const db = mongoose.connection.db
  const col = db.collection('kycsessions')

  await col.createIndex({ sessionId: 1 }, { unique: true })
  await col.createIndex({ phone: 1 })
  await col.createIndex({ status: 1 })
  await col.createIndex({ decision: 1 })
  await col.createIndex({ createdAt: -1 })

  console.log('✅ MongoDB indexes created')
  await mongoose.disconnect()
}

setup().catch(err => { console.error(err); process.exit(1) })
