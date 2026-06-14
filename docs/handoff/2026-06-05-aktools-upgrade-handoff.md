# AKTools 涨停数据源升级 — 交接文档

> **新窗口从这里开始**：本 session 把涨停看板的数据源从"东财 clist/get + per-stock metadata"双源直连升级为 **AKTools (AKShare HTTP 代理)** 本地后端。读完本文件 + `AGENTS.md` + `STATUS.md` 即可接手。

- **日期**: 2026-06-05
- **前一个 session**: Phase 5 + 2 个 K线图 bug 修复（489 tests / 0 lint / 223.90 kB build）
- **本 session 范围**: 涨停看板数据源升级（AKTools 本地后端）
- **用户问题驱动**: "涨停看板功能实现不好，需要更可靠的数据源"

---

## 1. 30 秒速览

| 指标 | 数值 |
|------|------|
| **测试** | **491 total** = 459 unit + 32 e2e，**全 pass** |
| **Lint** | 0 errors / 0 warnings |
| **Build** | 成功 (223.16 kB JS / 15.86 kB CSS / gzip 69.84 kB) |
| **新增源码** | `src/js/aktoolsApi.js`（150 行） |
| **修改源码** | `limitUpApi.js` 重写为薄包装 + `app.js` 1 个 import + 1 个 callback 改 2 行 + `vite.config.js` 加 1 个代理 |
| **新增测试** | `tests/aktoolsApi.test.js`（25 cases） |
| **重写测试** | `tests/limitUpApi.test.js` 适配新契约（22 cases） |
| **修改 e2e** | `fixtures/limits-up.js` 重写 + `helpers.js` 加 2 个路由 + `limit-up.spec.js` 修 2 个测试 |

### 收益
1. **连板数 / 炸板次数 / 封板时间 全部真值**（之前是硬编码 0/null/0）
2. **数据完整度提升**：旧版 16 字段 → 新版 16 字段全真值 + 新增 5 字段（`lastLimitTime`/`industry`/`limitStats`/`floatMarketCap`/`totalMarketCap`/`turnoverRate`/`limitAmount`）
3. **统一数据源**：旧版两步抓（主列表 + per-stock metadata，2 个东财端点）→ 新版一次拿全（1 个 AKTools 端点）
4. **失败可观测**：AKTools 5xx 直接抛错，UI 显示明确错误（旧版 per-stock metadata 静默返回默认 0）

---

## 2. 用户一次性操作

### 安装 AKTools（必做）
```powershell
pip install aktools -i https://pypi.tuna.tsinghua.edu.cn/simple
```

### 启动（项目根目录已有 `aktools startup.bat`）
```powershell
aktools startup
# 监听 http://127.0.0.1:8888
```

**注意端口 8888**（非默认 8080）。如改端口需同步修改 `vite.config.js` 的 `target`。

### 验证
```powershell
curl http://127.0.0.1:8888/api/public/stock_zt_pool_em?date=20260604
# 预期：返回约 29KB JSON 数组（2026-06-04 真实交易日数据）
# 非交易日返回：[] （正常）
```

---

## 3. 关键设计

### 3.1 数据契约（AKTools 真实返回结构）

**`stock_zt_pool_em` 涨停池**（`/api/aktools/api/public/stock_zt_pool_em`）：
```json
[
  {
    "序号": 1, "代码": "300897", "名称": "山科智能",
    "涨跌幅": 20.0, "最新价": 22.38, "成交额": 277911936,
    "流通市值": 2736091137.54, "总市值": 4383038716.92,
    "换手率": 10.1906270981, "封板资金": 37837216,
    "首次封板时间": "092500", "最后封板时间": "132251",
    "炸板次数": 1, "涨停统计": "1/1", "连板数": 1,
    "所属行业": "通用设备"
  }
]
```

**`stock_zt_pool_zbgc_em` 炸板池**（`/api/aktools/api/public/stock_zt_pool_zbgc_em`）：16 字段，**无连板数**（`涨停统计: "0/0"`），其他与涨停池基本一致 + 多 `涨停价`/`振幅`/`涨速`。

### 3.2 内部数据结构（向后兼容旧 `parseLimitUpList` 字段）

