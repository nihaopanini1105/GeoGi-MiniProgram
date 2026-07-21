const { site } = require('../../config/site');
const { track } = require('../../utils/analytics');

Page({
  data: {
    researchUrl: site.researchCenterUrl
  },

  onShow() {
    track('research_card_click', {
      article_id: 'official_research_center',
      category: 'official_website'
    });
  }
});
