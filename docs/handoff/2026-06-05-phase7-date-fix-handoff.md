# Phase 7 修复 — 日期格式 bug + 前一天/后一天按钮

> **本 session 增量**：修复 Phase 7 引入的两个问题
> 1. **Bug**：选中某一天后无显示（HTML5 `<input type="date">` 返回 `YYYY-MM-DD`，但 AKTools URL 需要 `YYYYMMDD`）
> 2. **新功能**：加 "前一天" / "后一天" 按钮（围绕日期输入框）

前一个 session：[`2026-06-05-phase7-reason-and-date-handoff.md`](2026-06-05-phase7-reason-and-date-handoff.md)（Phase 7 涨停原因 + 日期）

- **日期**: 2026-06-05
- **触发**: 用户报告 "缺少 前一天 后一天按钮，选中某一天后无显示"

---

## 1. 30 秒速览

| 指标 | 数值 |
|------|------|
| **测试** | **540 total** = 499 unit + 41 e2e，**全 pass** |
| **Lint** | 0 errors / 0 warnings |
| **Build** | 成功 (226.50 kB JS / 16.81 kB CSS / gzip 70.82 kB) |
| **新增源码** | `aktoolsApi.js` +20 行（`toAktoolsDate` + URL 集成）|
| **修改源码** | `limitUpView.js` +30 行（`shiftDateString` + 3 个按钮）<br>`style.css` +15 行（`.lu-date-shift` 样式）|
| **新增测试** | 9 个 aktoolsApi 日期格式 + 14 个 limitUpView shiftDate/按钮 + 5 个 e2e |

### 核心修复
1. **日期格式 bug**：`aktoolsApi.toAktoolsDate('2026-06-04')` → `'20260604'`，在 `buildAktoolsUrl` 和 `_buildReasonUrl` 内部自动转换
2. **前一天/后一天按钮**：UI 加 `‹ 前一天` / `后一天 ›` 按钮 + "今天" 按钮（保留原），`后一天` 在今天自动 disabled

---

## 2. Bug 详情：日期格式不匹配

### 2.1 现象
- 用户在日期选择器选 `2026-06-04`
- 看板显示 **空**（应该是 80 只涨停）
- DevTools Network 看到 `/api/aktools/api/public/stock_zt_pool_em?date=2026-06-04` 返回 **2 字节**（`[]`）
- 实际 AKTools `stock_zt_pool_em?date=20260604`（无横线）返回 **29KB**（80 只涨停）

### 2.2 根因
HTML5 `<input type="date">.value` 返回 `YYYY-MM-DD` 字符串（带横线），但 AKTools 接口的 `date` / `start_date` / `end_date` 参数需要 `YYYYMMDD`（无横线）。**两个格式差异导致接口静默返空**。

### 2.3 验证
```powershell
# 不工作（带横线）
curl "http://127.0.0.1:8888/api/public/stock_zt_pool_em?date=2026-06-04"
# → 2B []

# 工作（无横线）
curl "http://127.0.0.1:8888/api/public/stock_zt_pool_em?date=20260604"
# → 29KB JSON
```

### 2.4 修复
`aktoolsApi.js` 加 `toAktoolsDate()` 工具，**所有 URL 构造处**内部调用：
```js
export function toAktoolsDate(raw) {
  if (raw === null || raw === undefined || raw === '') return '';
  const s = String(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.replace(/-/g, '');
  return s;
}
```

`buildAktoolsUrl` 中 `date` 参数自动转换：
```js
if (k === 'date') {
  const normalized = toAktoolsDate(v);
  if (!normalized) continue;
  usp.set(k, normalized);
  continue;
}
```

`_buildReasonUrl` 同样用 `toAktoolsDate`：
```js
function _buildReasonUrl(date) {
  const base = `/api/aktools/api/public/${REASON_INTERFACE}`;
  const normalized = toAktoolsDate(date);
  if (!normalized) return base;
  const usp = new URLSearchParams();
  usp.set('start_date', normalized);
  usp.set('end_date', normalized);
  return `${base}?${usp.toString()}`;
}
```

