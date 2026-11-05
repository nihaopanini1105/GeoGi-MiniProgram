# 小程序客户页面修复发布

本模块以 GeoGi-MiniProgram 正式 main 为唯一代码和门禁来源。门禁运行全部 JavaScript 语法、23 组 Node 业务回归及统一发布工具的完整专项测试；本仓库不含 PostgreSQL，不能伪造 OS 的数据库测试证据。

线上 API 包含独立发布的 V2.1 报告功能，因此本次只在既有不可变 release 目录基础上复制并覆盖 `server/src/services/research.js`，保留其余源码并比对每个文件 SHA-256；以线上 lockfile 增加 sanitize-html 依赖，保留 data/uploads 的原有链接。原子切换既有 server 符号链接，重启 geogi-api；失败时统一发布器恢复原链接。研究正文须返回、未授权客户接口须拒绝，才算后端上线。

统一模块：wechat-miniprogram；资源锁：wechat-miniprogram；目标：geogi-prod-miniprogram-api。原生适配器与 frozen source 随 run 持久保存。恢复使用统一 rollback 命令及该 run 原计划摘要，不依赖临时开发目录。

小程序前端需使用官方开发者工具编译和上传（AppID 以 project.config.json 为准），随后通过微信公众平台提交审核和发布。上传开发版本不等于正式版上线；必须读取公众平台的实际状态。
