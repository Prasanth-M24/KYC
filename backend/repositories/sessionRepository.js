const KycSession = require('../models/KycSession');
const { isMongoAvailable } = require('../services/mongoService');

const memoryStore = new Map();

class MemorySession {
  constructor(data) {
    Object.assign(this, data);
  }

  async save() {
    this.updatedAt = new Date();
    memoryStore.set(this.sessionId, JSON.parse(JSON.stringify(this)));
    return this;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function create(data) {
  if (isMongoAvailable()) {
    return KycSession.create(data);
  }

  const record = new MemorySession({
    ...clone(data),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  memoryStore.set(record.sessionId, clone(record));
  return record;
}

async function findOne(query) {
  if (isMongoAvailable()) {
    return KycSession.findOne(query);
  }

  if (!query.sessionId || !memoryStore.has(query.sessionId)) {
    return null;
  }

  return new MemorySession(clone(memoryStore.get(query.sessionId)));
}

async function findOneLean(query) {
  if (isMongoAvailable()) {
    return KycSession.findOne(query).lean();
  }

  const record = await findOne(query);
  return record ? clone(record) : null;
}

module.exports = {
  create,
  findOne,
  findOneLean,
};