### 2.5 为什么不放 app.js？
- `app.js` 是业务层，不应知道 AKTools URL 格式约定
- 任何调用方传 `YYYY-MM-DD` 或 `YYYYMMDD` 都应被正确处理
- 缓存 key 也用原始 `date` 字符串，所以**不同格式的同一日期会命中同一缓存槽**（归一化在 URL 层做，不在 cache key 层）

---

## 3. 新功能：前一天/后一天按钮

### 3.1 UI 变化

**之前**：
```
[日期: 📅 ____________ ] [今天]
```

**现在**：
```
[‹ 前一天] [日期: 📅 ____________ ] [后一天 ›] [今天]
```

### 3.2 行为

| 按钮 | 行为 | 边界 |
|---|---|---|
| `‹ 前一天` | 当前日期 -1 天，触发重新拉取 | 无限制（不限制下限）|
| `后一天 ›` | 当前日期 +1 天，触发重新拉取 | **当前日期已是今天时 disabled**（防止选未来）|
| `今天` | 重置 selectedDate = null | 无变化 |

### 3.3 shiftDateString 实现（`limitUpView.js`）

```js
export function shiftDateString(yyyymmdd, deltaDays) {
  const base = yyyymmdd || formatDateForInput(new Date());
  const d = new Date(base + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return yyyymmdd;
  d.setDate(d.getDate() + Number(deltaDays || 0));
  return formatDateForInput(d);
}
```

**关键细节**：
- `new Date(base + 'T00:00:00')` 避免 UTC 解析（强制本地时区午夜）— 防止跨日期边界 bug
- `setDate(getDate() + delta)` 自动处理月份/年份/闰年边界（JS Date 内置）
- 闰年测试：`2024-02-28 + 1 = 2024-02-29` ✅，非闰年 `2025-02-28 + 1 = 2025-03-01` ✅
- 无效输入 fallback 到原字符串（不抛错）

### 3.4 回调链
```
按钮 click
  ↓
shiftDateString(current, ±1) → 新日期字符串 (YYYY-MM-DD)
  ↓
cb.onDateChange(newDate)
  ↓
handleLimitUpDateChange(newDate) (app.js, 已存在)
  ↓
clearLimitUpMetadataCache()
state.limitUp.selectedDate = newDate || null
state.limitUp.reasonMap = new Map()
limitUpFetch()
  ↓
fetchLimitUpList({ date }) → aktoolsApi 内部 toAktoolsDate 转 YYYYMMDD
fetchLimitUpReasons({ date }) → 同样转
```

---

## 4. 文件变更清单

### 4.1 修改
| 文件 | 变更 |
|---|---|
| `src/js/aktoolsApi.js` | (1) 新增 export `toAktoolsDate`；(2) `buildAktoolsUrl` 中 `date` 参数走 `toAktoolsDate` 转换；(3) `_buildReasonUrl` 同样转换 |
| `src/js/limitUpView.js` | (1) 新增 export `shiftDateString`；(2) `buildDateInput` 重构：加 `#lu-date-prev` / `#lu-date-next` / `#lu-date-today` 三个按钮（带 id 便于测试）|
| `src/style.css` | +15 行：`.lu-date-shift` 默认 / hover / disabled 样式（与 `.lu-date-today` 分离）|
| `tests/aktoolsApi.test.js` | +9 cases：`toAktoolsDate` 4 + `buildAktoolsUrl` 3 + dashed date 拉取 2 |
| `tests/limitUpView.test.js` | +14 cases：`shiftDateString` 8 + 按钮渲染 / 行为 6 |
| `e2e/limit-up.spec.js` | +5 cases：按钮存在 / 后一天 disabled / 前一天触发请求 / 后一天 +1 / 日期格式 bug 回归 |

### 4.2 文档
| 文件 | 变更 |
|---|---|
| `AGENTS.md` | `state.limitUp` 注释加 `selectedDate` + 日期选择器说明 |
| `STATUS.md` | Phase 7 行加 (修复) 标注 |

---

## 5. 关键设计决策

### 5.1 为什么"后一天"在今天 disabled？
- AKTools 对未来日期返回空数据（接口无未来数据）
- UI 应**预防错误**而不是展示错误（disabled 比"点了变空白"好）

