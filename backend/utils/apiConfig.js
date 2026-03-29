const axios = require('axios');
const logger = require('./logger');

const DOC_SERVICE = process.env.DOC_SERVICE_URL || 'http://localhost:8001';
const BIO_SERVICE = process.env.BIO_SERVICE_URL || 'http://localhost:8002';

const createAxiosInstance = (baseURL) => {
  const instance = axios.create({
    baseURL,
    timeout: 60000, // 60s max to allow local CPU ML processing
  });

  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const config = error.config;
      if (!config || !config.retry) {
        config.retry = 0;
      }
      
      const MAX_RETRIES = 2;
      
      if (config.retry >= MAX_RETRIES) {
        logger.error(`API Call failed after ${MAX_RETRIES} retries to ${config.url}: ${error.message}`);
        return Promise.reject(error);
      }

      config.retry += 1;
      logger.warn(`API Call failed (Attempt ${config.retry}/${MAX_RETRIES}) for ${config.url}. Retrying...`);
      
      // Delay before retrying (exponential backoff)
      const delay = 1000 * config.retry;
      await new Promise((resolve) => setTimeout(resolve, delay));
      
      return instance(config);
    }
  );

  return instance;
};

const docClient = createAxiosInstance(DOC_SERVICE);
const bioClient = createAxiosInstance(BIO_SERVICE);

module.exports = {
  docClient,
  bioClient
};
