const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const sessionRepository = require('../repositories/sessionRepository');
const { getDriver } = require('../services/neo4jService');
const { calculateRisk } = require('../services/riskEngine');
const { verifyRegistries } = require('../services/identityRegistryService');
const { runWatchlistChecks } = require('../services/watchlistService');
const { createReviewerReport } = require('../services/reportService');
const { compareNames } = require('../utils/matchUtils');
const logger = require('../utils/logger');
const { docClient, bioClient } = require('../utils/apiConfig');

function assessInjectionRisk(deviceContext = {}) {
  const signals = [];

  if (deviceContext.webdriver) signals.push('webdriver_detected');
  if (deviceContext.userAgent && /headless|phantom|selenium/i.test(deviceContext.userAgent)) {
    signals.push('headless_user_agent');
  }
  if (
    deviceContext.platform &&
    /win32|linux/i.test(deviceContext.platform) &&
    Number(deviceContext.hardwareConcurrency || 0) <= 1
  ) {
    signals.push('low_hardware_profile');
  }

  return {
    injectionFlag: signals.length > 0,
    signals,
  };
}

async function runDevicePrecheck(deviceId) {
  let matchedUsers = 0;
  let precheckRisk = 0;
  let frictionMode = 'LOW';

  if (!deviceId) return { matchedUsers, precheckRisk, frictionMode };

  try {
    const driver = getDriver();
    const neo4jSession = driver.session();
    try {
      const result = await neo4jSession.run(
        `MATCH (d:Device {deviceId: $deviceId})<-[:USES]-(u:User)
         RETURN count(u) AS userCount`,
        { deviceId }
      );

      matchedUsers = result.records[0]?.get('userCount')?.toNumber?.() || 0;
      precheckRisk = Math.min(20, matchedUsers * 5);
      if (matchedUsers >= 3) frictionMode = 'HIGH';
      else if (matchedUsers >= 1) frictionMode = 'MEDIUM';
    } finally {
      await neo4jSession.close();
    }
  } catch (err) {
    logger.warn('Device precheck unavailable: ' + err.message);
  }

  return { matchedUsers, precheckRisk, frictionMode };
}

function buildComplianceResult({ session, registryResult, watchlistResult, nameMatch, graphSignals }) {
  const controls = [
    { id: 'customer_identification', status: session.docResult?.pan?.valid && session.docResult?.aadhaar?.valid ? 'PASS' : 'FAIL' },
    { id: 'biometric_binding', status: session.bioResult?.face_verified ? 'PASS' : 'REVIEW' },
    { id: 'injection_attack_detection', status: session.injectionRisk?.injectionFlag ? 'REVIEW' : 'PASS' },
    { id: 'device_and_graph_screening', status: session.fraudFlag ? 'FAIL' : graphSignals.linkedUsers > 0 ? 'REVIEW' : 'PASS' },
    { id: 'watchlist_screening', status: watchlistResult.flagged ? 'FAIL' : 'PASS' },
    { id: 'registry_cross_verification', status: registryResult.reviewReasons.length ? 'REVIEW' : 'PASS' },
    { id: 'name_consistency', status: nameMatch.matched ? 'PASS' : 'REVIEW' },
    { id: 'audit_trail_generation', status: 'PASS' },
  ];

  const reviewerNotes = [];
  if (!nameMatch.matched) reviewerNotes.push('Applicant name does not closely match the PAN extraction.');
  if (registryResult.reviewReasons.length) reviewerNotes.push(`Registry review required: ${registryResult.reviewReasons.join(', ')}.`);
  if (watchlistResult.flagged) reviewerNotes.push('Internal watchlist hit detected. Escalate before account opening.');
  if (session.fraudFlag) reviewerNotes.push('Graph intelligence flagged suspicious reuse of device or PAN.');

  let recommendation = session.decision;
  if (watchlistResult.flagged || session.fraudFlag) recommendation = 'REJECTED';
  else if (registryResult.reviewReasons.length || !nameMatch.matched) recommendation = recommendation === 'APPROVED' ? 'REVIEW' : recommendation;

  return {
    controls,
    reviewerNotes,
    recommendation,
    employeeAction:
      recommendation === 'APPROVED'
        ? 'Proceed with account creation and archive the digital audit pack.'
        : recommendation === 'REVIEW'
          ? 'Route to operations or compliance for manual review with the attached report.'
          : 'Reject onboarding, retain audit evidence, and alert fraud operations.',
  };
}

