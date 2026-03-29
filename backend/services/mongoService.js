const mongoose = require('mongoose');
const logger = require('../utils/logger');

let isConnected = false;

async function connectMongo() {
  if (isConnected) return;
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 3000 });
    isConnected = true;
    logger.info('MongoDB connected: ' + process.env.MONGO_URI);
  } catch (err) {
    isConnected = false;
    logger.warn('MongoDB connection failed (continuing with in-memory sessions): ' + err.message);
  }
}

function isMongoAvailable() {
  return isConnected;
}

module.exports = { connectMongo, isMongoAvailable };
