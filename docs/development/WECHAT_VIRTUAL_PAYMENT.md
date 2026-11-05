# 虚拟支付接入

OfferID 1450709233；商品 geogi_diag_199；标准价199元。AppKey仅存服务器共享目录0600私有文件，不进入Git或小程序包。当前配置默认 enabled/goodsPublished/iosEnabled 全部false，须核实平台商品发布及苹果IAP后才能开放收款。本版本不能称为完成真机收款验收。

前端三个付款入口统一调用 wx.requestVirtualPayment，道具直购；不回退普通微信支付。服务器保持手机号授权和精确客户/项目校验，已有正式/体验授权报告拒绝重复付款。新API为每个平台订单生成唯一GVP单号，AppKey和本次code2Session.session_key分别计算签名，session_key不落盘。每个支付尝试独立映射至原订单，回调核验OpenId、商品、数量、价格、透传信息和环境，再独立查单核对业务单号、金额、环境、订单类型和平台单号；只有明确支付状态才更新原付款账本和CRM/返佣投影。沙箱不授予客户访问权。

旧支付单仍待确认时拒绝创建虚拟支付单。新的虚拟支付尝试在上一次平台单明确关闭前不再次下单，避免重复扣费；未知/网络失败需稍后重试确认，不把客户端取消当作已关单。已支付订单重复回调不会重复入账，CRM异常可重试修复。启用后服务端每5分钟对未确认/投影未完成的订单查单补偿，每轮最多20个项目，不依赖客户再次打开小程序。主动取消及主动退款不错误调用普通微信支付接口；虚拟退款在平台处理，并由签名回调按唯一退款单号累计入账，忽略失败结果、拒绝金额篡改及跨订单通知。

用户2026-11-05明确选择苹果退款问询“一律不退款”：系统仅向Apple建议不退款（result_code=1），依据为商家政策和真实订单/报告交付记录；不伪造交付或客户同意证据。最终由Apple决定，平台确认退款成功时仍如实更新账本及报告权限。问询走本地索引快速返回，JSON业务回包按微信安全模式加密。未知订单不给出伪造依据。售前展示退款政策。

发布使用 wechat-virtual-payment 模块与既有 wechat-miniprogram 资源锁。基于当前线上目录原子部署，只替换已核实与main基线一致的支付文件并增加模块；server.js仅插入新路由，保留独立上线V2.1功能。准备密钥由 GEOGI_VIRTUAL_PAYMENT_SETUP_FILE 指向本机0600文件，仅在stage安全复制到服务器；恢复依赖冻结源码及原运行目录，不依赖此临时密钥文件。

验证包含：26组Node回归（既有、消息接收、虚拟支付与HTTP/客户端）；官方SHA1/AES已知向量；伪造金额/商品/租户/沙箱拒绝，重复回调/退款去重、CRM失败恢复、平台订单重试限制、历史报告免重复付款、老客户端拒绝普通支付回退。还需平台真实支付、取消、退款联调；测试期间不主动发起真实扣款或退款。

官方协议来源：
- https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestVirtualPayment.html
- https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_query_order
- https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_notify_provide_goods
- https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment.html
- https://developers.weixin.qq.com/miniprogram/dev/framework/server-ability/message-push.html
