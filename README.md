# Steam 市场监控（永劫无间长剑谪星 / 通用自定义）

监控 Steam 市场商品动态并通过**企业微信机器人**推送提醒的云端应用：

- ✅ 卖家新上架出售单提醒（可按价格上限过滤）
- ✅ 求购订单变化提醒（新增价位 / 数量增加 / 最高求购价上升，Steam 仅提供聚合粒度）
- ✅ 降价提醒（最低售价降幅达标）与最低价被秒提醒
- ✅ 通用自定义：任意 Steam 游戏物品（内置永劫无间 appid 1203220 搜索与谪星示例一键添加）
- ✅ 企业微信 markdown 卡片推送 + 冷却合并 + 免打扰时段
- ✅ **云端部署（Vercel 免费层 + cron-job.org 免费定时）**：每分钟自动巡检，电脑关机也能推送
- ✅ 本地模式（Node 进程）与全链路冒烟/E2E 测试

## 架构

```
┌───────────────────────┐   每分钟外部定时唤醒    ┌──────────────────────────────┐
│  Vercel（免费 Hobby）   │ ←── cron-job.org ───── │  /api/monitor                 │
│  ├─ Next.js 管理页面    │   （?key=CRON_SECRET） │  ├─ SteamClient（限流+重试）   │
│  ├─ API 路由           │                        │  │   histogram / search/render │
│  └─ Redis 存储（Upstash）│                       │  ├─ 监控引擎 diff（去重/阈值） │
└───────────┬───────────┘                        │  └─ 企业微信 webhook 推送      │
            │ Upstash Redis（免费额度）            └──────────────┬───────────────┘
            │                                                ▼
     配置/事件/去重状态                                  企业微信群（qyapi）
```

> 说明：Vercel 免费版定时任务现仅支持“每天一次”，因此每分钟巡检由免费的
> [cron-job.org](https://cron-job.org) 定时唤醒 `/api/monitor` 实现（详见部署文档）。

- `packages/core`：Steam 客户端、监控引擎、巡检 runner、通知器、存储抽象（纯逻辑，无框架依赖）
- `apps/web`：Next.js 管理页面 + API 路由 + Vercel 部署配置（Cron / KV）
- `apps/worker`：本地模式巡检进程 + 全链路冒烟测试

## 快速开始

要求 Node ≥ 18.18（Web）；本地 worker 模式建议 Node ≥ 24（原生 TS 直跑）。

```bash
# 1. 安装依赖（本仓库把 pnpm 放在 .toolchain 下，无需全局安装）
node .toolchain/node_modules/pnpm/bin/pnpm.cjs install --ignore-scripts

# 2. 本地开发管理页面（http://localhost:3000，数据存 apps/web/data/db.json）
pnpm dev
#    （如果本机没有全局 pnpm：node .toolchain/node_modules/pnpm/bin/pnpm.cjs --filter @steam-monitor/web dev）

# 3. 单测（36 个用例，Node 内置测试运行器）
pnpm test

# 4. 全链路冒烟测试（进程内 mock Steam + 企业微信，无需外网）
pnpm smoke
```

> 注：`--ignore-scripts` 是因为受限开发环境禁止子进程管道；普通机器上直接 `pnpm install` 即可。
> 依赖仓库存放在工作区 `.pnpm-store`（见 `.npmrc`），如用百度同步盘同步本目录，建议在同步客户端中排除 `node_modules`、`.pnpm-store`、`.next`、`.vercel`。

### 本地 worker 模式（不部署云端时）

```bash
cp apps/worker/.env.example apps/worker/.env   # 填入企业微信 key 与代理
# 国内网络访问 Steam 需代理，例：HTTP_PROXY=http://127.0.0.1:7890
pnpm worker            # 循环巡检（默认 60s 一轮）
pnpm worker:once       # 只跑一轮
```

物品与设置可用 Web 管理页（`pnpm dev`）配置后，把 `data/db.json` 路径通过 `DATA_FILE` 指给 worker；或直接编辑 `apps/worker/data/db.json`。

## 云端部署（推荐）

见 [docs/DEPLOY.md](docs/DEPLOY.md)：Vercel 免费部署 + 企业微信群机器人创建步骤 + 验证清单，约 10 分钟。

## 监控与通知规则

| 事件 | 触发条件 | 默认冷却 |
| --- | --- | --- |
| `new_listing` 新上架 | 出现未见过的出售单（listingId 去重），价格 ≤ `maxPrice`（可空） | 60s（可配） |
| `buy_order_change` 求购变化 | 求购柱状图出现新价位 / 数量增加 / 最高求购价上升，价格 ≥ `minBuyPrice`（可空） | 300s |
| `price_drop` 降价 | 最低售价降幅 ≥ `priceDropPct`%；达标时以降价事件优先（不再重复报新上架） | 900s |
| `sniped` 最低价被秒 | 上一次的最低价格出售单消失且最低价回升 | 600s |
| `monitor_error` / `monitor_recovered` | 连续 5 轮全部失败 / 恢复 | 1800s |

- 同一物品同一轮内的事件合并为一条企业微信 markdown 消息
- 冷却取 `物品冷却` 与 `全局冷却` 较大值；免打扰时段内跳过巡检
- Steam 接口失败自动指数退避重试（429/5xx/网络错误），histogram 失败降级；搜索接口失败降级为物品页解析
- 首轮巡检只建立基线（静默），不推送

## 命令速查

```bash
pnpm dev            # 管理页面开发
pnpm build          # 生产构建（next build）
pnpm test           # core 单元测试
pnpm typecheck      # 全部包类型检查
pnpm lint           # ESLint
pnpm worker         # 本地巡检循环
pnpm worker:once    # 本地单轮巡检
pnpm smoke          # 全链路冒烟测试（mock）
```

## 常见问题

- **国内访问不了 steamcommunity.com？** 云端（Vercel 海外节点）拉取不受影响；本地模式请配置 `HTTP_PROXY`（加速器/科学上网）。
- **国服 / 国际服物品？** Steam 上谪星系列分为 `(CN)` 与 `(Non-CN)` 两个市场物品，请分别添加（添加对话框内置了四个谪星示例）。
- **求购为什么是聚合粒度？** Steam 未公开单条求购单接口，公开 JSON 只有价格-数量柱状图；本应用按柱状图 diff 检测变化（新增价位/数量增加/最高求购价上升）。
- **能保证不漏吗？** 不能 100%。非官方接口存在 429/限流/接口变更风险，应用通过重试、降级与心跳告警尽量减小影响；连续失败会主动推“监控异常”。
- **物品数量建议**：Upstash 免费档约 1 万次命令/天，1 分钟间隔建议 ≤ 3 个物品；更多物品请用 2 分钟间隔（cron-job.org 里改）或酌情精简
- **事件日志 / 配置存哪里？** 云端存 Upstash Redis（Vercel Marketplace 集成，免费额度内），本地存 `data/db.json`
