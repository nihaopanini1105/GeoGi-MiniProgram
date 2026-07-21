const fallbackArticles = [
  {
    id: 'what-is-geo',
    category: 'GEO 基础',
    title: '什么是 GEO：AI 搜索时代的品牌增长方法',
    desc: '理解生成式引擎优化如何影响品牌被发现、被解释和被推荐。',
    date: '2026-07-21'
  },
  {
    id: 'brand-entity',
    category: '品牌诊断',
    title: '品牌实体画像：让 AI 知道你是谁',
    desc: '从名称、业务、受众、优势和证据五个维度建立稳定的品牌识别。',
    date: '2026-07-21'
  },
  {
    id: 'source-chain',
    category: '指标与方法',
    title: 'AI 答案里的证据链：内容与权威信源如何协同',
    desc: '品牌要进入 AI 答案，不只需要内容，还需要可验证、可引用的信任结构。',
    date: '2026-07-21'
  }
];

const { get, isApiConfigured } = require('../../utils/request');
const { track } = require('../../utils/analytics');

Page({
  data: {
    activeCategory: '全部',
    categories: ['全部', 'GEO 基础', '品牌诊断', '行业研究', 'AI 平台', '指标与方法'],
    articles: fallbackArticles,
    filteredArticles: fallbackArticles,
    loading: false,
    usingFallback: true
  },

  onLoad() {
    this.loadArticles();
  },

  loadArticles() {
    if (!isApiConfigured()) {
      this.setData({
        articles: fallbackArticles,
        filteredArticles: fallbackArticles,
        usingFallback: true,
        loading: false
      });
      return;
    }

    this.setData({ loading: true });
    get('/api/articles', {
      limit: 50
    })
      .then((result) => {
        const remoteItems = result && result.ok ? (result.items || result.articles) : [];
        const articles = remoteItems && remoteItems.length
          ? remoteItems
          : fallbackArticles;

        this.setData({
          articles,
          usingFallback: articles === fallbackArticles
        });
        this.applyCategory(this.data.activeCategory, articles);
      })
      .catch(() => {
        this.setData({
          articles: fallbackArticles,
          usingFallback: true
        });
        this.applyCategory(this.data.activeCategory, fallbackArticles);
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },

  changeCategory(event) {
    const category = event.currentTarget.dataset.category;
    this.applyCategory(category, this.data.articles);
  },

  applyCategory(category, articles) {
    const filteredArticles = category === '全部'
      ? articles
      : articles.filter((article) => article.category === category);

    this.setData({
      activeCategory: category,
      filteredArticles
    });
  },

  openArticle(event) {
    const id = event.currentTarget.dataset.id;
    const article = this.data.articles.find((item) => item.id === id);
    track('research_card_click', {
      article_id: id,
      category: article ? article.category : ''
    });
    wx.navigateTo({ url: `/pages/research-detail/research-detail?id=${id}` });
  }
});