`parseAktoolsLimitUpList` 输出（**应用层**统一使用）：
```js
{
  code, name, market,           // 基础（sh/sz/bj 自动推断）
  price, change, changePercent, // 实时价（change = price * pct / 100 推算）
  amount,                       // 成交额
  limitUpCount,                 // 连板数（涨停池真值；炸板池 0）
  firstLimitTime,               // "HH:MM" 格式（"092500" → "09:25"）
  breakCount,                   // 炸板次数（真值）
  isST,                         // 由 isLimitUpName(name) 推算
  open, high, low,              // OHLC（AKTools 不返回，置 0）
  source,                       // 'aktools-limitUp' | 'aktools-broken'
  lastLimitTime,                // "HH:MM" 格式 🆕
  industry,                     // 所属行业 🆕
  limitStats                    // "1/1" 字符串 🆕
}
```

### 3.3 API 升级路径

| 调用方 | 旧行为 | 新行为 |
|---|---|---|
| `app.js:fetchLimitUpList()` | 调 `fetchLimitUpList` → 东财 clist/get + 5xx 重试 2 次 | 调 `fetchLimitUpList` → `fetchAktoolsLimitUpList('limitUp')`（无重试，因本地后端） |
| `app.js:fetchLimitUpMetadataBatch()` | 调东财 `/qt/stock/get` × N（concurrency 6）| 调 `fetchAktoolsLimitUpList('limitUp')` 走 30s 缓存（0 次额外 HTTP） |
| `app.js:"⟳ 立即刷新" 按钮` | 调 `fetchLimitUpListNow` → `limitUpFetch` | 调 `fetchLimitUpListNow` → **先 `clearLimitUpMetadataCache()` 再 `limitUpFetch`**（绕过 30s 缓存） |

### 3.4 缓存策略

| 触发 | 缓存行为 |
|---|---|
| 定时器（看板 30s/60s/10s 刷新）| 30s 内命中 → 跳过 HTTP |
| 路由切换重新渲染 | 命中缓存 |
| **"立即刷新" 按钮** | **强制清缓存** → 必发 HTTP |
| 手动 `clearLimitUpMetadataCache()` | 全清 |

---

## 4. 文件变更清单

### 4.1 新增
| 文件 | 行数 | 说明 |
|---|---|---|
| `src/js/aktoolsApi.js` | 150 | AKTools 封装：`buildAktoolsUrl` / `parseAktoolsLimitUpList` / `fetchAktoolsLimitUpList` / `clearAktoolsCache` |
| `tests/aktoolsApi.test.js` | 320 | 25 个单元测试（URL 构造 / 字段映射 / 时间格式 / 缓存 / Abort） |

### 4.2 重写
| 文件 | 旧 → 新 | 说明 |
|---|---|---|
| `src/js/limitUpApi.js` | 204 → 130 | 主入口委托 `aktoolsApi.js`；保留 `buildLimitUpUrl` / `parseLimitUpList` 东财格式兼容；`fetchLimitUpMetadata` / `fetchLimitUpMetadataBatch` 改为从同缓存取（无新 HTTP） |
| `tests/limitUpApi.test.js` | 616 → 440 | 整体重写为测新 AKTools 契约 |
| `e2e/fixtures/limits-up.js` | 71 → 70 | 改用 AKTools DataFrame JSON 格式（字段名 `代码/名称/最新价/...`）；新增 `LIMIT_UP_BROKEN_BODY` 炸板池样本 |

### 4.3 修改
| 文件 | 变更 |
|---|---|
| `vite.config.js` | 加 `/api/aktools` 代理 → `http://127.0.0.1:8888`（无 Referer/UA，本地后端）|
| `src/js/app.js` | (1) `import` 加 `clearLimitUpMetadataCache`；(2) `fetchLimitUpListNow` 加 2 行：先清缓存再 fetch |
| `e2e/helpers.js` | (1) 加 `**/api/aktools/api/public/stock_zt_pool_em**` 路由 + `**/api/aktools/api/public/stock_zt_pool_zbgc_em**` 路由；(2) 保留 `/api/limit-up/qt/clist/get**` 兜底为 `diff: []`（防御未改代码漏改）|
| `e2e/limit-up.spec.js` | (1) "排序切换：涨幅" 测试改为检查 pct 在 10.0~10.02 范围（不指定具体代码，新数据下 `sz000001` 在 2板桶而非 1板桶）；(2) "空响应" 测试改 unroute 路径为 AKTools URL |

