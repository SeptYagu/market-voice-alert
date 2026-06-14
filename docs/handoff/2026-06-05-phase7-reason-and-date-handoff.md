# Phase 7 — 涨停原因 + 日期选择 升级

> **本 session 增量**：
> 1. 加 **"涨停原因" 列**（来源：龙虎榜 `stock_lhb_detail_em` `上榜原因` + `解读`）
> 2. 加 **日期选择器**（HTML5 `<input type="date">` + "今天" 按钮，调用 `stock_zt_pool_em?date=YYYYMMDD`）

前一个 session：[`2026-06-05-aktools-upgrade-handoff.md`](2026-06-05-aktools-upgrade-handoff.md)（AKTools 接入）

- **日期**: 2026-06-05
- **触发**: 用户要求"加涨停原因，加日期选择"
- **范围**: 涨停看板数据增强 + UI 扩展

---

## 1. 30 秒速览

| 指标 | 数值 |
|------|------|
| **测试** | **512 total** = 476 unit + 36 e2e，**全 pass** |
| **Lint** | 0 errors / 0 warnings |
| **Build** | 成功 (225.85 kB JS / 16.51 kB CSS / gzip 70.61 kB) |
| **新增源码** | `src/js/aktoolsApi.js` +30 行（reason 模块）|
| **修改源码** | `app.js` +50 行（selectedDate + kickoffLimitUpReasonsFetch）<br>`limitUpView.js` +60 行（日期选择器 + 原因列）<br>`style.css` +30 行（原因列 + 日期样式）|
| **新增测试** | 17 个 aktoolsApi reason cases + 4 个 e2e |
| **数据源新增** | `stock_lhb_detail_em`（龙虎榜，含上榜原因 + 解读）|

### 收益
1. **涨停原因可见**：33~41% 涨停股进了龙虎榜，UI 显示 `上榜原因`（如"日涨幅偏离值达7%的证券"），鼠标悬停看 `解读`（如"3家机构买入，成功率52.31%"）
2. **历史日期回放**：选择任意历史日期（≤今天），看板拉取该日数据，状态栏显示"共 N 只涨停（YYYY-MM-DD）"
3. **缓存隔离**：不同日期的涨停/龙虎榜数据各自缓存 30s，切换日期时清缓存 + 重新拉

---

## 2. 用户问题

> "加涨停原因，加日期选择"

### 关键调研发现
**AKShare 涨停池本身没有"涨停原因"字段**（已通过 webfetch 查官方文档确认）。最近的两个备选：

| 备选 | 含原因字段？ | 适用性 |
|---|---|---|
| `stock_zt_pool_strong_em`（强势股池）| ✅ `入选理由`，但**只有 3 个固定值**（60日新高/近期多次涨停/60日新高且近期多次涨停）| ❌ 信息量低 |
| `stock_lhb_detail_em`（龙虎榜详情）| ✅ `上榜原因`（如"日涨幅偏离值达7%的证券"）+ `解读`（如"3家机构买入"）| ✅ **采用** |
| 题材/概念板块（`stock_board_concept_*_em`）| ✅ 但需**按代码 join** 到涨停股，N+1 查询 | ⏸ 不在本 PR（信息已在 `所属行业` 字段中）|

**最终选择**：`stock_lhb_detail_em` 的 `上榜原因` + `解读` 组合作为"涨停原因"列。覆盖 33~41% 涨停股（不上龙虎榜的留空，显示"—"）。

### 真实数据样例（2026-06-04）
- 涨停 80 只，**33 只进龙虎榜**（41%）
- 典型上榜原因：
  - `日涨幅偏离值达到7%的前5只证券` — 单日涨幅榜
  - `非ST、*ST和S证券连续三个交易日内收盘价格涨幅偏离值累计达到20%的证券` — 3 日累计
  - `有价格涨跌幅限制的日换手率达到20%的前五只证券` — 换手率榜
  - `日跌幅偏离值达到7%的前5只证券` — 跌停股（也进龙虎榜）

---

## 3. 数据流

### 3.1 `limitUpFetch` 升级
```
limitUpFetch()
  ↓
state.limitUp.selectedDate || null  (默认今天)
  ↓
fetchLimitUpList({ date })            → 涨停池 80 条
kickoffLimitUpMetadataFetch()         → 现在 no-op（AKTools 已含连板数）
kickoffLimitUpReasonsFetch(date)      → 龙虎榜 100+ 条
  ↓
合并: items[].reason + items[].interpretation = reasonMap.get(code)
```

### 3.2 日期切换流
```
用户改 #lu-date 输入框
  ↓
cb.onDateChange(newDate)
  ↓
handleLimitUpDateChange(newDate)
  ↓
clearLimitUpMetadataCache()    ← 清所有 aktools 缓存（含 reason）
state.limitUp.selectedDate = newDate
state.limitUp.reasonMap = new Map()
limitUpFetch()                  ← 重新拉
```

### 3.3 缓存策略
- 涨停池：`{kind: 'limitUp', date}` 为 key
- 炸板池：`{kind: 'broken', date}` 为 key
- 龙虎榜：`{kind: 'reason', date}` 为 key
- 30s TTL 各自独立
- "今天" 按钮 / 日期切换 → 全清