exports.startSession = async (req, res) => {
  const { phone, name, deviceContext = {} } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone is required' });

  const sessionId = uuidv4();
  const deviceId = req.headers['x-device-id'] || deviceContext.fingerprint || `WEB_${phone}`;
  const injectionRisk = assessInjectionRisk(deviceContext);
  const precheck = await runDevicePrecheck(deviceId);

  await sessionRepository.create({
    sessionId,
    phone,
    name: name || '',
    deviceId,
    deviceContext,
    precheckRisk: precheck.precheckRisk,
    injectionRisk,
    status: 'STARTED',
    logs: [
      { step: 'SESSION_CREATED', timestamp: new Date(), data: { phone, deviceId } },
      { step: 'DEVICE_PRECHECK', timestamp: new Date(), data: precheck },
      { step: 'IAD_PRECHECK', timestamp: new Date(), data: injectionRisk },
    ],
  });

  logger.info(`Session created: ${sessionId}`);
  res.json({
    sessionId,
    message: 'KYC session started',
    adaptiveAuth: {
      frictionMode: precheck.frictionMode,
      precheckRisk: precheck.precheckRisk,
      matchedUsers: precheck.matchedUsers,
      injectionSignals: injectionRisk.signals,
    },
  });
};

exports.uploadDocs = async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

  const session = await sessionRepository.findOne({ sessionId });
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const panFile = req.files?.pan?.[0];
  const aadhaarFile = req.files?.aadhaar?.[0];
  if (!panFile || !aadhaarFile) {
    return res.status(400).json({ error: 'Both PAN and Aadhaar images are required' });
  }

  session.panPath = panFile.path;
  session.aadhaarPath = aadhaarFile.path;

  let docResult = { pan: null, aadhaar: null };
  try {
    const FormData = require('form-data');

    const panForm = new FormData();
    panForm.append('file', fs.createReadStream(panFile.path), panFile.originalname);
    panForm.append('doc_type', 'pan');
    docResult.pan = (await docClient.post('/analyze', panForm, { headers: panForm.getHeaders() })).data;

    const aadForm = new FormData();
    aadForm.append('file', fs.createReadStream(aadhaarFile.path), aadhaarFile.originalname);
    aadForm.append('doc_type', 'aadhaar');
    docResult.aadhaar = (await docClient.post('/analyze', aadForm, { headers: aadForm.getHeaders() })).data;
  } catch (err) {
    logger.warn('Document service error: ' + err.message);
    docResult = {
      error: err.message,
      pan: { valid: false, tamper_score: 100, issues: ['document_service_unavailable'] },
      aadhaar: { valid: false, tamper_score: 100, issues: ['document_service_unavailable'] },
    };
  }

  const nameMatch = compareNames(session.name, docResult?.pan?.extracted?.name || '');
  session.docResult = { ...docResult, nameMatch };
  session.status = 'DOCS_UPLOADED';
  session.logs.push({ step: 'DOCS_ANALYZED', timestamp: new Date(), data: session.docResult });
  await session.save();

  res.json({ sessionId, docResult: session.docResult, message: 'Documents analyzed' });
};

