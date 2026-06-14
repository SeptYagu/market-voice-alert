# 2026-06-06 Intraday Data Source Fix Report

## Scope

- Clarified current AKTools/AKShare field mappings.
- Corrected the UI wording for Dragon-Tiger Board data that had been shown as
  generic "reason".
- Added AKTools-first intraday loading with Eastmoney fallback.
- Added intraday percent display and volume series.
- Improved K-line click handling by using the last crosshair time as a click
  fallback.

## Data Source Notes

Reference document:

- `docs/data-source-field-reference.md`

Key finding:

- `stock_zt_pool_em` does not provide a true limit-up reason field.
- The existing "reason" data comes from `stock_lhb_detail_em`.
- `stock_lhb_detail_em.上榜原因` is Dragon-Tiger Board listing reason, not
  limit-up reason.

Intraday priority:

1. `stock_intraday_em` through AKTools: latest trading day tick data, includes
   opening auction when the local AKTools/upstream call succeeds.
2. `stock_zh_a_hist_min_em` through AKTools: recent historical 1-minute data.
3. Eastmoney `trends2/get`: direct fallback for latest day.
4. Existing 1-minute K-line fallback.

## Browser Observation

Real local page checked at:

```text
http://127.0.0.1:5173/#/limit-up
```

Observed:

- Date resolved to `2026-06-05`.
- Table header now shows `龙虎榜`.
- Expanded row renders left intraday pane and right K-line pane.
- Local runtime example status:

```text
2026-06-05 · 241 点 · 8.14 · +10.00% · 东财K线备用
```

This means the local AKTools intraday endpoint did not return usable intraday
data in this environment, and the fallback chain supplied same-date minute data.
Opening auction points require `stock_intraday_em` to succeed.

## Verification

Passed:

```bash
npm run lint
npm test
npm run e2e
npm run build
```

E2E result:

```text
48 passed
```

Unit test coverage added for:

- AKTools intraday tick aggregation.
- AKTools historical minute parsing.
- Eastmoney trends fallback parsing.
- `fetchIntraday` source priority.
- Intraday chart multi-series data acceptance.