---

## 5. vite.config.js 代理键顺序约束

| 路径 | 上游 | 顺序 |
|---|---|---|
| `/api/tencent` | qt.gtimg.cn | 1 |
| `/api/eastmoney-kline` | push2his.eastmoney.com | 2 (kline 必须早于 eastmoney) |
| `/api/eastmoney` | push2.eastmoney.com | 3 |
| `/api/limit-up` | push2.eastmoney.com | 4 |
| `/api/limit-up-stock` | push2.eastmoney.com | 5 |
| **`/api/aktools`** | **127.0.0.1:8888** | **6** (新) |
| `/api/sina` | hq.sinajs.cn | 7 |
| `/api/qq-kline-min` | ifzq.gtimg.cn | 8 (min 必须早于 kline) |
| `/api/qq-kline` | web.ifzq.gtimg.cn | 9 |

`/api/aktools` 不与任何现有路径冲突，可放任何位置（当前放在 `/api/limit-up-stock` 之后）。

---

## 6. 调试 / 验证

### 6.1 本地验证

```bash
# 1. 启动 AKTools（用户本机）
aktools
# → http://127.0.0.1:8888

# 2. 启动 dev server（项目）
npm run dev
# → http://127.0.0.1:5173/#/limit-up

# 3. 浏览器 DevTools Network 面板
# - 应看到 /api/aktools/api/public/stock_zt_pool_em 请求
# - 30s 内重复访问不应有第二次请求（缓存命中）
# - 点 "⟳ 立即刷新" 按钮应看到新请求（清缓存）

# 4. 验证连板数真值
# - 选 "连板" 排序
# - 4+ 板 / 3 板 / 2 板 / 1 板 桶应有真实分布（之前全部归 1 板桶）
```

### 6.2 AKTools 返回 5xx 排查

| 现象 | 原因 | 解决 |
|---|---|---|
| 看板"加载失败" | AKTools 未启动 | `aktools` 启动服务 |
| 看板"加载失败" | 端口不对 | 检查 `vite.config.js` `target: 'http://127.0.0.1:8888'` 是否与 bat 一致 |
| 看板"加载失败" | 非交易日 | 是正常的（接口会 500），UI 显示"请稍后重试" |
| 数据全归 1 板桶 | 字段映射错乱 | 检查 `aktoolsApi.js:_parseItem` 字段名 |

### 6.3 回滚方案（如需）

1. `src/js/limitUpApi.js` 改回旧实现（约 60 行）— git diff 可恢复
2. `vite.config.js` 注释掉 `/api/aktools` 代理
3. 旧 fixture 已在 git 历史中（`e2e/fixtures/limits-up.js` 前一版是东财 f12/f14 格式）

**注**：项目无 git 跟踪（`STATUS.md:552`），如需回滚请先备份当前 `src/js/aktoolsApi.js` + `tests/aktoolsApi.test.js`。

---

## 7. 测试覆盖率

| 模块 | 测试 | 说明 |
|---|---|---|
| `aktoolsApi.buildAktoolsUrl` | 5 cases | URL 构造 / 多种 kind / date / 空参数 / 编码 |
| `aktoolsApi.parseAktoolsLimitUpList` | 9 cases | 非数组/空数组/涨停池/炸板池/6 位代码前缀/HHMMSS 转换/ST 检测/缺字段过滤/额外字段保留 |
| `aktoolsApi.fetchAktoolsLimitUpList` | 11 cases | URL 路由/kind 默认值/5xx 抛错/空数组/Abort/30s 缓存/多 kind 隔离/清缓存/date 透传 |
| `limitUpApi` 兼容 | 22 cases | buildLimitUpUrl 东财 URL/parseLimitUpList 东财 JSON/fetchLimitUpList 走 AKTools/fetchLimitUpAndBrokenList/fetchLimitUpMetadata 从缓存取/fetchLimitUpMetadataBatch/clearLimitUpMetadataCache |
| e2e (Playwright) | 32 cases | 路由 5 + 监控 6 + 看板 11 + 看板行点击 3 + K 线 7 + 持久化 2 |
| **总计** | **491** | **459 unit + 32 e2e** |

---

## 8. 沉淀的经验

