function createReviewerReport(session) {
  const docResult = session.docResult || {};
  const bioResult = session.bioResult || {};
  const registryResult = session.registryResult || {};
  const complianceResult = session.complianceResult || {};

  return {
    generatedAt: new Date(),
    summary: {
      customerName: session.name,
      phone: session.phone,
      decision: session.decision,
      riskScore: session.riskScore,
      status: session.status,
    },
    documents: {
      panValid: Boolean(docResult?.pan?.valid),
      aadhaarValid: Boolean(docResult?.aadhaar?.valid),
      panNumber: docResult?.pan?.extracted?.pan_number || null,
      aadhaarMasked: docResult?.aadhaar?.extracted?.aadhaar_number
        ? `XXXX-XXXX-${docResult.aadhaar.extracted.aadhaar_number.slice(-4)}`
        : null,
      tamperScores: {
        pan: docResult?.pan?.tamper_score ?? null,
        aadhaar: docResult?.aadhaar?.tamper_score ?? null,
      },
    },
    biometrics: {
      faceMatchScore: bioResult?.face_match_score ?? null,
      livenessScore: bioResult?.liveness_score ?? null,
      faceVerified: Boolean(bioResult?.face_verified),
      method: bioResult?.match_method || bioResult?.method || null,
    },
    graphAndWatchlist: {
      fraudFlag: Boolean(session.fraudFlag),
      watchlistFlag: Boolean(session.watchlistHits?.length),
      watchlistHits: session.watchlistHits || [],
    },
    compliance: {
      legalFramework: [
        'RBI Master Direction - Know Your Customer (KYC) Direction, 2016, updated as on August 14, 2025',
        'RBI FAQs on Master Direction on KYC dated June 9, 2025',
        'UIDAI Aadhaar Face Authentication integration is represented as a bank-side control point'
      ],
      controls: complianceResult.controls || [],
      reviewerNotes: complianceResult.reviewerNotes || [],
      registryStatus: registryResult,
      recommendation: complianceResult.recommendation || session.decision,
    },
    employeeAction: complianceResult.employeeAction || 'Review extracted signals and archive the audit trail before account opening.',
  };
}

module.exports = { createReviewerReport };
