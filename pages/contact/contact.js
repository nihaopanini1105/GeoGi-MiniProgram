const app = getApp();

Page({
  data: {
    email: app.globalData.contactEmail,
    fields: [
      { label: '品牌名称', name: 'brand', placeholder: '请输入品牌或公司名称' },
      { label: '联系人', name: 'name', placeholder: '请输入联系人姓名' },
      { label: '联系方式', name: 'contact', placeholder: '手机号或微信号' }
    ]
  },

  copyEmail() {
    wx.setClipboardData({
      data: this.data.email,
      success: () => {
        wx.showToast({ title: '邮箱已复制', icon: 'success' });
      }
    });
  },

  submitForm(event) {
    const values = event.detail.value;
    if (!values.brand || !values.name || !values.contact) {
      wx.showToast({ title: '请补全信息', icon: 'none' });
      return;
    }

    wx.showToast({ title: '已记录需求', icon: 'success' });
  }
});
