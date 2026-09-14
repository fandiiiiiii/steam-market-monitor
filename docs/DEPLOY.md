# 云端部署指南（Vercel 免费层）

完成本指南后：Vercel 每分钟自动巡检 Steam 市场 → 变化通过企业微信群机器人推送到手机，**电脑关机也生效**。全程约 10 分钟，零费用（Hobby 免费层）。

## 0. 准备

- GitHub 账号（放代码）
- Vercel 账号（可用 GitHub 直接登录）：https://vercel.com
- 一个企业微信群（1 人也可以，比如“文件传输助手”式的自建群）

## 1. 创建企业微信群机器人，获取 Webhook Key

1. 在企业微信中进入目标群聊 → 右上角 `···` → **群机器人** → **添加机器人** → 新创建一个机器人（名字随意，如“Steam 监控”）
2. 创建成功后会显示 **Webhook 地址**，形如：
   ```
   https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   ```
3. 复制 `key=` 后面的 **UUID 字符串**（不含 `key=`），保存好，稍后填入

> 提示：个人微信群的“群机器人”入口同样在企业微信/微信里可用；若在微信中找不到入口，用企业微信 App 打开该群即可。机器人限速 20 条/分钟，本应用已做合并与冷却，不会触发限速。

## 2. 把代码推到 GitHub

```bash
git init   # 若尚未初始化
git add .
git commit -m "init steam market monitor"
git remote add origin https://github.com/<你的用户名>/steam-market-monitor.git
git push -u origin main
```

## 3. 在 Vercel 导入项目

1. 打开 https://vercel.com/new → **Import** 该仓库
2. 配置（重要）：
   - **Framework Preset**：Next.js（自动识别）
   - **Root Directory**：`apps/web`
   - Install / Build 命令保持默认（pnpm 会自动识别 workspace）
3. 点 **Deploy** 完成首次部署

> Vercel 会自动读取 `apps/web/vercel.json` 中的 Cron 配置（`/api/monitor` 每分钟一次，带鉴权）。

## 4. 创建并关联 Vercel KV

1. 项目页 → **Storage** → **Create Database** → 选择 **KV (Redis)** → Create → **Connect** 到本项目
2. 连接后 Vercel 会自动注入 `KV_REST_API_URL` / `KV_REST_API_TOKEN` 等环境变量（无需手动复制）
3. 若检测到未自动部署，手动 **Redeploy** 一次使变量生效

> 未关联 KV 时应用会回退到本地文件存储（serverless 下不可持久），所以一定要完成本步。

## 5. 配置环境变量

项目页 → **Settings** → **Environment Variables**，添加：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `CRON_SECRET` | 是 | 随机长字符串（如 `openssl rand -hex 24` 生成）。Vercel Cron 调用 `/api/monitor` 时自动携带该鉴权头 |
| `ADMIN_TOKEN` | 建议 | 管理页面写操作口令；设置后在页面“全局设置 → 安全”里填同一个值，防止他人改你的监控配置 |
| `WECOM_WEBHOOK_KEY` | 可选 | 第 1 步拿到的 key（也可以不配环境变量，直接在管理页“全局设置”里填） |
| `TZ` | 可选 | `Asia/Shanghai`（消息时间显示时区） |

添加后 **Redeploy**。

## 6. 验证

1. 打开 `https://<你的项目>.vercel.app/api/health`，应返回 `{"backend":"vercel-kv", ...}`
2. 打开首页 → 添加物品（如“谪星·信手斩龙（国际服）”）→ 右侧会显示实时行情快照
3. “全局设置”→ 填 webhook key（若未配环境变量）→ **发送测试消息** → 群里应收到测试卡片
4. 点 **⚡ 立即巡检**：第一轮建立基线（不推送）；之后市场出现新上架/求购变化即推送
5. 部署后 Vercel Cron 每分钟自动调用 `/api/monitor`，无需人工干预；页面“监控运行中”徽标与“最近巡检”时间可确认心跳

## 7. 国内访问管理页面（可选）

`.vercel.app` 域名在国内可能不稳定（**不影响推送**，推送走的是 Vercel→企业微信的海外链路）。如需稳定访问管理页：

1. 在 Vercel 项目 → **Settings → Domains** 绑定你自己的域名（会给出 DNS 解析配置指引）
2. 或干脆只在需要改配置时用网络代理打开页面，日常只收企业微信推送

## 8. 更新与排查

- **更新**：改代码 → `git push` → Vercel 自动重新构建部署（KV 数据不丢）
- **推送没反应**：
  1. `/api/health` 看 `consecutiveFailures`（连续失败 5 轮会主动推“监控异常”）
  2. 管理页“事件日志”看是否产生事件、是否“已推送”
  3. “全局设置 → 发送测试消息”验证 key 是否有效（错误码 93000 = key 无效）
- **免费额度**：每分钟 1 次轻量巡检 + 少量 KV 读写，远低于 Hobby 免费额度；物品建议 ≤ 10 个

## 附：GitHub Actions 备选（不需要管理页时）

若不想用 Vercel，也可用 GitHub Actions 定时跑 `apps/worker`（公开仓库免费，最小间隔 5 分钟），webhook key 放仓库 Secrets。此方式无管理页面，配置靠改数据文件，适合极简场景，本仓库未内置该工作流。
