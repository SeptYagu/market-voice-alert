# Phase 4: 涨停看板独立页面 — 设计文档

> 日期: 2026-06-05
> 状态: ✅ 设计已确认，待实施

## 1. 目标

实现独立 Hash 路由的「涨停看板」页面，与现有「监控」页并列为两个 SPA 视图。涨停数据来源东财 `clist/get` 一次拉全市场涨停股，按连板数分组显示。

## 2. 架构

### 2.1 文件划分

**新文件 4 个：**

| 文件 | 职责 | 纯函数？ |
|------|------|---------|
| `src/js/router.js` | Hash 路由工厂 + hashchange 监听 | 工厂 + 副作用（注册监听） |
| `src/js/limitUpApi.js` | 东财涨停池 fetch + URL 构造 + 解析 | 解析纯；fetch 有副作用 |
| `src/js/limitUp.js` | 分类 / 排序 / 实时合并 / ST 识别 | 全部纯函数 |
| `src/js/limitUpView.js` | 看板视图渲染 + 事件处理 | UI 副作用 |

**修改文件 5 个：**

| 文件 | 变更 |
|------|------|
| `index.html` | 顶部加 `<nav>` 链接 |
| `src/js/app.js` | `startApp` 启动路由；拆 `renderApp` → `renderMonitorPage`；`renderHeader` 加 nav |
| `src/js/storage.js` | `STORAGE_KEYS.LIMIT_UP` + `getLimitUpSettings/patchLimitUpSettings` |
| `vite.config.js` | 加 `/api/limit-up` 代理（顺序：`eastmoney-kline → eastmoney → limit-up → sina → qq-kline-min → qq-kline`） |
| `src/style.css` | 看板分组卡片样式（沿用 `.ctl-bar` 容器） |

### 2.2 路由表

- `#/` → `renderMonitorPage`（现有 `renderApp` 重命名）
- `#/limit-up` → `renderLimitUpPage`（新建）
- 未知路径 → 回退到 `#/`

### 2.3 定时器策略

- 监控 timer 与看板 timer **相互独立**
- 页面切换时 `stop` 目标页 timer + `start` 当前页 timer
- **监控 timer 始终在后台跑**（看板需要 `state.quotes` 做行内实时价合并）

### 2.4 复用现有模块

| 来源 | 复用内容 |
|------|----------|
| `parser.js` | `normalizeCode` / `inferMarket` / `toEastmoneySecId` |
| `kline.js` | `getPriceLimit` / `ST_RE` |
| `theme.js` | `initTheme` / `getCurrentTheme` |
| `app.js` | `el()` 工厂；`formatNumber` / `formatChange` / `formatPercent` |

> **决策**：`formatNumber/formatChange/formatPercent` 保留在 `app.js` 导出（`limitUpView.js` 直接 import），避免小重构扩散。

## 3. 数据契约

### 3.1 涨停 item

```js
{
  code: 'sh600519',         // 归一化：sh/sz/bj + 6 位
  name: '贵州茅台',
  market: 'sh',             // sh | sz | bj
  price: 1850.00,
  change: 50.00,
  changePercent: 2.78,      // 涨跌幅 %
  limitUpCount: 3,          // 连板数（0=首板，1+=连板）
  firstLimitTime: '09:35',  // 首次封板时间（'HH:mm'），未封板=null
  breakCount: 0,            // 炸板次数
  isST: false,              // 名字含 *ST / ST
  open: 1800.00,
  high: 1850.00,
  low: 1800.00
}
```

### 3.2 东财 clist/get 字段映射

URL 示例：
```
/api/limit-up/qt/clist/get?pn=1&pz=200&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:6+f:!2,m:0+t:13+f:!2,m:0+t:80+f:!2&fields=f1,f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18,f100,f102,f103
```