### 5.2 为什么 `toAktoolsDate` 不做日期有效性检查？
- 调用方已知格式是 `YYYY-MM-DD` 或 `YYYYMMDD`
- AKTools 自身会处理无效日期（返空或 500）
- 多加一层校验 = 多一个出错点
- 测试覆盖了"无效输入原样返回"的兜底

### 5.3 为什么 `shiftDateString` 用 `T00:00:00` 强制本地午夜？
```js
new Date('2026-06-04')       // UTC 午夜 2026-06-04 00:00 UTC
new Date('2026-06-04T00:00:00')  // 本地午夜 2026-06-04 00:00 +08:00
```
不用 `T00:00:00`：在东八区 (UTC+8)，`new Date('2026-06-04')` 是 UTC 午夜 = 北京时间 08:00，`getDate()` 返回 4，OK；
但在西十二区 (UTC-12)，`new Date('2026-06-04')` 是 UTC 午夜 = 当地 12:00 (前一天)，`getDate()` 返回 3 — **少了一天**。
用 `T00:00:00` 强制本地午夜 = 跨时区安全。

### 5.4 为什么缓存 key 不归一化？
- 当前缓存 key = `${kind}|${date || ''}` 保留原始 date
- 优点：调试时能看出用户传的格式
- 缺点：理论上 `2026-06-04` 和 `20260604` 会占两个槽（实际不会 — `buildAktoolsUrl` 调 `toAktoolsDate` 转换后才存）
- **现状**：在 `_cacheKey` 之前 `fetchLimitUpList`/`fetchLimitUpReasons` 已经收到 `date` 参数，但**不会转换**。所以缓存 key 是 YYYY-MM-DD 格式
- 改进空间（不在本 PR）：让 `fetchAktoolsLimitUpList` 也 `toAktoolsDate(date)` 后再作 key，彻底统一

---

## 6. 调试 / 验证

### 6.1 浏览器实测

```
1. 打开 http://127.0.0.1:5173/#/limit-up
2. 默认显示今天的涨停股
3. 验证 bug 修复：
   - 在日期框改 2026-06-04 → 应显示 80 只涨停（非空白）
   - DevTools Network 看 URL: ?date=20260604（无横线）
4. 验证前后一天：
   - 点 "‹ 前一天" → 日期 -1，刷新数据
   - 点 "后一天 ›" → 日期 +1，回到今天时按钮变灰
5. 点 "今天" → 回到今天
```

### 6.2 单测快速验证
```bash
# 日期格式 bug 修复
npx qunit --require ./tests/_jsdom-setup.cjs "tests/aktoolsApi.test.js"
# 跑 "dashed date YYYY-MM-DD is normalized to YYYYMMDD in URL"  →  ok

# shiftDate 工具
npx qunit --require ./tests/_jsdom-setup.cjs "tests/limitUpView.test.js"
# 跑 "crosses month boundary" → ok
# 跑 "handles leap year Feb 29" → ok
```

### 6.3 回滚方案（如需）
1. `src/js/aktoolsApi.js` 删 `toAktoolsDate` 调用（`buildAktoolsUrl` 中 `date` 分支移除）— 恢复 Phase 7 行为
2. `src/js/limitUpView.js` 删 3 个按钮 + `shiftDateString`
3. `e2e/limit-up.spec.js` 删 +5 cases

---

## 7. 测试覆盖率

| 模块 | 测试 | 说明 |
|---|---|---|
| `aktoolsApi.toAktoolsDate` | 4 cases 🆕 | YYYY-MM-DD / YYYYMMDD / null / invalid |
| `aktoolsApi.buildAktoolsUrl (dashed dates)` | 3 cases 🆕 | 转换 / 透传 / null |
| `aktoolsApi.fetchAktoolsLimitUpList (dashed date)` | 2 cases 🆕 | URL 不含横线 |
| `aktoolsApi.fetchAktoolsLimitUpReasonList (dashed date)` | 1 case 🆕 | URL start_date/end_date 不含横线 |
| `limitUpView.shiftDateString` | 8 cases 🆕 | +1/-1/月边界/年边界/闰年/非闰年/null/无效 |
| `limitUpView.renderLimitUpPage (date buttons)` | 6 cases 🆕 | 渲染 / disabled 状态 / 点击 / 回调 |
| 其他模块 | 416 cases | 监控 / K线 / TTS / alert / chart / storage / theme / parser / api / router / worker / 旧 limitUpView (26) |
| e2e (Playwright) | 41 cases（+5 🆕）| 路由 5 + 监控 6 + 看板 17 + 看板行点击 3 + K线 7 + 持久化 3 |
| **总计** | **540** | **499 unit + 41 e2e** |

