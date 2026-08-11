const { get, isApiConfigured } = require('../../utils/request');

Page({
  data: {
    article: null,
    loading: true,
    error: ''
  },

  onLoad(options) {
    const id = options.id || '';
    if (!id) {
      this.setData({ loading: false, error: '缺少文章编号，请返回研究中心重新打开。' });
      return;
    }
    this.loadRemoteArticle(id);
  },

  async loadRemoteArticle(id) {
    if (!isApiConfigured()) {
      this.setData({ loading: false, error: '研究中心服务暂未连接。' });
      return;
    }

    this.setData({ loading: true, error: '' });
    try {
      const result = await get(`/api/articles/${encodeURIComponent(id)}`);
      if (!result || !result.ok || !result.article) {
        throw new Error('文章暂时无法读取');
      }
      this.setData({
        article: normalizeRemoteArticle(result.article),
        error: ''
      });
    } catch (error) {
      this.setData({
        article: null,
        error: '暂时无法同步这篇研究内容，请稍后重试。'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  refresh() {
    const pages = getCurrentPages();
    const current = pages[pages.length - 1];
    const id = current && current.options ? current.options.id : '';
    if (id) this.loadRemoteArticle(id);
  },

  onShareAppMessage() {
    const article = this.data.article || {};
    return {
      title: article.title || 'GeoGi 研究中心',
      path: '/pages/research/research'
    };
  },

  goResearch() {
    wx.switchTab({ url: '/pages/research/research' });
  },

  goDiagnosis() {
    wx.setStorageSync('geogi_start_new_diagnosis', true);
    wx.switchTab({ url: '/pages/diagnosis/diagnosis' });
  }
});

function normalizeRemoteArticle(article) {
  const body = article.body || article.desc || '';
  return {
    ...article,
    sections: Array.isArray(article.sections) && article.sections.length
      ? article.sections
      : body.split('\n').map((paragraph) => paragraph.trim()).filter(Boolean).map((paragraph) => ({
          title: '',
          body: paragraph
        }))
  };
}