| 字段 | 含义 | 目标 |
|------|------|------|
| `f2` | secid（market.code） | split → `market` + numeric |
| `f12` | code | numeric 备用 |
| `f14` | name | `name` |
| `f3` | 涨跌幅 | `changePercent` |
| `f4` | 涨跌额 | `change` |
| `f6` | 现价 | `price` |
| `f15` | 最高 | `high` |
| `f16` | 最低 | `low` |
| `f17` | 开盘 | `open` |
| `f18` | 昨收 | （不存，仅参考） |
| `f100` | 首次封板时间 | `firstLimitTime`（'HH:mm'） |
| `f102` | 炸板次数 | `breakCount` |
| `f103` | 连板数 | `limitUpCount` |

### 3.3 分组桶

| 桶 | 条件 |
|----|------|
| `3+板` | `limitUpCount >= 3` |
| `2板` | `limitUpCount === 2` |
| `1板` | `limitUpCount === 1`（含首板） |

桶内排序：`limitUpCount desc → changePercent desc → code asc`

### 3.4 行内实时价合并

看板定时器拉到 items 后，对每个 code 查 `state.quotes.get(code)`：
- 存在 → 用实时价 patch `price / change / changePercent`（不可变）
- 不存在 → 保留看板数据
- 不更新字段：`limitUpCount / firstLimitTime / breakCount / isST / open / high / low`（这些仅在整列表拉取时由东财接口提供）

### 3.5 非交易时段 / 空响应处理（2026-06-05 用户增补）

**问题**：东财 `clist/get` 在非交易时段（盘前/盘中/盘后/午休/节假日）可能返回 `data.diff: []`。直接显示空看板 → 用户以为"今日无涨停"，但实际可能是数据源静默。

**策略**（"保留最新两次数据"）：
- 新增 state 字段：
  - `lastNonEmptyItems`: 最近一次**非空**的拉取结果（永远保留直到下次非空覆盖）
  - `lastNonEmptyAt`: 该次拉取的时间戳
  - `consecutiveEmptyFetches`: 连续空响应的次数（UI 提示用）
- 每次 fetch 后：
  - **响应非空** → 用新数据替换 `lastNonEmptyItems`，重置 `consecutiveEmptyFetches = 0`
  - **响应为空**：
    - 若 `lastNonEmptyItems` 存在 → 继续显示它（不替换为 `[]`），状态栏追加 `缓存自 HH:MM · 已空 N 次`
    - 若 `lastNonEmptyItems` 也不存在（首次就是空）→ 显示空状态"暂无数据（可能非交易时段）"
- "最新两次" 的语义：实际只保留 1 份快照（`lastNonEmptyItems`）；"两次"理解为"用户进入页面时看到的数据 + 上一次非空数据"——但实现层只保留最新一份非空快照即可（保留多份无意义，因为空响应期间数据不会变）

**避免误判**：状态栏始终显示 `lastNonEmptyAt` 时间戳，让用户知道"这是 X 分钟前的快照"。

**实时价合并优先级**：在空响应分支，行内实时价合并仍执行（监控 timer 在后台跑，`state.quotes` 持续更新）→ 看板快照中的价格/涨幅会持续跟新，但连板数/封板时间等不更新。

### 3.6 新 STORAGE_KEY

```js
STORAGE_KEYS.LIMIT_UP = 'limit_up_settings'
{ refreshInterval: 30000 }  // 默认 30s
```

刷新选项（参考 SPEC §3.6）：`10 / 30 / 60` 秒。

---

## 4. 模块设计

## 4. 模块设计

### 4.1 router.js

```js
// 工厂 + 注册 hashchange
export function createHashRouter(routes, defaultPath) {
  // routes: { '#/': renderFn, '#/limit-up': renderFn, ... }
  // defaultPath: '#/' （未知路径回退）
  // 返回 { start(), navigate(path), currentPath() }
  // start() 调一次初始路由 + 注册 hashchange 监听
}
```

