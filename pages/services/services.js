Page({
  data: {
    services: [
      {
        label: '01',
        title: 'GEO诊断',
        desc: '确认品牌在 AI 平台中的可见度、理解度、推荐表现与竞品差异。',
        points: ['品牌是否被正确识别', '哪些真实需求场景会进入推荐', '信息准确性与竞品差异在哪里']
      },
      {
        label: '02',
        title: 'GEO优化方案',
        desc: '根据诊断结果定位问题根因，明确品牌、内容与信源的优化优先级。',
        points: ['确定优先解决的问题', '明确需要补强的信息与内容', '形成可执行的优化方向']
      },
      {
        label: '03',
        title: 'GEO优化执行',
        desc: '围绕已确认的优化方向推进品牌信息、内容资产与可信信源建设。',
        points: ['品牌信息治理', '内容与信源建设', '持续检测与复盘']
      }
    ],
    process: ['诊断现状', '定位问题', '制定方案', '推进执行', '检测复盘']
  },

  goDiagnosis() {
    wx.setStorageSync('geogi_start_new_diagnosis', true);
    wx.switchTab({ url: '/pages/diagnosis/diagnosis' });
  },

  goContact() {
    wx.navigateTo({ url: '/pages/contact/contact' });
  }
});
