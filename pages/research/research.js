const { get, isApiConfigured } = require('../../utils/request');
const { track } = require('../../utils/analytics');

Page({
  data: {
    loading: false,
    error: '',
    categories: ['全部'],
    activeCategory: '全部',
    keyword: '',
    articles: []
  },

  onLoad() {
    this.loadArticles();
  },

  onShow() {
    track('research_view', {
      category: this.data.activeCategory || '全部'
    });
  },

  async loadArticles() {
    if (!isApiConfigured()) {
      this.setData({
        loading: false,
        error: '研究中心服务暂未连接',
        articles: []
      });
      return;
    }

    this.setData({ loading: true, error: '' });
    try {
      const result = await get('/api/articles', {
        category: this.data.activeCategory,
        keyword: this.data.keyword.trim(),
        limit: 50
      });
      if (!result || !result.ok) {
        throw new Error(result && result.userMessage ? result.userMessage : '研究中心加载失败');
      }

      this.setData({
        categories: Array.isArray(result.categories) && result.categories.length ? result.categories : ['全部'],
        articles: result.items || result.articles || [],
        error: ''
      });
    } catch (error) {
      this.setData({
        error: '暂时无法同步研究内容，请稍后刷新。',
        articles: []
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  switchCategory(event) {
    const category = event.currentTarget.dataset.category || '全部';
    if (category === this.data.activeCategory) return;
    this.setData({ activeCategory: category }, () => this.loadArticles());
    track('research_category_select', { category });
  },

  inputKeyword(event) {
    const keyword = event.detail.value || '';
    this.setData({ keyword });
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.loadArticles();
      track('research_search', { keyword: keyword.trim() });
    }, 350);
  },

  openArticle(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    track('research_card_click', {
      article_id: id,
      category: this.data.activeCategory
    });
    wx.navigateTo({
      url: `/pages/research-detail/research-detail?id=${encodeURIComponent(id)}`
    });
  },

  onPullDownRefresh() {
    this.loadArticles().finally(() => wx.stopPullDownRefresh());
  },

  onUnload() {
    clearTimeout(this.searchTimer);
  }
});