行为：
- `parseHash()` → 去掉 `'#'` 前缀
- `currentPath()` → `location.hash` 归一化
- `navigate(path)` → `location.hash = path`（触发 hashchange）
- 路径不在 routes → `navigate(defaultPath)` 兜底

### 4.2 limitUpApi.js

```js
// 构造 URL（pure）
export function buildLimitUpUrl(opts = {}) { ... }

// 解析响应 → items[]（pure）
export function parseLimitUpList(json) { ... }

// fetch + parse（副作用）
export async function fetchLimitUpList(opts = {}) { ... }
```

错误处理：
- HTTP 5xx → 抛错，调用方静默降级（不更新数据）
- HTTP 200 但 `data.diff` 为空数组 → 返回 `[]`（正常：非交易时段或今日无涨停）
- `data.total` 为 0 → 返回 `[]`

### 4.3 limitUp.js（全部纯函数）

```js
export const LIMIT_UP_GROUPS = Object.freeze([
  { key: '3+', label: '3 连板及以上', match: (n) => n >= 3 },
  { key: '2',  label: '2 连板',        match: (n) => n === 2 },
  { key: '1',  label: '1 连板 / 首板', match: (n) => n === 1 || n === 0 }
]);

// 按连板数分桶
export function classifyByLimitCount(items) { ... }

// 排序：limitUpCount desc → changePercent desc → code asc
export function sortByLimitCount(items) { ... }

// 一次性：分类 + 排序
export function buildLimitUpGroups(items) { ... }

// 行内实时价合并（不可变）
export function mergeLiveTicks(items, liveQuotesMap) { ... }

// ST 识别（复用 kline.js ST_RE）
export function isLimitUpName(name) { ... }

// 单桶格式化（无 item 时返回 null，调用方跳过渲染）
export function formatLimitUpGroup(key, items) { ... }
```

### 4.4 limitUpView.js

```js
// 渲染整个看板页面（替换 #app 内部）
export function renderLimitUpPage(root, state) { ... }

// 渲染顶部工具栏（refresh select + 立即刷新 + 总数）
export function renderLimitUpToolbar(state) { ... }

// 渲染分组卡片
export function renderLimitUpGroups(groups, state) { ... }

// 渲染状态栏
export function renderLimitUpStatus(state) { ... }

// 行点击 handler
export function handleLimitUpRowClick(code) {
  addToWatchList(code);
  navigate('#/');
  // 监控页 mount 后 K 线会自动展开（如有 state.chartCode 提示逻辑）
}
```

### 4.5 app.js 修改

```js
// 新增
import { createHashRouter, navigate } from './router.js';
import { renderLimitUpPage } from './limitUpView.js';
import { getLimitUpSettings, patchLimitUpSettings } from './storage.js';

// startApp 改造
export function startApp(root) {
  rootEl = root;
  initTheme();
  loadMonitorState();
  // 路由表
  const router = createHashRouter({
    '#/': (r) => { stopLimitUpTimer(); renderMonitorPage(r); },
    '#/limit-up': (r) => { renderLimitUpPage(r, limitUpState); }
  }, '#/');
  router.start();
}

// renderApp → renderMonitorPage 重命名（导出）
export function renderMonitorPage(root) { ... }

// renderHeader 加 nav
function renderHeader() {
  return el('header', { class: 'app-header' },
    el('h1', {}, '股票期货监控助手 v2'),
    el('nav', { class: 'app-nav' },
      el('a', { href: '#/', class: 'nav-link' }, '监控'),
      el('a', { href: '#/limit-up', class: 'nav-link' }, '涨停看板')
    ),
    /* theme button + refresh select */
  );
}
```

`state.limitUp`：
```js
state.limitUp = {
  items: [],
  groups: [],
  lastUpdate: null,
  loading: false,
  error: null,
  refreshInterval: 30000,
  timer: null,
  abort: null
};
```

## 5. UI/UX

### 5.1 看板布局

