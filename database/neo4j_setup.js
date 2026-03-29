// Neo4j Setup Script
// Run: node database/neo4j_setup.js
// Requires: NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD in ../.env

require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') })
const neo4j = require('neo4j-driver')

const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || process.env.NEO4J_USERNAME || 'neo4j',
    process.env.NEO4J_PASSWORD || 'aegis1234'
  )
)

const SETUP_QUERIES = [
  // Uniqueness constraints
  'CREATE CONSTRAINT IF NOT EXISTS FOR (u:User)   REQUIRE u.phone    IS UNIQUE',
  'CREATE CONSTRAINT IF NOT EXISTS FOR (d:Device) REQUIRE d.deviceId IS UNIQUE',
  'CREATE CONSTRAINT IF NOT EXISTS FOR (p:PAN)    REQUIRE p.number   IS UNIQUE',

  // Indexes
  'CREATE INDEX IF NOT EXISTS FOR (u:User)   ON (u.sessionId)',
  'CREATE INDEX IF NOT EXISTS FOR (u:User)   ON (u.name)',
]

// Sample seed data for testing
const SEED_QUERIES = [
  `MERGE (u:User {phone: '9999999999'}) SET u.name = 'Test User 1'
   MERGE (d:Device {deviceId: 'TEST_DEVICE_001'})
   MERGE (p:PAN {number: 'ABCDE1234F'})
   MERGE (u)-[:USES]->(d)
   MERGE (u)-[:HAS]->(p)`,
]

async function setup() {
  const session = driver.session()
  try {
    console.log('Setting up Neo4j schema…')
    for (const q of SETUP_QUERIES) {
      await session.run(q)
      console.log('  ✓', q.substring(0, 60))
    }
    console.log('\nSeeding test data…')
    for (const q of SEED_QUERIES) {
      await session.run(q)
      console.log('  ✓ Seed data inserted')
    }
    console.log('\n✅ Neo4j setup complete!')

    // Verify fraud rule query
    console.log('\nTesting fraud detection query…')
    const res = await session.run(
      `MATCH (d:Device)<-[:USES]-(u:User)
       WITH d, count(u) AS userCount
       WHERE userCount > 3
       RETURN d.deviceId AS deviceId, userCount`
    )
    if (res.records.length === 0) {
      console.log('  ✓ No fraudulent devices found (expected for fresh setup)')
    } else {
      console.log('  ⚠ Fraudulent devices:', res.records.map(r => r.get('deviceId')))
    }
  } catch (err) {
    console.error('Setup failed:', err.message)
    process.exit(1)
  } finally {
    await session.close()
    await driver.close()
  }
}

setup()
