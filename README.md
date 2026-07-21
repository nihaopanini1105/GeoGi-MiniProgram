# GeoGi 微信小程序

这是 GeoGi 几何智引微信小程序项目，视觉与内容表达对齐 `GeoGi_Official_Website` 的设计标准。

## 设计统一原则

- 主品牌色：`#2f6df6`
- 深色文字：`#0d1b4c` / `#102145`
- 背景：浅蓝白渐变与白色半透明卡片
- 组件：圆角卡片、胶囊标签、蓝色主按钮、轻阴影
- 内容语气：专业、清晰、克制，中文主叙事
- 用户体验：按中国微信用户习惯，核心底部导航保持为首页、品牌诊断、研究中心；服务、示例报告、联系顾问通过页面 CTA 进入。

## 当前页面

- 首页：产品定位、用户痛点、核心能力、服务入口、流程、示例报告、最新研究、FAQ 和联系顾问。
- 品牌诊断：三步表单，支持本地草稿、行业快捷选择、诊断目标最多 3 项和隐私确认。
- 研究中心：分类列表、文章详情、分享入口和诊断 CTA。
- 辅助页面：服务方案、示例报告、提交成功、联系顾问、隐私说明。

## 正式集成

- 飞书配置手册：[Feishu_Production_Setup.md](docs/Feishu_Production_Setup.md)
- 飞书字段字典：[Feishu_Bitable_Field_Dictionary.md](docs/Feishu_Bitable_Field_Dictionary.md)
- 云函数：`cloudfunctions/submitDiagnosis`、`cloudfunctions/getResearchArticles`

## 本地打开

使用微信开发者工具打开本目录：

`/Users/dashaoye/Documents/MiniProgram_Wechat`

当前 `appid` 使用 `touristappid`，后续拿到正式小程序 AppID 后再替换。
