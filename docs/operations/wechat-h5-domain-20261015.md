# 微信小程序 web-view 业务域名｜api.geogi.cn 验证与验收操作指南

> 目标仅为 \`https://api.geogi.cn/iBZMBKP6Yg.txt\`：**不修改 GeoGi 订单、报告、支付、用户资料或任何数据库**。本指南要求经授权 Mac 终端 + \`ssh geogi-prod\` 操作，且使用微信平台下载的原始验证文件。代码位于 MiniProgram PR #80，尚未生产部署。

## 一、只读检查，不会修改线上环境

1. 在 Mac 打开「终端」（聚焦搜索 Terminal）。运行：

\`\`\`bash
cd /Users/dashaoye/Documents/GitHub/GeoGi-MiniProgram
git fetch origin fix/wechat-webview-domain-verification-20261015
git show origin/fix/wechat-webview-domain-verification-20261015:server/scripts/wechat_h5_domain_verification.py > /tmp/geogi-wechat-h5-domain.py
python3 -m py_compile /tmp/geogi-wechat-h5-domain.py
scp /tmp/geogi-wechat-h5-domain.py geogi-prod:/tmp/geogi-wechat-h5-domain.py
ssh geogi-prod 'if [ "$(id -u)" -eq 0 ]; then python3 /tmp/geogi-wechat-h5-domain.py inspect; else sudo python3 /tmp/geogi-wechat-h5-domain.py inspect; fi'
\`\`\`

2. **必须看到** \`NGINX_READ_ONLY_INSPECTION=PASS\`、\`CONFIG_SOURCE=/www/server/panel/vhost/nginx/api.geogi.cn.conf\`、\`CONFIG_INCLUDED_IN_ACTIVE_TREE=True\` 和 \`EXACT_TLS_VHOST_COUNT=1\`。若返回 \`VERIFICATION_LOCATION_EXISTS=True\`，当前脚本将安全阻断重复安装；先核查已经存在的规则，勿覆盖。
3. 如未通过，**停止，不继续安装**；不要放宽路径规则到整个 \`/www\` 目录、不要关闭 nginx 安全检查。

## 二、取微信官方原始验证文件

1. 登录对应小程序的微信公众平台 \`https://mp.weixin.qq.com\`，进入「开发与服务 → 开发管理 → 开发设置 → 业务域名」（界面名称可能略有调整）。
2. 按页面提示下载验证文件 **\`iBZMBKP6Yg.txt\`**，保留原始字节，保存到 Mac 的 \`下载\` 文件夹。不能用聊天内容手工重建该文件。
3. 确认 Mac 下载路径：
\`\`\`bash
ls -l "$HOME/Downloads/iBZMBKP6Yg.txt"
shasum -a 256 "$HOME/Downloads/iBZMBKP6Yg.txt"
\`\`\`
4. 只有完成第一阶段只读检查且原始文件存在时，再运行：

\`\`\`bash
scp "$HOME/Downloads/iBZMBKP6Yg.txt" geogi-prod:/tmp/iBZMBKP6Yg.txt
ssh geogi-prod 'if [ "$(id -u)" -eq 0 ]; then python3 /tmp/geogi-wechat-h5-domain.py install --original /tmp/iBZMBKP6Yg.txt; else sudo python3 /tmp/geogi-wechat-h5-domain.py install --original /tmp/iBZMBKP6Yg.txt; fi'
\`\`\`

5. **必须看到** \`BACKUP_DIR=/var/backups/geogi-wechat-domain/<实际时间戳>\` 与 \`VERIFICATION_DEPLOYED=PASS\`。脚本会核查 \`nginx -T\` 的实际 include、唯一 TLS server 块、备份 vhost、原文件 SHA256、\`nginx -t\`、reload、以及公网响应字节与原文件相同。任一步失败触发自动回滚，返回失败标记。若中途强制断电，使用下面手动回滚。
6. Mac 重新验证公网确实可访问并回传相同文件（不查看/分享验证文件明文）：
\`\`\`bash
curl --fail --silent --show-error --location --output /tmp/geogi-wechat-h5-public.txt 'https://api.geogi.cn/iBZMBKP6Yg.txt'
cmp "$HOME/Downloads/iBZMBKP6Yg.txt" /tmp/geogi-wechat-h5-public.txt && echo 'WECHAT_DOMAIN_PUBLIC_BYTES=PASS'
curl --fail --silent --show-error https://api.geogi.cn/health
\`\`\`

## 三、微信平台配置（这一步不可通过 GitHub 自动完成）

- 回到微信公众平台「业务域名」，将 **\`https://api.geogi.cn\`** 对应域名添加至微信 \`web-view\` 业务域名列表；具体输入格式依微信控制台提示填写，若页面要求仅域名则填写 \`api.geogi.cn\`。完成微信提示的验证并保存。
- 注意 **web-view 业务域名** ≠ \`request\`/\`downloadFile\` 合法域名。API \`/health\` 返回正常也不能证明 web-view 获授权。
- 若后台要求重新提交审核/发布小程序版本，按界面完成，不能因技术验证通过就宣称正式微信前端已上线。

## 四、独立验收两条访问链路

**H5：**用已授权微信账号（手机号尾号 6115）正式小程序 →「我的」→ GeoGi 项目 →「查看报告」。系统重新签发 60 秒有效、单次消费的 H5 票据，旧错误 URL 不能重用。检查章节、完整文字和正常缩放。

**PDF：**同一客户项目 →「下载 PDF」→ 微信 \`downloadFile\` → \`openDocument\`；记录格式、页数、中文是否正常。PDF 下载走独立票据，不要用域名配置结果替代 PDF 验收。

**付款安全：**授权试点项目不可再次支付；历史 199 元 unpaid 状态原样保留；不得看到其他项目报告。还须比对微信正式前端版本和 \`geogi-api\` 后端发布 SHA，单凭 PR #79 合并不算上线。

## 五、显式回滚（只在必要时运行）

安装成功会打印精确 \`BACKUP_DIR\`，替换下方占位符为当次实际值：

\`\`\`bash
ssh geogi-prod 'if [ "$(id -u)" -eq 0 ]; then python3 /tmp/geogi-wechat-h5-domain.py rollback --backup /var/backups/geogi-wechat-domain/<本次真实时间戳>; else sudo python3 /tmp/geogi-wechat-h5-domain.py rollback --backup /var/backups/geogi-wechat-domain/<本次真实时间戳>; fi'
\`\`\`

看到 \`VERIFICATION_ROLLBACK=PASS\` 后会恢复原 vhost 与原验证文件（如原本不存在则删除），重新执行 \`nginx -t\` + reload。回滚不能自动撤销已在微信公众平台提交的业务域名设置，需要在对应控制台人工确认。
