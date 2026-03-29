const neo4j = require('neo4j-driver');
const logger = require('../utils/logger');

let driver = null;

async function connectNeo4j() {
  try {
    const neo4jUser = process.env.NEO4J_USER || process.env.NEO4J_USERNAME || 'neo4j';
    driver = neo4j.driver(
      process.env.NEO4J_URI || 'bolt://localhost:7687',
      neo4j.auth.basic(
        neo4jUser,
        process.env.NEO4J_PASSWORD || 'aegis1234'
      )
    );
    await driver.verifyConnectivity();
    logger.info('Neo4j connected: ' + process.env.NEO4J_URI);
  } catch (err) {
    logger.warn('Neo4j connection failed (continuing without Neo4j): ' + err.message);
    driver = null;
  }
}

function getDriver() {
  if (!driver) throw new Error('Neo4j driver not initialized');
  return driver;
}

module.exports = { connectNeo4j, getDriver };
