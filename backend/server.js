require('dotenv').config();
require('express-async-errors');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { connectMongo } = require('./services/mongoService');
const { connectNeo4j } = require('./services/neo4jService');
const kycRoutes = require('./routes/kyc');
const logger = require('./utils/logger');
const { requestSecurityHeaders } = require('./middleware/security');

const app = express();
const PORT = process.env.PORT || 3001;

// Ensure upload directory exists
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Middleware
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(requestSecurityHeaders);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.resolve(uploadDir), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'private, max-age=300');
  }
}));

// Routes
app.use('/kyc', kycRoutes);

// Health check aggregation
app.get('/health', async (req, res) => {
  const { docClient, bioClient } = require('./utils/apiConfig');
  let docStatus = 'down', bioStatus = 'down';
  try { await docClient.get('/health'); docStatus = 'up'; } catch(e){}
  try { await bioClient.get('/health'); bioStatus = 'up'; } catch(e){}
  
  const status = (docStatus === 'up' && bioStatus === 'up') ? 'ok' : 'degraded';
  res.status(status === 'ok' ? 200 : 503).json({ 
    status, 
    service: 'AEGIS-KYC Backend', 
    time: new Date(),
    dependencies: { document: docStatus, biometric: bioStatus }
  });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error({ message: err.message, stack: err.stack });
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

async function main() {
  try {
    await connectMongo();
    await connectNeo4j();
    app.listen(PORT, () => {
      logger.info(`AEGIS-KYC Backend running on http://localhost:${PORT}`);
    });
  } catch (err) {
    logger.error('Startup failed: ' + err.message);
    process.exit(1);
  }
}

main();
