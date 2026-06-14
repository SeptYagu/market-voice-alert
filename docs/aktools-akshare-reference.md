# AKTools / AKShare 数据接口参考

更新时间: 2026-06-07

本项目通过本地 AKTools HTTP 服务调用 AKShare 接口。后续排查字段含义、接口参数和数据可用性时，优先参考以下地址。

## 文档地址

- AKShare 官方股票数据文档: https://github.com/akfamily/akshare/blob/main/docs/data/stock/stock.md
- AKShare ReadTheDocs 股票数据文档镜像: https://akshare-hh.readthedocs.io/en/latest/data/stock/stock.html
- AKShare GitHub 仓库: https://github.com/akfamily/akshare

## 当前使用接口

- `stock_zt_pool_em`: 涨停池。项目经 AKTools 路径 `/api/aktools/api/public/stock_zt_pool_em` 使用，字段包括 `连板数`、`首次封板时间`、`最后封板时间`、`炸板次数`、`涨停统计`、`所属行业`。
- `stock_zt_pool_zbgc_em`: 炸板池。项目经 AKTools 路径 `/api/aktools/api/public/stock_zt_pool_zbgc_em` 使用。
- `stock_lhb_detail_em`: 龙虎榜详情。项目只把它作为补充上下文使用，`上榜原因` 不是涨停原因。
- `stock_zh_a_spot_em`: A 股实时行情快照。用于全市场扫描 10 个交易日涨幅超过 45% 的股票池和补充实时价格、成交额、量比、行业。
- `stock_zh_a_hist_min_em`: 东方财富分钟历史行情。用于分时数据备用。
- `stock_intraday_em`: 东方财富分笔成交。用于最近交易日分时数据主源。

## 字段约定

- 涨停页“最终封板”只显示 `最后封板时间`，不回退到 `首次封板时间`。
- 涨停页“龙虎榜”字段来自 `stock_lhb_detail_em`，不能当作真实涨停原因。
- 45% 强势股分区的“异动/原因”优先使用涨停池字段中的 `涨停统计` 或已补充的上下文；没有时显示 `10日涨幅超45%`。