---

## 4. 文件变更清单

### 4.1 修改
| 文件 | 变更 |
|---|---|
| `src/js/aktoolsApi.js` | +30 行：`fetchAktoolsLimitUpReasonList` + `parseAktoolsLimitUpReasonList` + `_buildReasonUrl` + `_parseReasonItem` + 常量 `REASON_INTERFACE` / `REASON_MAX_LEN` |
| `src/js/limitUpApi.js` | +15 行：`fetchLimitUpReasons` 包装（返回 `Map<code, {reason, interpretation}>`）|
| `src/js/app.js` | (1) `import` 加 `fetchLimitUpReasons`；(2) `state.limitUp` 加 `selectedDate: null` + `reasonMap: new Map()`；(3) `limitUpFetch` 传 `date` + 调 `kickoffLimitUpReasonsFetch`；(4) 新增 `kickoffLimitUpReasonsFetch` + `handleLimitUpDateChange`；(5) `rerenderLimitUpPage` 加 `onDateChange` callback |
| `src/js/limitUpView.js` | (1) `buildRow` 加 `<td class="lu-reason" title="...">` 渲染 `item.reason`；(2) `buildGroup` 表头加 `<th class="lu-reason">原因</th>`；(3) `buildToolbar` 加日期选择器 row；(4) 新增 `buildDateInput` + `formatDateForInput` |
| `src/style.css` | (1) 新增 `.lu-date-wrap` / `.lu-date-input` / `.lu-date-today` 样式（25 行）；(2) 新增 `.lu-table td.lu-reason` 截断 + tooltip 样式（10 行）|
| `tests/aktoolsApi.test.js` | +17 cases：`parseAktoolsLimitUpReasonList` 6 cases + `fetchAktoolsLimitUpReasonList` 9 cases + 缓存隔离 2 cases |
| `e2e/fixtures/limits-up.js` | +30 行：`LIMIT_UP_REASONS_BODY` 龙虎榜 mock（6 条含原因 + 隐式 4 条无原因）|
| `e2e/helpers.js` | (1) import `LIMIT_UP_REASONS_BODY`；(2) 加 `**/api/aktools/api/public/stock_lhb_detail_em**` 路由 |
| `e2e/limit-up.spec.js` | +4 cases：原因列有数据 / 原因列无数据 / 日期选择器存在 / "今天" 按钮可点 |

### 4.2 文档
| 文件 | 变更 |
|---|---|
| `AGENTS.md` | (1) `state.limitUp` 新字段；(2) Phase 7 行加到 STATUS 表格 |
| `STATUS.md` | +Phase 7 行（✅ 涨停原因 + 日期选择）|

---

## 5. 关键设计决策

### 5.1 为什么"上榜原因"用龙虎榜而不是涨停池自带？
- **涨停池** `stock_zt_pool_em` **没有"原因"字段**（已实测 + webfetch 确认）
- **龙虎榜**有，但覆盖仅 33~41%（不上榜的留空 — 这是业务现实）
- **替代方案 A**：用 `所属行业` 作为"原因"（但 80 只都同行业也常见）
- **替代方案 B**：调 `stock_zt_pool_strong_em` 拿 `入选理由`（仅 3 个固定值）
- **决策**：选龙虎榜，**接受 33~41% 覆盖**，UI 显示"—"作为透明 fallback

### 5.2 为什么日期选择器用 `<input type="date">` 而不是自定义日历？
- HTML5 原生，移动端自动调起日期选择器
- 无需第三方库（无依赖增量）
- 国际化友好（用户 OS locale 自动适配）
- 限制 `max={今天}` 防止选未来日期

### 5.3 为什么"今天"按钮单独存在？
- 用户切到 5/3 后想快速回今天 → 一键
- 减少键盘操作
- **不持久化** selectedDate（每次重置 = 避免用户切日期后忘记切回）

### 5.4 为什么 `state.limitUp.reasonMap` 单独存，不直接合并到 items？
- **职责分离**：龙虎榜数据**独立**于涨停池
- **不阻塞渲染**：reasonMap 后台拉取，主列表先渲染（有原因的数据二次重渲染）
- **复用**：未来可加 `涨停原因排序` 等新功能

---

## 6. 调试 / 验证

### 6.1 本地验证

```bash
# 1. 启动 AKTools（用户本机）
aktools

# 2. 启动 dev server
npm run dev
# 浏览器打开 http://127.0.0.1:5173/#/limit-up

# 3. 验证日期切换
# - 默认日期 = 今天
# - 切到 2026-06-03 → 重新拉（DevTools Network 看 ?date=20260603）
# - 点 "今天" → 回到今天

# 4. 验证原因列
# - 鼠标悬停 "上榜原因" → tooltip 显示 "解读"
# - 没上榜的股票 → 显示 "—"
```

### 6.2 AKTools 故障排查