exports.verifyFace = async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

  const session = await sessionRepository.findOne({ sessionId });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (!session.aadhaarPath) return res.status(400).json({ error: 'Upload documents first' });

  const selfieFile = req.file;
  if (!selfieFile) return res.status(400).json({ error: 'Selfie image is required' });
  session.selfiePath = selfieFile.path;

  let bioResult = {};
  try {
    const FormData = require('form-data');
    const bioForm = new FormData();
    bioForm.append('selfie', fs.createReadStream(selfieFile.path), selfieFile.originalname);
    bioForm.append('doc_image', fs.createReadStream(session.aadhaarPath), 'aadhaar.jpg');
    bioResult = (await bioClient.post('/verify', bioForm, { headers: bioForm.getHeaders() })).data;
  } catch (err) {
    logger.warn('Biometric service error: ' + err.message);
    bioResult = { face_match_score: 0, liveness_score: 0, face_verified: false, error: err.message };
  }
  session.bioResult = bioResult;

  let fraudFlag = false;
  let graphSignals = { linkedUsers: 0, linkedPanCards: 0 };
  try {
    const driver = getDriver();
    const neo4jSession = driver.session();
    const panNumber = session.docResult?.pan?.extracted?.pan_number || 'UNKNOWN';
    const deviceId = req.headers['x-device-id'] || session.deviceId || `WEB_${session.phone}`;
    const geolocation = req.body.geolocation ? JSON.parse(req.body.geolocation) : null;

    try {
      await neo4jSession.run(
        `MERGE (u:User {phone: $phone})
         SET u.name = $name, u.sessionId = $sessionId
         MERGE (d:Device {deviceId: $deviceId})
         SET d.platform = $platform, d.timezone = $timezone, d.locale = $locale
         MERGE (p:PAN {number: $panNumber})
         FOREACH (_ IN CASE WHEN $city IS NULL THEN [] ELSE [1] END | SET d.city = $city)
         FOREACH (_ IN CASE WHEN $region IS NULL THEN [] ELSE [1] END | SET d.region = $region)
         MERGE (u)-[:USES]->(d)
         MERGE (u)-[:HAS]->(p)`,
        {
          phone: session.phone,
          name: session.name || '',
          sessionId,
          deviceId,
          panNumber,
          platform: session.deviceContext?.platform || '',
          timezone: session.deviceContext?.timezone || '',
          locale: session.deviceContext?.language || '',
          city: geolocation?.city || null,
          region: geolocation?.region || null,
        }
      );

      const fraudRes = await neo4jSession.run(
        `MATCH (d:Device {deviceId: $deviceId})
         OPTIONAL MATCH (d)<-[:USES]-(u:User)-[:HAS]->(p:PAN)
         RETURN count(DISTINCT u) AS userCount, count(DISTINCT p) AS panCount`,
        { deviceId }
      );

      const userCount = fraudRes.records[0]?.get('userCount').toNumber() || 0;
      const panCount = fraudRes.records[0]?.get('panCount').toNumber() || 0;
      graphSignals = { linkedUsers: userCount, linkedPanCards: panCount };
      fraudFlag = userCount > 3 || panCount > 3;
      logger.info(`Fraud check: deviceId=${deviceId} userCount=${userCount} panCount=${panCount} flagged=${fraudFlag}`);
    } finally {
      await neo4jSession.close();
    }
  } catch (err) {
    logger.warn('Neo4j error: ' + err.message);
  }

  const nameMatch = session.docResult?.nameMatch || compareNames(session.name, session.docResult?.pan?.extracted?.name || '');
  const watchlistResult = runWatchlistChecks({
    name: session.name,
    phone: session.phone,
    panNumber: session.docResult?.pan?.extracted?.pan_number || '',
  });
  const registryResult = verifyRegistries({
    docResult: session.docResult,
    bioResult,
    applicant: { name: session.name, phone: session.phone },
  });

  session.fraudFlag = fraudFlag;
  session.watchlistHits = watchlistResult.hits;
  session.registryResult = registryResult;
  session.logs.push({ step: 'BIOMETRIC_CHECKED', timestamp: new Date(), data: bioResult });
  session.logs.push({ step: 'FRAUD_CHECKED', timestamp: new Date(), data: { fraudFlag, graphSignals } });
  session.logs.push({ step: 'WATCHLIST_CHECKED', timestamp: new Date(), data: watchlistResult });
  session.logs.push({ step: 'REGISTRY_CHECKED', timestamp: new Date(), data: registryResult });

  const docValid = (session.docResult?.pan?.valid && session.docResult?.aadhaar?.valid) ?? false;
  const docTamperPenalty = Math.max(
    (session.docResult?.pan?.tamper_score || 0) >= 60 ? 15 : 0,
    (session.docResult?.aadhaar?.tamper_score || 0) >= 60 ? 15 : 0
  );
  const registryPenalty = registryResult.reviewReasons.length ? 15 : 0;
  const nameMatchPenalty = nameMatch.matched ? 0 : 10;

  let { riskScore, decision, breakdown } = calculateRisk({
    face_match_score: bioResult.face_match_score ?? 0,
    liveness_score: bioResult.liveness_score ?? 0,
    doc_valid: docValid,
    fraud_flag: fraudFlag,
    injection_flag: session.injectionRisk?.injectionFlag || false,
    precheck_risk: session.precheckRisk ?? 0,
    watchlist_flag: watchlistResult.flagged,
    registry_penalty: registryPenalty,
    doc_tamper_penalty: docTamperPenalty,
    name_match_penalty: nameMatchPenalty,
  });

  if (watchlistResult.flagged) {
    decision = 'REJECTED';
    riskScore = Math.max(riskScore, 85);
  } else if (registryResult.reviewReasons.length && decision === 'APPROVED') {
    decision = 'REVIEW';
    riskScore = Math.max(riskScore, 35);
  }

  session.riskScore = riskScore;
  session.decision = decision;
  session.riskBreakdown = breakdown;
  session.status = 'COMPLETED';
  session.completedAt = new Date();

  session.complianceResult = buildComplianceResult({
    session,
    registryResult,
    watchlistResult,
    nameMatch,
    graphSignals,
  });
  session.reviewerReport = createReviewerReport(session);
  session.logs.push({ step: 'RISK_SCORED', timestamp: new Date(), data: { riskScore, decision, breakdown } });
  session.logs.push({ step: 'REPORT_GENERATED', timestamp: new Date(), data: session.reviewerReport.summary });
  await session.save();

  logger.info(`KYC completed: ${sessionId} -> ${decision} (risk=${riskScore})`);
  res.json({
    sessionId,
    riskScore,
    decision,
    bioResult,
    fraudFlag,
    graphSignals,
    watchlistHits: session.watchlistHits,
    registryResult,
    complianceResult: session.complianceResult,
    reviewerReport: session.reviewerReport,
    adaptiveAuth: {
      fallbackOffered: riskScore > 29,
      accessibilityMode: req.body.accessibilityMode === 'true',
    },
    message: 'KYC verification complete',
  });
};

exports.getResult = async (req, res) => {
  const session = await sessionRepository.findOneLean({ sessionId: req.params.id });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
};

exports.getReport = async (req, res) => {
  const session = await sessionRepository.findOneLean({ sessionId: req.params.id });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session.reviewerReport || createReviewerReport(session));
};
