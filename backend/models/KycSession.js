const mongoose = require('mongoose');

const logEntrySchema = new mongoose.Schema({
  step:      { type: String, required: true },
  timestamp: { type: Date,   default: Date.now },
  data:      { type: mongoose.Schema.Types.Mixed }
});

const kycSessionSchema = new mongoose.Schema({
  sessionId:   { type: String, required: true, unique: true, index: true },
  phone:       { type: String, required: true },
  name:        { type: String, default: '' },
  deviceId:    { type: String },
  deviceContext: { type: mongoose.Schema.Types.Mixed },
  precheckRisk: { type: Number, default: 0 },
  injectionRisk: { type: mongoose.Schema.Types.Mixed },
  status:      { type: String, enum: ['STARTED','DOCS_UPLOADED','COMPLETED','FAILED'], default: 'STARTED' },
  panPath:     { type: String },
  aadhaarPath: { type: String },
  selfiePath:  { type: String },
  docResult:   { type: mongoose.Schema.Types.Mixed },
  bioResult:   { type: mongoose.Schema.Types.Mixed },
  registryResult: { type: mongoose.Schema.Types.Mixed },
  complianceResult: { type: mongoose.Schema.Types.Mixed },
  watchlistHits: { type: [mongoose.Schema.Types.Mixed], default: [] },
  reviewerReport: { type: mongoose.Schema.Types.Mixed },
  fraudFlag:   { type: Boolean, default: false },
  riskBreakdown: { type: mongoose.Schema.Types.Mixed },
  riskScore:   { type: Number },
  decision:    { type: String, enum: ['APPROVED','REVIEW','REJECTED'] },
  logs:        [logEntrySchema],
  completedAt: { type: Date },
  createdAt:   { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('KycSession', kycSessionSchema);