```
┌──────────────────────────────────────────────┐
│ 股票期货监控助手 v2  [监控][涨停看板] 🌗 ...  │  ← renderHeader（含 nav）
├──────────────────────────────────────────────┤
│ 刷新: [30s ▼]  [⟳ 立即刷新]   总涨停: 38 只   │  ← 看板工具栏
├──────────────────────────────────────────────┤
│ ▼ 3 连板及以上 (5 只)                        │  ← .lu-group
│   代码  名称    连板  现价   涨幅  首次封板   │
│   sh60.. 茅台   3板   ¥1850  +10%  09:35     │
│   ...                                         │
├──────────────────────────────────────────────┤
│ ▼ 2 连板 (8 只)                              │  ← .lu-group
│   ...                                         │
├──────────────────────────────────────────────┤
│ ▼ 1 连板 / 首板 (25 只)                      │  ← .lu-group
│   ...                                         │
├──────────────────────────────────────────────┤
│ 状态栏: 加载中... · 更新于 14:35:22            │
└──────────────────────────────────────────────┘
```

### 5.2 样式要点

- 沿用 `.ctl-bar` 容器（card 风格）
- 新增 `.lu-group / .lu-group-header / .lu-group-body / .lu-st-badge`
- 涨跌幅颜色：复用 CSS 变量 `--up-color` / `--down-color`
- ST 名字：在名字后加 `.lu-st-badge`（红底白字，"ST" 文本）
- 响应式：移动端单列，触摸按钮 ≥ 44px

### 5.3 交互

- 行点击 → `addToWatchList(code)` + `navigate('#/')`（用户确认/失败需 flashError 提示已添加）
- 行 hover 高亮（CSS `:hover`）
- 立即刷新 → `fetchLimitUpListNow()` 立即触发
- 频率改变 → `patchLimitUpSettings` + `restartLimitUpTimer()`

## 6. 测试计划

### 6.1 新增单元测试

| 文件 | cases 目标 |
|------|-----------|
| `tests/router.test.js` | parseHash / navigate / createHashRouter / hashchange dispatch / 未知路径回退（≥ 8） |
| `tests/limitUpApi.test.js` | buildLimitUpUrl / parseLimitUpList 各种 shape / fetchLimitUpList 错误处理（≥ 6） |
| `tests/limitUp.test.js` | classifyByLimitCount / sortByLimitCount / mergeLiveTicks / isLimitUpName / buildLimitUpGroups（≥ 10） |
| `tests/storage.test.js` | getLimitUpSettings / patchLimitUpSettings（≥ 2） |
| `tests/app.test.js` | 路由切换 / limitUp 渲染 / 行点击加入监控（≥ 3） |
| **小计** | **≥ 29** |

### 6.2 测试范围

- **router.js**：mock `location.hash` + `addEventListener('hashchange')` + `dispatchEvent` 模拟
- **limitUpApi.js**：mock `globalThis.fetch`，覆盖：
  - 正常 200 + 完整 fields
  - 200 + 空 diff（空集合）
  - HTTP 5xx 抛错
  - 网络异常抛错
  - 解析时缺字段（f14=null / f103=null）容错
- **limitUp.js**：纯函数各种边界（空数组、null 字段、缺字段）
- **app.js**：jsdom + mock fetch + 触发 hashchange 验证视图切换

## 7. 风险与注意

