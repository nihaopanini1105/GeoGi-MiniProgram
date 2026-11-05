# 微信消息推送配置接入

用户已在虚拟支付后台创建 `geogi_diag_199`（199 元），OfferID `1450709233`。当前商品未发布，苹果 IAP 未启用。本次只解决消息推送 URL/Token/EncodingAESKey 可验证的问题，不宣称已接通虚拟收款。

接口：`https://api.geogi.cn/api/wechat/message-push`。公众平台选择安全模式、JSON。配置由服务器生成到 `/opt/geogi-mini-program/shared/wechat-message-push.json`，权限0600，不提交 Git、不打印密钥、不覆盖既有值。该文件中 url、token、encodingAESKey 对应表单前三项；密钥通过私有文件交付给管理员。

GET 校验签名并返回原始 echostr；兼容带 msg_signature 的加密 challenge。POST 只接收 JSON 安全模式，验 msg_signature，验证32字节PKCS#7填充及解密后的AppID。持久化加密信封，不记录解密消息或凭据；重复信封只存一份。普通消息收讫后按官方指引回 success。

金融事件 xpay_* 当前返回可重试失败，不改付款账本、发货或客户报告访问权，不能以此版本开始收款。完整虚拟支付还需现网/沙箱 AppKey 安全配置、wx.login会话绑定、下单签名、回调与查单、幂等发货、退款及iOS配置。

发布模块 `wechat-message-push` 与现有 API 共用 `wechat-miniprogram` 资源锁。原生适配器复制当前运行目录，只增加新服务与配置脚本，并向既有 server.js 插入唯一挂载点。保留线上 V2.1 报告等其他源码并逐文件校验。stage 运行真实本机 HTTP 安全回归和符号链接恢复预演；verify 同时验证本机及公网 challenge、拒绝无签名请求与未登录客户接口。失败按该 run 恢复原 server 符号链接。
