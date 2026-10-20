# GeoGi V2.1 小程序独立交付协议与上线门禁

状态：**开发分支实现，默认关闭，未部署，未发布**。本协议与旧 V2 并存，禁止覆盖其客户指针、付款状态、支付渠道和佣金记录。

## 配套仓库

- OS：`nihaopanini1105/GeoGi-OS` 的 `integration/v21-formal-release-20261019`，权威构建器 `apps/operations_admin/report_v2_1_customer_delivery_contract.py`。
- 小程序：本分支新增 `server/src/services/report-v21-bridge-operations.js`；使用 **同一份 OS 编译的 H5/PDF 字节**，不在小程序重新生成评分、摘要或诊断。
- 生产安全前提：没有真实客户/项目/订单及双签名完整报告验收时，不得开启发布。

## 受保护的独立 OS 接口

全部由现有 `requireOsBridge` Bearer 鉴权：

- `GET /internal/os/report-v21/capabilities`：`enabled` 和 `general_customer_delivery_enabled` 默认均为 `false`。
- `POST /internal/os/report-v21/verify-customer-binding`：同时查验飞书登记的真实客户与项目归属、同名订单的客户/项目关系、已确认付款状态与付款交易时间，不接受单纯报告记录自我证明。
- `POST /internal/os/artifacts`：沿用原始字节上传，文件必须经 SHA-256 和长度核对；V2.1 PDF/H5 不得从公共 `/uploads` 访问。
- `POST /internal/os/delivery-packages`：经 V2.1 authority 路由到独立、不可变包/指针存储；不得调用 V2 `publishOsDeliveryPackage`，从而避免重复支付/佣金结算。
- `POST /internal/os/report-v21/verify-customer-access`：反查最新非撤销版本、当前订单付款资格及两个文件字节完整性。
- `POST /internal/os/report-v21/revoke`：追加式撤销标记，旧链接在复检时自动失效。不能重复发布已经撤销的同一包。

V2.1 字节的 OS 算法与 Node 合同由 `server/tests/fixtures/report_v21_python_generated.json` 的真实 Python builder 合成样本交叉验证，二者不允许漂移。

## 独立客户阅读入口

小程序采用手机号签名会话认证客户，再核对项目、当前付款与 V2.1 版本：

- `GET /api/customer/report-v21/:projectId`
- `POST /api/customer/report-v21/:projectId/h5-ticket`
- `POST /api/customer/report-v21/:projectId/pdf-ticket`
- `GET /api/customer/report-v21/h5-reader/:ticket`
- `GET /api/customer/report-v21/pdf-reader/:ticket`

H5/PDF 仅通过有效期 60 秒的一次性票据访问。实际打开前再次核对当期版本、付款和哈希；不提供文件直链。原 `/api/customer/reports/:projectId`、V2 数据及付款流程不变。

## 部署配置（目前禁止在生产启用）

| 变量 | 默认 | 作用 |
|---|---|---|
| `GEOGI_REPORT_V21_PUBLISH_ENABLED` | false | 开启版本服务和 V2.1 发布入口 |
| `GEOGI_REPORT_V21_GENERAL_CUSTOMER_DELIVERY_ENABLED` | false | 允许非试点客户在实付订单及归属检查通过后使用 |
| `GEOGI_REPORT_V21_PRIVATE_ROOT` | 服务端 `data/report-v21` | 私有、持久化、非 `/uploads` 的版本及撤销账本 |
| `GEOGI_V2_EXACT_PILOT_ENABLED` 等试点限定变量 | false | 仅保留精确命名的旧试点例外，不可授权普通免费客户 |

OS 一侧仍须另行开启对应的 `GEOGI_REPORT_V21_GENERAL_PUBLISH_ENABLED`，并先通过真实来源、专业指标、批准订单与报告发布门禁。这些变量全部由运维专用私有配置管理，不能暴露给用户。

## 验收

- 独立本地 Node 域模块专项：`node server/tests/report_v21_bridge_regression.js`（27 项断言，含未付款、试点、跨客户、哈希、签名包 ID、撤回和幂等）。
- 静态跨层契约：`node server/tests/report_v21_end_to_end_contract.js`。
- 正式验收入口：`GEOGI_EXPECTED_HEAD_SHA=$(git rev-parse HEAD) bash tools/ci/paid_diagnostic_release_gate.sh`（必须干净工作区、真实小程序 AppID，且包含原全部旧 V2 测试）。
- **GitHub Actions 不作为验收前提**。
- 启用前还需在非生产真实隔离服务完成：OS→小程序字节上传→付费归属→独立包发布→客户手机号登录→两种票据→H5/PDF→撤销/退款与跨客户拒绝的完整 HTTP E2E，以及数据库、备份、恢复和配置验收。

当前仅完成合成样本及 Node 层专项，不表示真实新客户已获可发布资格。正式生产数据迁移、真实客户模型外发、补采和部署仍需分别授权。
