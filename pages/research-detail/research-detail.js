const { get, isApiConfigured } = require('../../utils/request');

const articles = {
  'what-is-geo': {
    category: 'GEO 基础',
    title: '什么是 GEO：AI 搜索时代的品牌增长方法',
    desc: 'GEO 关注品牌如何在生成式 AI 答案中被识别、被解释和被推荐。',
    date: '2026-07-21',
    sections: [
      {
        title: '从搜索结果到 AI 答案',
        body: '用户不再只点击搜索结果页，而是直接向 AI 询问“推荐谁”“怎么选”“哪家更靠谱”。品牌能否进入答案，取决于 AI 是否能理解品牌实体、业务范围、优势证据和外部信源。'
      },
      {
        title: 'GeoGi 如何检测',
        body: 'GeoGi 会结合品牌研究、问题建模、跨平台人工测试和证据追溯，判断品牌在豆包、元宝、千问、DeepSeek、Kimi 等平台中的表现。'
      }
    ]
  },
  'brand-entity': {
    category: '品牌诊断',
    title: '品牌实体画像：让 AI 知道你是谁',
    desc: '稳定的品牌实体画像，是 AI 正确理解品牌的基础。',
    date: '2026-07-21',
    sections: [
      {
        title: '品牌实体不是一句简介',
        body: '它包括标准名称、别名、所属企业、核心业务、目标客户、差异化优势、公开信源和潜在同名风险。信息越清晰，AI 越不容易误认或混淆。'
      },
      {
        title: '为什么需要核验',
        body: '客户自述和公开信息可能不一致。GeoGi 会区分官方信息、第三方资料、用户反馈和风险信息，避免把未经证实的内容写成结论。'
      }
    ]
  },
  'source-chain': {
    category: '指标与方法',
    title: 'AI 答案里的证据链：内容与权威信源如何协同',
    desc: '进入 AI 答案不仅需要内容，还需要可验证、可引用的信任结构。',
    date: '2026-07-21',
    sections: [
      {
        title: '内容解决“说清楚”',
        body: '官网、公众号、产品页和研究文章需要清楚表达品牌是谁、做什么、服务谁、为什么可信。'
      },
      {
        title: '信源解决“可信赖”',
        body: '媒体报道、行业平台、客户评价、公开案例和权威目录，会影响 AI 对品牌可靠性的判断。GeoGi 会把内容缺口和信源缺口拆开分析。'
      }
    ]
  }
};

Page({
  data: {
    article: articles['what-is-geo'],
    loading: false,
    related: [
      { id: 'what-is-geo', title: '什么是 GEO：AI 搜索时代的品牌增长方法' },
      { id: 'brand-entity', title: '品牌实体画像：让 AI 知道你是谁' },
      { id: 'source-chain', title: 'AI 答案里的证据链' }
    ]
  },

  onLoad(options) {
    const id = options.id || 'what-is-geo';
    this.setData({ article: articles[id] || articles['what-is-geo'] });
    this.loadRemoteArticle(id);
  },

  loadRemoteArticle(id) {
    if (!isApiConfigured()) return;

    this.setData({ loading: true });
    get(`/api/articles/${id}`)
      .then((result) => {
        if (result && result.ok && result.article) {
          this.setData({
            article: normalizeRemoteArticle(result.article)
          });
        }
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },

  onShareAppMessage() {
    return {
      title: this.data.article.title,
      path: '/pages/research/research'
    };
  },

  goDiagnosis() {
    wx.navigateTo({ url: '/pages/diagnosis/diagnosis?start=1' });
  },

  openArticle(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ article: articles[id] || articles['what-is-geo'] });
    this.loadRemoteArticle(id);
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
  }
});

function normalizeRemoteArticle(article) {
  const body = article.body || article.desc || '';
  return {
    ...article,
    sections: article.sections || body.split('\n').filter(Boolean).map((paragraph) => ({
      title: '',
      body: paragraph
    }))
  };
}
