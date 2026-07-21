const { API_BASE_URL, REQUEST_TIMEOUT, isApiConfigured } = require('../config/api');

function request({ url, method = 'GET', data = {} }) {
  if (!isApiConfigured()) {
    return Promise.reject(new Error('API_BASE_URL_NOT_CONFIGURED'));
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE_URL}${url}`,
      method,
      data,
      timeout: REQUEST_TIMEOUT,
      header: {
        'content-type': 'application/json'
      },
      success: ({ statusCode, data: response }) => {
        if (statusCode >= 200 && statusCode < 300) {
          resolve(response);
          return;
        }
        reject(new Error(`HTTP_${statusCode}`));
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
      url: `${API_BASE_URL}${url}`,
      filePath,
      name,
      formData,
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
        reject(new Error(response.userMessage || `HTTP_${statusCode}`));
      },
      fail: reject
    });
  });
}

module.exports = {
  get,
  post,
  uploadFile,
  isApiConfigured
};
