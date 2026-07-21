App({
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        traceUser: true
      });
    }
  },

  globalData: {
    brandName: 'GeoGi 几何智引',
    contactEmail: 'hello@geogi.ai'
  }
});
