# 飞书机器人通知配置步骤

目标：客户在小程序提交品牌诊断资料后，服务器把线索写入飞书多维表格，并立刻把通知发到飞书群。

## 推荐方案：群自定义机器人

这是第一阶段最简单、最稳定的方式。不需要先配置应用机器人私聊，也不需要处理复杂的接收人 ID。

### 1. 新建通知群

1. 打开飞书。
2. 新建一个群聊，建议命名为 `GeoGi 客户通知`。
3. 把后续负责跟进客户的人拉进群。

### 2. 添加自定义机器人

1. 进入 `GeoGi 客户通知` 群。
2. 点击右上角群设置。
3. 找到 `群机器人` 或 `机器人`。
4. 点击 `添加机器人`。
5. 选择 `自定义机器人`。
6. 名称建议填写：`GeoGi 线索通知`。
7. 头像可以先不设置。

### 3. 配置安全设置

建议开启 `签名校验`。

开启后飞书会给你两个值：

- Webhook 地址
- 签名密钥 Secret

这两个值只放在服务器 `.env`，不要写入小程序前端，也不要提交到 GitHub。

### 4. 填入服务器环境变量

在服务器项目的 `.env` 中填写：

```bash
FEISHU_NOTIFY_WEBHOOK=https://open.feishu.cn/open-apis/bot/v2/hook/xxx
FEISHU_NOTIFY_SECRET=这里填写签名密钥
```

如果没有开启签名校验：

```bash
FEISHU_NOTIFY_WEBHOOK=https://open.feishu.cn/open-apis/bot/v2/hook/xxx
FEISHU_NOTIFY_SECRET=
```

### 5. 本地测试

服务器启动后，提交一次小程序表单。

正常结果：

1. 飞书多维表格新增一条客户记录。
2. 飞书群收到 `【GeoGi 新客户提交】` 通知。
3. 客户记录里的 `通知状态` 变成 `已发送`。
4. 如果通知失败，记录里的 `通知状态` 会是 `发送失败`，并写入 `通知错误` 和 `通知重试次数`。

## 进阶方案：应用机器人私聊负责人

如果你希望机器人直接私聊某个负责人，而不是发群通知，再配置这个方案。

### 1. 开启应用机器人能力

1. 打开飞书开放平台。
2. 进入你的企业自建应用。
3. 进入 `应用能力`。
4. 开启 `机器人` 能力。
5. 配置机器人名称，例如 `GeoGi 诊断助手`。

### 2. 添加消息权限

进入 `权限管理`，申请消息发送相关权限。

常见需要：

- 发送消息
- 获取用户 user ID / open ID
- 如果要发群消息，还需要群相关权限

权限申请后，需要发布应用版本并由企业管理员审核通过。

### 3. 获取接收人 ID

应用机器人发私聊必须知道接收人的 ID。

服务器支持这两个变量：

```bash
FEISHU_NOTIFY_RECEIVE_ID=负责人的 open_id 或 user_id
FEISHU_NOTIFY_RECEIVE_ID_TYPE=open_id
```

如果使用 user_id，则改成：

```bash
FEISHU_NOTIFY_RECEIVE_ID_TYPE=user_id
```

第一阶段如果拿不到接收人 ID，先用群自定义机器人即可。

## 两种方案怎么选

第一阶段推荐：

```bash
FEISHU_NOTIFY_WEBHOOK=群机器人 Webhook
FEISHU_NOTIFY_SECRET=群机器人签名密钥
FEISHU_NOTIFY_RECEIVE_ID=
FEISHU_NOTIFY_RECEIVE_ID_TYPE=open_id
```

这样客户提交后，通知会发到飞书群，团队成员都能看到。