### 8.1 字段映射陷阱
- **AKTools 时间格式**：`HHMMSS` 字符串（如 `"092500"`），不是东财的 HMMSS 数字（`93000`）— 不能复用东财 `_formatHHMM`
- **AKTools 缺字段**：无 `涨跌额`/`open`/`high`/`low`（`change` 用 `price * pct / 100` 推算）
- **AKTools 无 "涨停原因" 字段**：`stock_zt_pool_em` 默认不返，需额外调其他接口（不在本 PR 范围）

### 8.2 缓存策略设计
- **30s TTL 适合后台定时刷新**（看板 30s 自动刷新）
- **用户主动操作必须绕过缓存**（"立即刷新"按钮）
- **fetch 与 UI 渲染解耦**：`fetchLimitUpList` 不关心调用方是谁

### 8.3 测试要点
- **mock 真实样本**（2026-06-04 真实涨停股）+ inline 简化版（无外部依赖）
- **缓存测试要分两个 phase**：先 `await fetch()`，再 `await fetch()` 验证 `calls === 1`
- **Aborted 测试要 fire abort 事件**：用 `init.signal.addEventListener('abort', ...)` 才能在测试中触发

### 8.4 TDD 在数据源迁移中的价值
- 先写 `tests/aktoolsApi.test.js`（25 cases），强制锁定字段契约
- 实现 `aktoolsApi.js` 后**所有测试一次过**（除 1 个测试期望写错）
- 重写 `limitUpApi.test.js` 时不慌——契约清晰

---

## 9. 下一步建议

### 9.1 立即可做
1. **用户浏览器实测**（优先级最高）：用户最后一次实际验证所有功能
2. **涨停原因显示**（下个 PR）：调 `stock_board_change_em` 或类似接口拿涨停原因
3. **行业筛选 / 排序**（需求评审）：`industry` 字段已拿全，UI 加一列 + 下拉筛选

### 9.2 已有数据但未用
- `lastLimitTime` 最后封板时间（"14:36:35"）— 表格可加列
- `industry` 所属行业 — 表格可加列
- `limitAmount` 封板资金 — 可加列或用于排序
- `limitStats` "1/1" 字符串 — 可解析为 "本轮涨停天数 / 历史总涨停次数"

### 9.3 待优化（基础设施）
- 仓库迁移到 git（`STATUS.md:552` 仍未做）
- CI/CD（GitHub Actions 跑 `npm run ci` + 自启 AKTools）
- 浏览器兼容矩阵（手动测 Chrome/Firefox/Safari/Edge）

---

## 10. 紧急 fallback 清单

如果升级出问题，按以下顺序排查：

1. **AKTools 启动了吗？** → `curl http://127.0.0.1:8888/api/public/stock_zt_pool_em` 应返回 `[]`（非交易日）
2. **端口对吗？** → bat 脚本是 8888（非默认 8080），`vite.config.js` 也要 8888
3. **代理生效吗？** → 浏览器 DevTools Network 面板，看 `/api/aktools/...` 请求是否到 aktools（200 / 500）
4. **字段映射对吗？** → 浏览器 console 看 `parseAktoolsLimitUpList` 返回的 item 字段
5. **测试还过吗？** → `npm test` 应 459 全过
6. **要回滚吗？** → 备份当前文件，从 git 历史恢复（旧实现已知可用）

---

## 11. 关键命令

```bash
# 用户本机
aktools              # 启动后端（端口 8888）

# 项目
npm run dev          # 启动 Vite dev server
npm test             # QUnit 459 tests
npm run e2e          # Playwright 32 tests
npm run ci           # 完整 CI（lint + test + e2e + build）
npm run lint:fix     # ESLint 自动修复

# 验证 AKTools
curl http://127.0.0.1:8888/api/public/stock_zt_pool_em?date=20260604
curl http://127.0.0.1:8888/api/public/stock_zt_pool_zbgc_em?date=20260604
```

---

## 12. 关联文档

- `AGENTS.md` — 项目总览（已更新数据源说明）
- `STATUS.md` — 进度状态（待更新）
- `docs/handoff/2026-06-05-phase5-bugfixes-handoff.md` — 前一个 session 交接（K线图 bug 修复）
- `docs/handoff/2026-06-05-phase4-handoff.md` — 涨停看板实现交接
- `docs/phase4-limit-up-board.md` — 涨停看板用户文档（不需修改，UI 未变）
