const API_BASE_URL = 'https://api.geogi.cn';

function isApiConfigured() {
  return !API_BASE_URL.includes('your-api-domain.com');
}

module.exports = {
  API_BASE_URL,
  REQUEST_TIMEOUT: 12000,
  isApiConfigured
};
