function isConfigured() {
  return String(process.env.ENABLE_STRICT_REGISTRY_MODE || 'true').toLowerCase() === 'true';
}

function verifyRegistries({ docResult = {}, bioResult = {}, applicant = {} }) {
  const panNumber = docResult?.pan?.extracted?.pan_number || '';
  const aadhaarNumber = docResult?.aadhaar?.extracted?.aadhaar_number || '';
  const faceVerified = Boolean(bioResult?.face_verified);
  const docValid = Boolean(docResult?.pan?.valid && docResult?.aadhaar?.valid);

  const result = {
    strictMode: isConfigured(),
    panRegistry: panNumber ? 'MATCHED_FORMAT' : 'UNVERIFIED',
    aadhaarRegistry: aadhaarNumber ? 'MATCHED_FORMAT' : 'UNVERIFIED',
    ckycrReady: Boolean(applicant?.name && applicant?.phone && panNumber),
    uidaiFaceAuth: faceVerified ? 'LOCAL_MATCH_ONLY' : 'FAILED_LOCAL_MATCH',
    externalDependenciesAvailable: false,
    reviewReasons: [],
  };

  if (!docValid) {
    result.reviewReasons.push('document_validation_failed');
  }
  if (!aadhaarNumber) {
    result.reviewReasons.push('aadhaar_unverified');
  }
  if (!panNumber) {
    result.reviewReasons.push('pan_unverified');
  }
  if (!faceVerified) {
    result.reviewReasons.push('face_auth_unverified');
  }
  if (result.strictMode && !result.externalDependenciesAvailable) {
    result.reviewReasons.push('external_registry_connector_not_configured');
  }

  return result;
}

module.exports = { verifyRegistries };
