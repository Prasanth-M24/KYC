const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const kycController = require('../controllers/kycController');
const { simpleRateLimit } = require('../middleware/security');

const startLimiter = simpleRateLimit({ windowMs: 60 * 1000, maxRequests: 10 });
const uploadLimiter = simpleRateLimit({ windowMs: 60 * 1000, maxRequests: 20 });
const verifyLimiter = simpleRateLimit({ windowMs: 60 * 1000, maxRequests: 10 });

// Start a new KYC session
router.post('/start', startLimiter, kycController.startSession);

// Upload PAN + Aadhaar documents
router.post('/upload-docs', upload.fields([
  { name: 'pan', maxCount: 1 },
  { name: 'aadhaar', maxCount: 1 }
]), uploadLimiter, kycController.uploadDocs);

// Verify face / selfie
router.post('/verify-face', upload.single('selfie'), verifyLimiter, kycController.verifyFace);

// Get final KYC result
router.get('/result/:id', kycController.getResult);
router.get('/report/:id', kycController.getReport);

module.exports = router;