| 现象 | 原因 | 解决 |
|---|---|---|
| 原因列全空 | 龙虎榜接口失败 | DevTools Network 看 `stock_lhb_detail_em` 请求 |
| 切日期不生效 | 缓存没清 | 检查 `handleLimitUpDateChange` 是否调用 `clearLimitUpMetadataCache` |
| 状态栏日期不对 | `state.limitUp.selectedDate` 没更新 | 浏览器 console 看 `state.limitUp` |

---

## 7. 测试覆盖率

| 模块 | 测试 | 说明 |
|---|---|---|
| `aktoolsApi.buildAktoolsUrl` | 5 cases | URL 构造 |
| `aktoolsApi.parseAktoolsLimitUpList` | 9 cases | 涨停池解析 |
| `aktoolsApi.fetchAktoolsLimitUpList` | 13 cases（含日期缓存隔离）| 涨停池拉取 |
| `aktoolsApi.parseAktoolsLimitUpReasonList` | 6 cases 🆕 | 龙虎榜解析（6 位代码/HHMMSS/截断/缺字段）|
| `aktoolsApi.fetchAktoolsLimitUpReasonList` | 9 cases 🆕 | 龙虎榜拉取（URL 构造/Abort/缓存）|
| `limitUpApi` 兼容 | 22 cases | buildLimitUpUrl / parseLimitUpList / fetchLimitUpList / fetchLimitUpAndBrokenList / metadata / clear |
| 其他模块 | 412 cases | 监控页 / K线 / TTS / alert / chart / storage / theme / parser / api / router / worker |
| e2e (Playwright) | 36 cases（+4 🆕）| 路由 5 + 监控 6 + 看板 13（含原因 2 + 日期 2） + 看板行点击 3 + K线 7 + 持久化 2 |
| **总计** | **512** | **476 unit + 36 e2e** |

---

## 8. 沉淀的经验

### 8.1 字段映射陷阱
- **AKTools 字段名 = 中文键**（`代码/名称/最新价`），跟东财 `f12/f14/f2` 完全不同
- **龙虎榜 `上榜原因` 实际是"上榜规则"**，不是真正的"涨停原因"（题材/概念）
- **接受 33~41% 覆盖**作为业务现实，UI 透明显示"—"是诚实的做法

### 8.2 数据流设计
- **独立缓存 key**（`{kind, date}`）让不同数据/日期互不干扰
- **后台拉取 reason** 不阻塞主列表渲染（先显示，reason 到了二次重渲染）
- **用户主动操作必须绕过缓存**（"今天" 按钮 + 立即刷新 + 日期切换都清缓存）

### 8.3 UI 设计
- **HTML5 原生 `<input type="date">` 优于自定义日历**（无依赖、跨平台）
- **"max={今天}"** 防止选未来日期
- **CSS 截断 + `title` tooltip** 显示完整原因（避免表格行高被长文本撑开）
- **state 不持久化**（每次重置 = 用户切日期后忘记切回的风险归零）

### 8.4 TDD 在数据源迁移中的价值
- 17 个新测试一次过（除我自己改错 `change = 22.38 * 20% = 4.48` 类似的）
- 真实样本 + 6 位代码前缀推断测试 = 0 业务 bug

---

## 9. 下一步建议

### 9.1 立即可做
1. **用户浏览器实测**（最优先）：用户最后一次实际验证所有功能
2. **涨停原因排序**（下个 PR）：按"上榜原因"分组（连续 20% / 单日 7% / 换手率 20%）
3. **涨停原因筛选**（下个 PR）：下拉选只看"机构买入"的涨停股

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

1. **AKTools 启动了吗？** → `curl http://127.0.0.1:8888/api/public/stock_zt_pool_em` 应返回 `[]`（非交易日）
2. **端口对吗？** → bat 脚本是 8888（非默认 8080），`vite.config.js` 也要 8888
3. **原因列全空？** → 检查 `stock_lhb_detail_em` 是否被路由拦截（`e2e/helpers.js:48`）
4. **日期切换不生效？** → 浏览器 console 看 `state.limitUp.selectedDate` 是否更新
5. **测试还过吗？** → `npm test` 应 476 全过 + `npm run e2e` 36 全过

---

## 11. 关键命令

```bash
# 用户本机
aktools              # 启动后端（端口 8888）

# 项目
npm run dev          # 启动 Vite dev server
npm test             # QUnit 476 tests
npm run e2e          # Playwright 36 tests
npm run ci           # 完整 CI

# 验证 AKTools
curl http://127.0.0.1:8888/api/public/stock_zt_pool_em?date=20260604
curl http://127.0.0.1:8888/api/public/stock_lhb_detail_em?start_date=20260604&end_date=20260604
```

---

## 12. 关联文档

- `AGENTS.md` — 项目总览（已更新 state.limitUp 新字段 + Phase 7 行）
- `STATUS.md` — 进度状态（已加 Phase 7 行）
- `docs/handoff/2026-06-05-aktools-upgrade-handoff.md` — 前一个 session 交接（AKTools 接入）
- `docs/handoff/2026-06-05-phase5-bugfixes-handoff.md` — Phase 5 + 2 个 K线 bug 修复交接
- `docs/phase4-limit-up-board.md` — 涨停看板用户文档（待更新：新功能）
