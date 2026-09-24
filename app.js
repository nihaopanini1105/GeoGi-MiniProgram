const { captureAttribution } = require('./utils/attribution');

App({
  globalData: {
    brandName: 'GeoGi 几何智引',
    contactEmail: 'geogi@geogi.cn',
    officialWebsite: 'www.geogi.cn'
  },

  onLaunch(options) {
    void captureAttribution(options || {});
  },

  onShow(options) {
    void captureAttribution(options || {});
  }
});
