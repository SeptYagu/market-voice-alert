# Data Source Field Reference

Last updated: 2026-06-07

This project uses the local AKTools HTTP service as the primary data source for
limit-up board data and intraday data. Direct Eastmoney/Tencent calls remain as
fallbacks where needed.

## Documentation Links

- AKTools official docs: https://aktools.akfamily.xyz/
- AKTools usage and HTTP path examples: https://aktools.akfamily.xyz/aktools/
- AKShare HTTP deployment: https://akshare.akfamily.xyz/deploy_http.html
- AKShare stock data docs: https://akshare.akfamily.xyz/data/stock/stock.html
- AKShare stock data source markdown: https://github.com/akfamily/akshare/blob/main/docs/data/stock/stock.md

AKTools exposes AKShare functions through:

```text
http://127.0.0.1:<port>/api/public/<akshare_function_name>?param=value
```

The Vite dev proxy maps that to:

```text
/api/aktools/api/public/<akshare_function_name>?param=value
```

### `stock_zh_a_spot_em`

Purpose: full-market A-share real-time quote list through AKShare/AKTools.

Current endpoint:

```text
/api/aktools/api/public/stock_zh_a_spot_em
```

Current fields and app mapping:

| Source field | Meaning | App field |
| --- | --- | --- |
| `代码` | 6-digit stock code | `code` with `sh`/`sz`/`bj` prefix |
| `名称` | Stock name | `name` |
| `最新价` | Latest price | `price` |
| `涨跌幅` | Percent change, unit `%` | `changePercent` |
| `涨跌额` | Price change | `change` |
| `成交量` | Volume | `volume` |
| `成交额` | Turnover amount | `amount` |
| `最高` | High | `high` |
| `最低` | Low | `low` |
| `今开` | Open | `open` |
| `昨收` | Previous close | `prevClose` |
| `量比` | Volume ratio | `volumeRatio` |
| `换手率` | Turnover rate, unit `%` | `turnoverRate` |

Important: the AKShare docs for this interface expose `60日涨跌幅` and
`年初至今涨跌幅`, but not a direct 10-trading-day gain field. The app's
`10日涨幅超45%` monitor section therefore uses this endpoint only as the
full-market universe, then computes the 10-trading-day gain from daily K-line
data.

## Current App Mappings

### `stock_zt_pool_em`

Purpose: Eastmoney limit-up pool through AKShare/AKTools.

Observed local endpoint:

```text
/api/aktools/api/public/stock_zt_pool_em?date=YYYYMMDD
```

Current fields and app mapping:

| Source field | Meaning | App field |
| --- | --- | --- |
| `代码` | 6-digit stock code | `code` with `sh`/`sz`/`bj` prefix |
| `名称` | Stock name | `name` |
| `涨跌幅` | Percent change, unit `%` | `changePercent` |
| `最新价` | Latest price | `price` |
| `成交额` | Turnover amount | `amount` |
| `封板资金` | Sealed limit-up order amount | available from source, not displayed yet |
| `首次封板时间` | First limit-up seal time | `firstLimitTime` |
| `最后封板时间` | Last limit-up seal time | `lastLimitTime` |
| `炸板次数` | Opened limit count | `breakCount` |
| `涨停统计` | Limit-up statistics such as `1/1` | `limitStats` |
| `连板数` | Consecutive limit-up count | `limitUpCount` |
| `所属行业` | Industry | `industry` |
| `流通市值` | Free-float market cap | available from source, not displayed yet |
| `总市值` | Total market cap | available from source, not displayed yet |
| `换手率` | Turnover rate, unit `%` | available from source, not displayed yet |

Important: this endpoint does not provide a real "limit-up reason" field.

### `stock_zt_pool_zbgc_em`

Purpose: Eastmoney broken-limit pool through AKShare/AKTools.

Observed local endpoint:

```text
/api/aktools/api/public/stock_zt_pool_zbgc_em?date=YYYYMMDD
```

Current fields and app mapping:

| Source field | Meaning | App field |
| --- | --- | --- |
| `代码` | 6-digit stock code | `code` with market prefix |
| `名称` | Stock name | `name` |
| `涨跌幅` | Percent change, unit `%` | `changePercent` |
| `最新价` | Latest price | `price` |
| `涨停价` | Limit-up price | available from source, not displayed yet |
| `成交额` | Turnover amount | `amount` |
| `首次封板时间` | First limit-up seal time | `firstLimitTime` |
| `炸板次数` | Opened limit count | `breakCount` |
| `涨停统计` | Limit-up statistics | `limitStats` |
| `振幅` | Amplitude | available from source, not displayed yet |
| `所属行业` | Industry | `industry` |

### `stock_lhb_detail_em`

Purpose: Dragon-Tiger Board detail through AKShare/AKTools.

Current endpoint:

```text
/api/aktools/api/public/stock_lhb_detail_em?start_date=YYYYMMDD&end_date=YYYYMMDD
```

Current fields and app mapping:

| Source field | Meaning | App field |
| --- | --- | --- |
| `代码` | 6-digit stock code | `code` |
| `名称` | Stock name | `name` |
| `上榜日` | Dragon-Tiger Board date | `date` |
| `上榜原因` | Dragon-Tiger Board listing reason | `reason` |
| `解读` | Dragon-Tiger Board interpretation | `interpretation` |
| `涨跌幅` | Percent change, unit `%` | `pct` |

Important: `上榜原因` is a Dragon-Tiger Board reason, not a limit-up cause.
The UI should label it as `龙虎榜`, `龙虎榜原因`, or similar.

### `stock_intraday_em`

Purpose: Eastmoney tick-level intraday data through AKShare/AKTools.

Current endpoint:

```text
/api/aktools/api/public/stock_intraday_em?symbol=600519
```

Official docs describe it as a single-stock latest trading-day intraday data
interface that includes pre-market data. It is therefore the preferred source
for opening auction data.

Documented fields:

| Source field | Meaning | App field after minute aggregation |
| --- | --- | --- |
| `时间` | Tick time, e.g. `09:15:00` | minute `time` |
| `成交价` | Trade price | minute `open/high/low/close`, `price` |
| `手数` | Trade size in lots | minute `volume` |
| `买卖盘性质` | Trade side nature | kept only as source context for now |

The app aggregates ticks into one-minute bars and computes:

- `amount = 成交价 * 手数 * 100`
- `avgPrice = cumulative amount / cumulative shares`
- `percent = (close / previousClose - 1) * 100`

### `stock_zh_a_hist_min_em`

Purpose: Eastmoney historical A-share minute data through AKShare/AKTools.

Current endpoint:

```text
/api/aktools/api/public/stock_zh_a_hist_min_em?symbol=600519&start_date=YYYY-MM-DD%2009%3A15%3A00&end_date=YYYY-MM-DD%2015%3A00%3A00&period=1
```

Official docs note that 1-minute data only returns recent trading days and is
not adjusted. It is used as the AKTools fallback when `stock_intraday_em` is not
available or the selected date is not the latest trading day.

Documented fields:

| Source field | Meaning | App field |
| --- | --- | --- |
| `时间` | Minute timestamp | `time` |
| `开盘` | Open | `open` |
| `收盘` | Close | `close`, `price` |
| `最高` | High | `high` |
| `最低` | Low | `low` |
| `成交量` | Volume in lots | `volume` |
| `成交额` | Amount | `amount` |
| `均价` | Average price | `avgPrice` |

### Direct Eastmoney `trends2/get`

Purpose: direct Eastmoney fallback only.

Observed endpoint:

```text
/api/eastmoney-kline/qt/stock/trends2/get?secid=1.600519&fields1=...&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ndays=1
```

Observed fields:

| Source field | Meaning |
| --- | --- |
| `data.preClose` | Previous close |
| `data.trends[]` | comma-separated rows |
| row part `0` | `YYYY-MM-DD HH:mm` |
| row part `1` | open |
| row part `2` | close |
| row part `3` | high |
| row part `4` | low |
| row part `5` | volume |
| row part `6` | amount |
| row part `7` | average price |

This fallback usually starts at 09:30 and should not be treated as a source for
opening auction data.
