# VPS 日志排查：全市场快照故障与扫描覆盖误报

## 现场证据

2026-09-09 15:28–15:30 UTC，通过线上 `8e1c1a5` 的公开接口进行有限请求核验，没有触发全市场扫描。

| 检查 | 结果 |
| --- | --- |
| `/api/cache/health` | HTTP 200，Node 服务正常 |
| `/api/cache/diagnostics` | 持久化正常；启动期间东财连接中断/连接超时，腾讯/AKTools 超时 |
| `/api/cache/momentum/ten-day` | `status=complete`、`universeSize=33`、`seedCount=34`、1 只停牌、`spotSource=tencent-batch-quotes`；33 只 K 线刷新成功，腾讯 modern 32 / legacy 1 |
| `/api/cache/spot/latest` | 约 16 秒返回腾讯备用快照，来自本机缓存名单 |
| `/api/aktools/api/public/stock_zh_a_spot_em` | 约 9.4 秒返回 HTTP 500，正文 `Internal Server Error` |
| `/api/cache/limit-up?date=20260909` | 约 2.3 秒，HTTP 200、非 stale，48 涨停 + 27 炸板 |
| `/api/cache/calendar/trade-dates` | HTTP 200，非 stale 缓存，8797 个日期；不证明当前上游日历接口可用 |
| `/api/cache/kline?code=sh600000&period=1d` | 约 14 秒，HTTP 200、非 stale，640 根 |
| `/api/cache/intraday?code=sh600000&date=20260909` | 约 15.7 秒，HTTP 200、非 stale，241 点 |
| `/api/tencent/q=sh600000` | 约 1 秒，HTTP 200，正常 GBK 报价 |

## 已确认的代码缺陷及修复

`spotService` 在全市场 AKTools 快照失败后，枚举 `universe.json` 和本机 K 线缓存目录，交给腾讯批量查询。新 VPS 缓存不全，因此这只能恢复一个股票子集。`momentumService` 过去只按请求失败数判定 complete，导致 33 只扫描也被标为全市场完成。

- 全市场主源和本地缓存备用源明确记录名单覆盖来源及 `universeComplete`。
- 缓存名单扫描显示 partial 与覆盖警告；有效个股结果保留，但不能成为完整成功快照。
- 读取旧版腾讯备用扫描缓存时即时修正状态，无需删除缓存或重新扫市场；线上已有的 33 只结果也会显示警告。
- 腾讯已返回批次中缺失的股票也计入缺失数，与整批失败数量不重复相加。

## 本机复现及全市场快照修复

本机原先未启动 AKTools，使用已安装 Python 环境启动后，调用同一接口在约 11.8 秒返回 HTTP 500。本机 AKTools 0.0.91、AKShare 1.18.94 的异常栈定位到 `stock_hist_em.py → fetch_paginated_data → request_with_retry → requests.ConnectionError`，原始原因是 `RemoteDisconnected: Remote end closed connection without response`。对应上游为 `https://82.push2.eastmoney.com/api/qt/clist/get`。本机已经复现，无需先索取 VPS 原始日志；这也不能据此推断 IP 封禁原因。

按 [AKShare 官方接口说明](https://akshare.akfamily.xyz/data/stock/stock.html)，新浪提供另一个 A 股行情来源。本轮核对本机 AKShare 源码中的新浪分页接口，并真实请求验证后，在 Node 后端直接接入 HTTPS 新浪完整分页快照，不依赖故障的 Python 东财函数。

- `getHQNodeStockCount?node=hs_a` 获取总数，`getHQNodeData` 按 symbol 固定顺序分页，每页 80、并发 4；全流程最多 45 秒，单次请求最多 12 秒。
- 校验每页长度、股票代码、全量去重数和请求结束时总数；任何缺页、重码、总数变化、HTTP 错误都不能写成完整快照。失败时取消其他分页请求。
- 新浪成交量为股，转换为项目使用的手；成交额保持元。去除无价格/无交易数据项，并单独记录排除数。
- 回退顺序：AKTools 东财 → 新浪全市场 → 本机缓存名单腾讯回退。仅最后一级是不完整覆盖。
- 启动时遇到旧版缓存子集结果会补扫；扫描中的响应也携带股票名单覆盖来源。

真实本机验证：直接新浪取数约 11.5 秒，5559 条名单全部收到，5549 个有效快照（10 个无交易数据），沪 2311 / 深 2895 / 北 343；通过生产 Node `/api/cache/spot/latest` 冷缓存请求约 16.1 秒返回 HTTP 200、`source=sina-full-market`、`universeComplete=true`，相同覆盖数量。没有为了快照测试启动数千只股票的 K 线扫描。

增加 `npm run test:spot-live`：在独立临时缓存中真实调用生产快照服务，输出来源、覆盖数量与市场分布。它是显式联网检查，不纳入离线 CI。

验证：完整 CI 721 单测、62 E2E、lint/build 全部通过；`test:spot-live` 独立执行约 14.9 秒返回 5549 个有效快照。测试覆盖缺页、重复代码、总数变化、HTTP 失败、单位换算、主源 HTTP 500 的生产回退、旧缓存纠正以及页面覆盖警告。

## 剩余边界

上游东财/Python 原始接口仍可能报错，但项目全市场快照可以通过独立来源恢复。修复目标是恢复项目功能；没有修改用户机器上的 AKShare 安装文件或盲目升级依赖。

东财连接错误是单次请求失败；腾讯回退已让测试个股 K 线与分时成功。不能仅凭错误条数认定整个行情功能不可用。冷请求在回退前等待主源，导致 14–16 秒响应，值得后续优化；避免无证据修改代理或全局 DNS。

新 VPS 缺少几千只股票的历史 K 线时，首次全市场动量扫描会慢于快照；快照恢复不能等同于所有 K 线回填已结束。必须分别检查 `universeComplete`、`scanned`、`refreshFailures` 与任务状态。
