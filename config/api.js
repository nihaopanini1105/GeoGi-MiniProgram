const PROD_API_BASE_URL = 'https://api.geogi.cn';
const LOCAL_API_BASE_URL = 'http://127.0.0.1:3107';

function getEnvVersion() {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion;
  } catch (error) {
    return 'release';
  }
}

const API_BASE_URL = getEnvVersion() === 'develop'
  ? LOCAL_API_BASE_URL
  : PROD_API_BASE_URL;

function isApiConfigured() {
  return Boolean(API_BASE_URL);
}

module.exports = {
  API_BASE_URL,
  LOCAL_API_BASE_URL,
  PROD_API_BASE_URL,
  REQUEST_TIMEOUT: 60000,
  isApiConfigured
};
