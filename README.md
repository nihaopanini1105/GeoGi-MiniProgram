# GeoGi 微信小程序

GeoGi 微信小程序是 **GeoGi OS 的客户输入与展示端**。它不承担 GEO 生产计算。

## 权威边界

唯一生产权威：**GeoGi OS**。

GeoGi OS 负责：
- 客户与品牌事实治理；
- BrandGraph、Persona、Journey、Query；
- 全网证据检索与核验；
- AI 平台检测；
- GEO 诊断；
- 竞品、引用、事实准确性分析；
- 优化方案、实施、验收；
- 同口径复测；
- 报告生成、版本、哈希、QA 与正式发布。

微信小程序只负责：
- 品牌/企业资料提交；
- 客户补充资料；
- 手机号身份与项目归属；
- 项目状态展示；
- 研究内容展示；
- 接收并展示 GeoGi OS 已发布的 Report Artifact；
- 联系 GeoGi。

禁止在小程序侧重新生成、计算或拼接：
- 报告摘要；
- 综合评分；
- 诊断维度；
- 关键发现；
- 平台分析；
- 竞品分析；
- 优化建议；
- AI 回答分析；
- PDF 报告。

## 报告交付

当前正式契约：

`DeliveryPackage/3.0.0`

规则：
- `delivery_mode = artifact_only`
- `production_authority = geogi_os_m09`
- 小程序只接收 OS M09 已正式发布的 Artifact。
- Package 不包含 `display_summary`。
- 小程序不得根据 Report 数据重新生成另一份客户报告。
- 报告页只显示交付状态、版本、发布时间、完整性元数据和 OS 报告文件入口。

## 正式接口

客户侧：
- `GET /api/config`
- `GET /api/articles`
- `GET /api/articles/:id`
- `GET /api/sample-report`
- `GET /api/customer/projects`
- `GET /api/customer/reports/:projectId`
- `POST /api/leads`
- `POST /api/diagnosis/submit`（提交入口兼容路径，仍只创建 intake）
- `POST /api/customer/projects/:projectId/supplement`
- `POST /api/wechat/phone`
- `POST /api/uploads`
- `POST /api/events`

OS 内部桥接：
- `GET /internal/os/intakes`
- `POST /internal/os/projects/:projectId/stage`
- `POST /internal/os/artifacts`
- `POST /internal/os/delivery-packages`

## 服务端配置

小程序服务端只需要：
- 微信授权；
- 客户提交/项目状态所需飞书配置；
- 研究内容配置；
- 上传配置；
- GeoGi OS Bridge Token。

不再需要本地 Diagnosis Engine、AI Share Extractor、报告分析表、评分表、PDF Renderer 或 Python/ReportLab 依赖。

## 本地开发

```bash
cd server
pnpm install
PORT=3107 pnpm dev
```

正式环境默认 API：
`https://api.geogi.cn`

## 正式视觉资产

所有 GeoGi Logo 必须使用 `assets/brand/logo-system/v1.0/` 内冻结资产，不得重绘或近似替代。

平台显示顺序：豆包、腾讯元宝、通义千问、DeepSeek、Kimi。

## 发布验收

发布前必须确认：
1. 小程序不存在本地 GEO 诊断/评分/报告生成模块；
2. 小程序不存在客户报告正文拼接逻辑；
3. DeliveryPackage 只接受 3.0.0 artifact-only；
4. 旧 2.x DeliveryPackage 不再进入正式存储；
5. 报告页只能打开 OS 已正式发布 Artifact；
6. 客户提交/补充资料仍可进入 OS；
7. 项目状态仍由 OS 推送；
8. `server && npm test` 全通过。
