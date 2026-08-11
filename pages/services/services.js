Page({
  data: {
    services: [
      {
        key: 'diagnosis',
        label: '01',
        title: 'GEO诊断',
        desc: '了解品牌在中国主流 AI 平台中的可见度、信息准确度与推荐表现，定位主要问题。',
        points: ['品牌是否被正确识别', '关键信息是否准确', '推荐表现与竞品差异']
      },
      {
        key: 'plan',
        label: '02',
        title: 'GEO优化方案',
        desc: '基于诊断结果梳理品牌信息、内容与信源问题，形成清晰的优化优先级。',
        points: ['信息问题梳理', '内容与信源缺口', '优化优先级']
      },
      {
        key: 'execution',
        label: '03',
        title: 'GEO优化执行',
        desc: '围绕确认后的优化方向，推进品牌信息、内容资产与信源治理等具体工作。',
        points: ['品牌信息治理', '内容资产建设', '信源持续优化']
      }
    ],
    process: ['了解现状', '明确优先级', '推进优化']
  },

  goDiagnosis() {
    wx.setStorageSync('geogi_start_new_diagnosis', true);
    wx.switchTab({ url: '/pages/diagnosis/diagnosis' });
  },

  goContact() {
    wx.navigateTo({ url: '/pages/contact/contact' });
  }
});
