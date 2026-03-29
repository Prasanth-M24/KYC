const watchlists = require('../data/watchlists.json');

function normalize(value = '') {
  return String(value).trim().toUpperCase().replace(/\s+/g, ' ');
}

function runWatchlistChecks({ name = '', phone = '', panNumber = '' }) {
  const hits = [];
  const normalizedName = normalize(name);
  const normalizedPhone = String(phone).trim();
  const normalizedPan = normalize(panNumber);

  if (watchlists.names.some((item) => normalize(item) === normalizedName)) {
    hits.push({ type: 'name', value: normalizedName, source: 'internal_watchlist' });
  }
  if (watchlists.phones.includes(normalizedPhone)) {
    hits.push({ type: 'phone', value: normalizedPhone, source: 'internal_watchlist' });
  }
  if (watchlists.panNumbers.some((item) => normalize(item) === normalizedPan)) {
    hits.push({ type: 'pan', value: normalizedPan, source: 'internal_watchlist' });
  }

  return {
    flagged: hits.length > 0,
    hits,
  };
}

module.exports = { runWatchlistChecks };
