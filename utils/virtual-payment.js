function clientPlatform() {
  try { return String((wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()).platform || '').toLowerCase(); }
  catch (_) { return ''; }
}
function checkoutFields(loginCode) { return { loginCode, paymentChannel: 'virtual', clientPlatform: clientPlatform() }; }
function requestVirtualPayment(params) {
  return new Promise((resolve, reject) => {
    if (!wx.requestVirtualPayment || (wx.canIUse && !wx.canIUse('requestVirtualPayment'))) {
      return reject(new Error('当前微信版本暂不支持支付，请升级微信后重试'));
    }
    if (clientPlatform() === 'ios') {
      const version = String((wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync()).version || '');
      const parts = version.split('.').map(Number), minimum = [8, 0, 68];
      let supported = false;
      for (let i = 0; i < 3; i++) { if ((parts[i] || 0) > minimum[i]) { supported = true; break; } if ((parts[i] || 0) < minimum[i]) break; if (i === 2) supported = true; }
      if (!supported) return reject(new Error('请升级微信至8.0.68或更新版本后支付'));
    }
    if (!params || params.mode !== 'short_series_goods' || typeof params.signData !== 'string' || !params.paySig || !params.signature) {
      return reject(new Error('支付信息暂不可用，请刷新订单后重试'));
    }
    wx.requestVirtualPayment({ mode: params.mode, signData: params.signData, paySig: params.paySig, signature: params.signature,
      success: resolve, fail: reject });
  });
}
module.exports = { checkoutFields, requestVirtualPayment };
