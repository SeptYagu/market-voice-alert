# 2026-09-10 momentum 峰值触及审查缺陷闭环（P1 + P2）

对审查报告 [`2026-09-10-momentum-peak-touch-review.md`](2026-09-10-momentum-peak-touch-review.md)
（针对提交 `b321522`，审查基线 `9449721`）的逐项修复闭环。

## 用户决策

**峰值达标但当前已回落到成本线以下的标的：保留。**
入选口径只看「10 日窗口内是否曾触及阈值」，当前涨幅正负不再过滤——回踩监控
要盯的正是这类标的；要让它们离开列表应是显式的「破位」信号，而不是悄悄过滤。

## 修复清单

| 缺陷 | 修复 | 提交 |
|---|---|---|
| P1 换口径未使缓存失效，新逻辑可能静默不生效 | 新增 `MOMENTUM_RULE = 'peak-touch-v1'`：扫描产物与所有进度写入带上规则版本；读取端（JOBS 进行中分支、缓存命中分支）与 `ensureStartupMomentumScan` 判定都要求 rule 严格匹配，不匹配视为无缓存并触发重建；旧缓存若为失败快照仍透传原因 | `06944d1` |
| P2 入选口径与标题「触及超45%」不符 | 按用户决策放宽 `isMomentumEligible`（去掉 `currentGain > 0`），标题与口径一致 | `e188fb4` |
| P2 排序键与列名/列值不一致 | 表头改「10日涨幅(按冲高排序)」+ tooltip 说明主数值/排序键 | `e188fb4` |
| P2 服务端重复实现排序器 | 删除 `compareMomentumOrder`，统一 import `sortMomentumItems` | `e188fb4` |
| P2 回踩阈值/文案散在 4 处且正负号写法不一致 | 新增 `MOMENTUM_PULLBACK_EPSILON`(0.1)、`isPulledBack()`、`describeMomentumPeak()`；服务端扫描、前端兜底扫描、原因文案、涨幅单元格四处收敛为单一定义 | `e188fb4` |

注：`e188fb4` 顺带修复了修复过程中遗留的 server `anomaly` 未定义引用（曾导致
ReferenceError，已被 lint `no-undef` 拦截，未上过远端）。

P2「新 UI 零覆盖」**未在本轮处理**（见下「遗留」）。

## 验证门禁

- `npm run lint`：0 问题
- `npm test`：**768/768**（新增 1 条「旧规则缓存不得返回」；口径用例翻转为保留回踩标的）
- 反空转验证：新断言已在旧代码上确认失败（P1 那条 fail 1、口径那条 fail 1）
- `npx playwright test`：**63/63**
- `npm run build`：通过
- 审查复现脚本复跑：P1 不再复现（9 项中 8 项成立 → 该项转 F），其余为审查基线记录

## 遗留 / 下一步

1. ~~**新 UI（峰值副行）零覆盖**~~：已于 `73752d4` 补齐——E2E mock 补
   `maxGainPercent`/`pullbackPercent`，F-P0-1 用例新增副行断言，另新增
   「深度回踩标的保留在列表」用例（主数值 -1.20% + 副行 + 异动列文案）；
   已验证 mock 无峰值字段时用例失败（非空转断言）。E2E 63 → **64** 条。
2. **旧缓存清理**：`data/cache/momentum/<date>/ten-day-45pct.json`（无 rule 字段）
   会在下次扫描时自动重建，无需手动清理；VPS 部署后看
   `/api/cache/diagnostics` 确认 rule=`peak-touch-v1` 即完成验收。
3. VPS 由用户配置 Git 自动更新：推送后等 200 秒刷新页面验收。
