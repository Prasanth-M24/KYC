function normalizeName(value = '') {
  return String(value)
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compareNames(left = '', right = '') {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (!a || !b) {
    return { score: 0, matched: false, reason: 'name_missing' };
  }

  const tokensA = new Set(a.split(' '));
  const tokensB = new Set(b.split(' '));
  const overlap = [...tokensA].filter((token) => tokensB.has(token)).length;
  const score = overlap / Math.max(tokensA.size, tokensB.size, 1);

  return {
    score: Number(score.toFixed(2)),
    matched: score >= 0.6,
    reason: score >= 0.6 ? 'name_match' : 'name_mismatch',
  };
}

module.exports = { compareNames, normalizeName };
