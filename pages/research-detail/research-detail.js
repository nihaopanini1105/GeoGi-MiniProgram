const { get } = require('../../utils/request');
const { loadReferralShareContext, withSourceQuery } = require('../../utils/referral-share');

const DEFAULT_ARTICLE_ID =
  'what-is-geo-ai-search-era';

const DEFAULT_SHARE_TITLE =
  'GeoGi GEO 研究中心';

Page({
  data: {
    loading: false,
    error: '',
    article: null,
    referralShareToken: '',
    shareTitle:
      DEFAULT_SHARE_TITLE
  },

  onLoad(options = {}) {
    const id =
      normalizeArticleId(
        options.id
      ) ||
      DEFAULT_ARTICLE_ID;

    const title =
      decodeOption(
        options.title
      ) ||
      DEFAULT_SHARE_TITLE;

    this.articleId = id;

    this.setData({ shareTitle: title });
    return this.loadArticle();
  },

  onShow() {
    void loadReferralShareContext().then((share) => {
      this.setData({ referralShareToken: share.token });
    });
  },

  async loadArticle() {
    this.setData({ loading: true, error: '', article: null });
    try {
      const result = await get('/api/articles/' + encodeURIComponent(this.articleId));
      if (!result || !result.ok || !result.article || !result.article.body) {
        throw new Error('article unavailable');
      }
      this.setData({ article: result.article, shareTitle: result.article.title });
    } catch (error) {
      this.setData({ error: '文章暂时无法加载，请稍后重试。' });
    } finally {
      this.setData({ loading: false });
    }
  },

  copyArticleUrl() {
    if (this.data.article && this.data.article.canonicalUrl) {
      wx.setClipboardData({ data: this.data.article.canonicalUrl });
    }
  },

  onShareAppMessage() {
    const id =
      this.articleId ||
      DEFAULT_ARTICLE_ID;

    const title =
      this.data.shareTitle ||
      DEFAULT_SHARE_TITLE;

    return {
      title,
      path:
        '/pages/research-detail/research-detail' +
        '?id=' +
        encodeURIComponent(id) +
        '&title=' +
        encodeURIComponent(title) +
        '&' + withSourceQuery('from=share', this.data.referralShareToken)
    };
  },

  onShareTimeline() {
    const id =
      this.articleId ||
      DEFAULT_ARTICLE_ID;

    const title =
      this.data.shareTitle ||
      DEFAULT_SHARE_TITLE;

    return {
      title,
      query:
        'id=' +
        encodeURIComponent(id) +
        '&title=' +
        encodeURIComponent(title) +
        '&' + withSourceQuery('from=timeline', this.data.referralShareToken)
    };
  }
});

function normalizeArticleId(value) {
  const id =
    decodeOption(value)
      .trim()
      .toLowerCase();

  if (
    !id ||
    !/^[a-z0-9-]+$/.test(id)
  ) {
    return '';
  }

  return id;
}

function decodeOption(value) {
  const input =
    String(value || '');

  if (!input) {
    return '';
  }

  try {
    return decodeURIComponent(
      input
    );
  } catch (error) {
    return input;
  }
}