1. **东财 clist/get 在非交易时段返回空 diff** → 看板锁定显示最近一次非空快照（§3.5 空响应锁定显示）
2. **pz=100 上限** — 全市场涨停在极端牛市可能超 100，Phase 4 接受限制（未来可分页）
3. **页面切换要 destroy 看板 timer + 监控 chart** — 已在 §2.3 设计
4. **vite 代理键顺序敏感** — 已在 `vite.config.js` 注释，新键 `/api/limit-up` 紧跟 `/api/eastmoney` 之后
5. **行点击加入监控的去重** — `addToWatchList` 内部已处理 `includes` 跳过，不需额外
6. **mock fetch in tests** — `app.test.js` 已有 `setStorageAdapter` 模式；fetch mock 用 `globalThis.fetch = jest.fn(...)`（如使用 vitest）或 jsdom 中替换
7. **数据源静默 vs 真正空涨停**（2026-06-05 增补）— 用户分不清"上游静默"和"真无涨停"。缓解：状态栏显示"缓存自 HH:MM · 已空 N 次"（§3.5 实现）
8. **GBK 编码**（2026-06-05 增补）— 东财 clist/get 字段 f14（名称）是 GBK。实现：`TextDecoder('gbk').decode(buf)` + utf-8 fallback（兜底损坏 bytes）。E2E mock 用 iconv-lite 编码 GBK 字节
9. **字段映射 f2/f12/f14 容易错**（2026-06-05 增补）— 真实字段是 `f2=price / f3=pct / f4=change / f12=code(6 位) / f14=name(GBK) / f15-f18=OHLC`。f100/f102/f103 是行业/概念字符串，**不是**涨停 metadata。误用 f2 当 secid → marketId="18" 不在 {0,1} → 全部 items 过滤掉 → 显示 0 只
10. **5xx 间歇**（2026-06-05 增补）— `push2.eastmoney.com` 凌晨/上游降级时 ~40% 概率 502。`fetchLimitUpList` 加 1 次 5xx 重试（参考 `fetchKline` 既有模式）。4xx/网络错/AbortError 不重试
11. **涨停 metadata (连板数/封板时间/炸板次数) 公开 API 拿不到**（2026-06-05 增补）— `f100/f102/f103` 不是 metadata。best-effort per-stock API（`/api/limit-up-stock`）默认 0/null/0。未来升级路径：用户装 AKTools 后端代理
12. **路由切换 race condition**（2026-06-05 增补）— in-flight `limitUpFetch` 的 finally 块可能误把 limit-up 渲染到 monitor 容器。修复：route handler `'#/'` 在 `renderMonitorPage` 之前 `limitUpRootEl = null`
13. **多 K 线图 + 缩放保留**（2026-06-05 增补）— 每只 expanded 股票一个 chart instance（`chartInstanceMap`），live tick 用 `series.update()` 而非 `setData + fitContent`，**保留用户缩放/拖动状态**

## 8. 验收标准

- ✅ `npm run lint` 0 errors / 0 warnings
- ✅ `npm test` 全部通过（新增 ≥ 29 cases，累计 305+）
- ✅ `npm run build` 成功
- ✅ 浏览器实测：
  - 点击"涨停看板"切换页面
  - 看板显示分组卡片（3+ / 2 / 1）
  - 桶内排序：连板数降序
  - 看板行点击 → 切回监控页 + 标的已添加 + 列表刷新
  - 看板行内价格随监控 timer 实时合并
  - 频率切换 / 立即刷新 / ST 标记

## 9. 实施顺序

1. `storage.js` 扩展（getLimitUpSettings / patchLimitUpSettings） + 测试
2. `router.js`（createHashRouter / parseHash / navigate） + 测试
3. `limitUp.js`（classifyByLimitCount / sortByLimitCount / mergeLiveTicks / isLimitUpName / buildLimitUpGroups） + 测试
4. `limitUpApi.js`（buildLimitUpUrl / parseLimitUpList / fetchLimitUpList） + 测试
5. `limitUpView.js`（renderLimitUpPage / renderLimitUpGroups / 事件处理） + 测试
6. `vite.config.js` 加 `/api/limit-up` 代理
7. `index.html` 加 `<nav>`
8. `app.js` 集成（startApp 路由化 / renderMonitorPage 拆分 / renderHeader 加 nav / 切换页面启停 timer）
9. `style.css` 加 `.lu-*` 样式
10. 整体验证（lint / test / build）+ 浏览器实测
