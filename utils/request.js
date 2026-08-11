const { API_BASE_URL, REQUEST_TIMEOUT, isApiConfigured } = require('../config/api');

function getCustomerToken() {
  return String(wx.getStorageSync('geogi_customer_token') || '').trim();
}

function getAuthHeader() {
  const token = getCustomerToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function persistCustomerSession(response) {
  if (!response || !response.customerToken) return;
  wx.setStorageSync('geogi_customer_token', response.customerToken);
  if (response.customerTokenExpiresAt) {
    wx.setStorageSync('geogi_customer_token_expires_at', response.customerTokenExpiresAt);
  }
}

function resolveUrl(url) {
  const value = String(url || '');
  if (/^https:\/\//i.test(value)) return value;
  return `${API_BASE_URL}${value.startsWith('/') ? value : `/${value}`}`;
}

function request({ url, method = 'GET', data = {} }) {
  if (!isApiConfigured()) {
    return Promise.reject(new Error('API_BASE_URL_NOT_CONFIGURED'));
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: resolveUrl(url),
      method,
      data,
      timeout: REQUEST_TIMEOUT,
      header: {
        'content-type': 'application/json',
        ...getAuthHeader()
      },
      success: ({ statusCode, data: response }) => {
        if (statusCode >= 200 && statusCode < 300) {
          persistCustomerSession(response);
          resolve(response);
          return;
        }
        const message = response && response.userMessage
          ? response.userMessage
          : (statusCode === 401 ? '身份验证已失效，请重新授权手机号' : `HTTP_${statusCode}`);
        reject(new Error(message));
      },
      fail: reject
    });
  });
}

function get(url, data) {
  return request({ url, method: 'GET', data });
}

function post(url, data) {
  return request({ url, method: 'POST', data });
}

function uploadFile(url, filePath, name = 'file', formData = {}) {
  if (!isApiConfigured()) {
    return Promise.reject(new Error('API_BASE_URL_NOT_CONFIGURED'));
  }

  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: resolveUrl(url),
      filePath,
      name,
      formData,
      header: getAuthHeader(),
      timeout: REQUEST_TIMEOUT,
      success: ({ statusCode, data }) => {
        let response = {};
        try {
          response = data ? JSON.parse(data) : {};
        } catch (error) {
          reject(new Error('UPLOAD_RESPONSE_INVALID'));
          return;
        }
        if (statusCode >= 200 && statusCode < 300 && response.ok) {
          resolve(response);
          return;
        }
        reject(new Error(response.userMessage || (statusCode === 401 ? '身份验证已失效，请重新授权手机号' : `HTTP_${statusCode}`)));
      },
      fail: reject
    });
  });
}

function downloadFile(url) {
  if (!isApiConfigured()) {
    return Promise.reject(new Error('API_BASE_URL_NOT_CONFIGURED'));
  }

  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: resolveUrl(url),
      header: getAuthHeader(),
      timeout: REQUEST_TIMEOUT,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res);
          return;
        }
        reject(new Error(res.statusCode === 401 ? '身份验证已失效，请重新授权手机号' : '报告下载失败'));
      },
      fail: reject
    });
  });
}

module.exports = {
  get,
  post,
  uploadFile,
  downloadFile,
  getAuthHeader,
  getCustomerToken,
  isApiConfigured
};
