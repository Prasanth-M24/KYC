/**
 * Risk Scoring Engine
 * Calculates a composite risk score (0-100) based on weighted signals.
 * Lower score = Lower risk.
 */
function calculateRisk({
  face_match_score = 0,
  liveness_score = 0,
  doc_valid = false,
  fraud_flag = false,
  injection_flag = false,
  precheck_risk = 0,
  watchlist_flag = false,
  registry_penalty = 0,
  doc_tamper_penalty = 0,
  name_match_penalty = 0,
}) {
  let risk = 0;
  const breakdown = {};

  if (face_match_score < 0.7) {
    risk += 40;
    breakdown.face_match = `+40.0 (match_score=${face_match_score.toFixed(2)} below 0.70)`;
  } else {
    breakdown.face_match = `+0.0 (match_score=${face_match_score.toFixed(2)})`;
  }

  if (liveness_score < 0.5) {
    risk += 30;
    breakdown.liveness = `+30.0 (liveness_score=${liveness_score.toFixed(2)} below 0.50)`;
  } else {
    breakdown.liveness = `+0.0 (liveness_score=${liveness_score.toFixed(2)})`;
  }

  if (!doc_valid) {
    risk += 20;
    breakdown.document = '+20.0 (document validation failed)';
  } else {
    breakdown.document = '+0.0 (document valid)';
  }

  if (fraud_flag) {
    risk += 30;
    breakdown.fraud = '+30.0 (fraud flag raised by Neo4j)';
  } else {
    breakdown.fraud = '+0.0 (no fraud flag)';
  }

  if (injection_flag) {
    risk += 20;
    breakdown.injection = '+20.0 (possible injection attack)';
  } else {
    breakdown.injection = '+0.0 (no injection signal)';
  }

  if (precheck_risk > 0) {
    risk += precheck_risk;
    breakdown.precheck = `+${precheck_risk.toFixed(1)} (device precheck risk)`;
  } else {
    breakdown.precheck = '+0.0 (device precheck clean)';
  }

  if (watchlist_flag) {
    risk += 30;
    breakdown.watchlist = '+30.0 (internal watchlist hit)';
  } else {
    breakdown.watchlist = '+0.0 (no watchlist hit)';
  }

  if (registry_penalty > 0) {
    risk += registry_penalty;
    breakdown.registry = `+${registry_penalty.toFixed(1)} (registry or CKYCR verification gap)`;
  } else {
    breakdown.registry = '+0.0 (registry status acceptable)';
  }

  if (doc_tamper_penalty > 0) {
    risk += doc_tamper_penalty;
    breakdown.doc_tamper = `+${doc_tamper_penalty.toFixed(1)} (document tamper signal)`;
  } else {
    breakdown.doc_tamper = '+0.0 (tamper score acceptable)';
  }

  if (name_match_penalty > 0) {
    risk += name_match_penalty;
    breakdown.name_match = `+${name_match_penalty.toFixed(1)} (customer name mismatch)`;
  } else {
    breakdown.name_match = '+0.0 (customer name aligned with document)';
  }

  risk = Math.min(100, Math.round(risk));

  let decision;
  if (risk <= 29) decision = 'APPROVED';
  else if (risk <= 70) decision = 'REVIEW';
  else decision = 'REJECTED';

  return { riskScore: risk, decision, breakdown };
}

module.exports = { calculateRisk };