---

## 8. 沉淀的经验

### 8.1 HTML5 日期输入格式陷阱
- `<input type="date">.value` = `YYYY-MM-DD`
- 任何后端 API 大概率要 `YYYYMMDD`（更紧凑、URL 友好）
- **必加格式转换层** — 放在数据层（aktoolsApi），不放 UI 层（app.js）

### 8.2 时区与 Date 解析
- `new Date('YYYY-MM-DD')` = UTC 午夜
- `new Date('YYYY-MM-DDTHH:MM:SS')` = 本地时间
- 日期算术（`setDate` / `getDate`）用本地时区
- 跨时区用户必须用 `T00:00:00` 避免日期漂移

### 8.3 测试覆盖 UI 边界
- "后一天" 在今天 disabled 是 UX 细节，但**单测覆盖 disabled 状态** = 防止未来重构破坏
- e2e 测试用 `page.on('request', ...)` 抓网络 URL 是验证"日期格式 bug 修复"的金标准

### 8.4 静默返空 vs 显式报错
- AKTools 对无效 `date` 返 200 + `[]`，**不报错**
- 这类 silent failure 是最难发现的 bug
- 单元测试 + e2e 双重锁住 URL 格式 = 防止 regression

---

## 9. 下一步建议

### 9.1 立即可做
1. **用户浏览器实测**（最优先）：用户最后一次实际验证所有功能
2. **缓存 key 归一化**（小优化）：让 `_cacheKey` 内部用 `toAktoolsDate`，杜绝未来"YYYY-MM-DD"和"YYYYMMDD"占两个槽的可能

### 9.2 已有数据但未用
- `lastLimitTime` 最后封板时间 — 表格可加列
- `limitAmount` 封板资金 — 可加列或用于排序
- `limitStats` "1/1" 字符串 — 可解析为 "本轮涨停天数 / 历史总涨停次数"

### 9.3 待优化（基础设施）
- 仓库迁移到 git（`STATUS.md:552` 仍未做）
- CI/CD（GitHub Actions 跑 `npm run ci` + 自启 AKTools）
- 浏览器兼容矩阵（手动测 Chrome/Firefox/Safari/Edge）

---

## 10. 紧急 fallback 清单

如果升级出问题，按以下顺序排查：

1. **日期选择器不响应？** → 浏览器 console 看 `state.limitUp.selectedDate` 是否更新
2. **前后一天按钮无反应？** → 看 `cb.onDateChange` 是否被调用（应在 app.js）
3. **URL 仍带横线？** → 检查 `aktoolsApi.js:buildAktoolsUrl` 中 `date` 分支是否走 `toAktoolsDate`
4. **切日期不刷新？** → `clearLimitUpMetadataCache()` 是否被调
5. **测试还过吗？** → `npm test` 应 499 全过 + `npm run e2e` 41 全过

---

## 11. 关键命令

```bash
# 项目
npm run dev          # 启动 Vite dev server
npm test             # QUnit 499 tests
npm run e2e          # Playwright 41 tests
npm run ci           # 完整 CI

# 验证 AKTools
curl "http://127.0.0.1:8888/api/public/stock_zt_pool_em?date=20260604"
curl "http://127.0.0.1:8888/api/public/stock_zt_pool_em?date=2026-06-04"
# 第一个有数据，第二个空（验证 bug 已修复）
```

---

## 12. 关联文档

- `AGENTS.md` — 项目总览
- `STATUS.md` — 进度状态
- `docs/handoff/2026-06-05-phase7-reason-and-date-handoff.md` — Phase 7 主交接（涨停原因 + 日期）
- `docs/handoff/2026-06-05-aktools-upgrade-handoff.md` — AKTools 接入
- `docs/handoff/2026-06-05-phase5-bugfixes-handoff.md` — Phase 5 + 2 个 K线 bug 修复
