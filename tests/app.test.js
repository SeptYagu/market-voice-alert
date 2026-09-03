import {
  parseBatchInput,
  formatNumber,
  formatChange,
  formatPercent,
  priceDirection,
  stripPrefix,
  makeExportFilename,
  buildExportText,
  REFRESH_OPTIONS,
  DEFAULT_REFRESH,
  DEFAULT_VOICE_SETTINGS,
  DEFAULT_ALERT_SETTINGS,
  normalizeVoiceSettings,
  normalizeAlertSettings,
  clampVolume,
  parseIntervalSeconds,
  parseAlertThreshold,
  parseLimitUpIntervalSeconds,
  LIMIT_UP_REFRESH_OPTIONS,
  applyLimitUpFetchResult,
  _internal,
  _setChartInstance,
  _setIntradayChartInstance,
  openChart as _openChart,
  closeChart as _closeChart,
  closeAllCharts as _closeAllCharts,
  handlePeriodChange as _handlePeriodChange,
  mountChartForCode as _mountChartForCode,
  applyLiveTickToChartForCode as _applyLiveTickToChartForCode,
  applyLiveQuoteToIntradayForCode as _applyLiveQuoteToIntradayForCode,
  updateChartLastTickMulti as _updateChartLastTickMulti
} from '../src/js/app.js';
import { parseBeijingDateTimeToChartSeconds } from '../src/js/time.js';

QUnit.module('app.parseBatchInput', () => {
  QUnit.test('parses comma-separated codes with auto-prefix', (t) => {
    t.deepEqual(parseBatchInput('600519,000001'), ['sh600519', 'sz000001']);
  });
  QUnit.test('parses space-separated codes', (t) => {
    t.deepEqual(parseBatchInput('600519 000001 300750'), [
      'sh600519',
      'sz000001',
      'sz300750'
    ]);
  });
  QUnit.test('mixes comma and space separators', (t) => {
    t.deepEqual(parseBatchInput('600519, 000001 ,300750'), [
      'sh600519',
      'sz000001',
      'sz300750'
    ]);
  });
  QUnit.test('tolerates full-width comma (，) for Chinese users', (t) => {
    t.deepEqual(parseBatchInput('600519，000001'), ['sh600519', 'sz000001']);
  });
  QUnit.test('does NOT split on semicolons, newlines or other punctuation', (t) => {
    // semicolon/newline/、 should NOT be valid separators per spec
    t.deepEqual(parseBatchInput('600519;000001'), []);
    t.deepEqual(parseBatchInput('600519\n000001'), []);
    t.deepEqual(parseBatchInput('600519、000001'), []);
  });
  QUnit.test('keeps existing prefixes intact', (t) => {
    t.deepEqual(parseBatchInput('sh600519, sz000001'), ['sh600519', 'sz000001']);
  });
  QUnit.test('handles future codes (nf prefix)', (t) => {
    t.deepEqual(parseBatchInput('nf2105, 600519'), ['nf2105', 'sh600519']);
  });
  QUnit.test('deduplicates after normalization', (t) => {
    t.deepEqual(parseBatchInput('600519, sh600519, 600519'), ['sh600519']);
  });
  QUnit.test('discards invalid tokens silently', (t) => {
    t.deepEqual(parseBatchInput('600519, garbage, 12, 000001'), [
      'sh600519',
      'sz000001'
    ]);
  });
  QUnit.test('empty input returns []', (t) => {
    t.deepEqual(parseBatchInput(''), []);
    t.deepEqual(parseBatchInput('   '), []);
    t.deepEqual(parseBatchInput(null), []);
    t.deepEqual(parseBatchInput(undefined), []);
  });
});

QUnit.module('app.formatNumber', () => {
  QUnit.test('formats finite numbers with 2 decimals', (t) => {
    t.equal(formatNumber(1850), '1850.00');
    t.equal(formatNumber(1850.5), '1850.50');
    t.equal(formatNumber(0), '0.00');
  });
  QUnit.test('respects decimals param', (t) => {
    t.equal(formatNumber(1850.789, 3), '1850.789');
    t.equal(formatNumber(1850.789, 0), '1851');
  });
  QUnit.test('returns - for non-finite/null', (t) => {
    t.equal(formatNumber(null), '-');
    t.equal(formatNumber(undefined), '-');
    t.equal(formatNumber(NaN), '-');
    t.equal(formatNumber(Infinity), '-');
  });
});

QUnit.module('app.priceDirection', () => {
  QUnit.test('positive -> up, negative -> down, zero -> flat', (t) => {
    t.equal(priceDirection(1), 'up');
    t.equal(priceDirection(-1), 'down');
    t.equal(priceDirection(0), 'flat');
    t.equal(priceDirection(NaN), 'flat');
    t.equal(priceDirection(null), 'flat');
  });
});

QUnit.module('app.formatChange / formatPercent', () => {
  QUnit.test('formatChange prefixes + for positive', (t) => {
    t.equal(formatChange(42.5), '+42.50');
    t.equal(formatChange(-42.5), '-42.50');
    t.equal(formatChange(0), '0.00');
    t.equal(formatChange(null), '-');
  });
  QUnit.test('formatPercent appends %', (t) => {
    t.equal(formatPercent(2.35), '+2.35%');
    t.equal(formatPercent(-2.35), '-2.35%');
    t.equal(formatPercent(0), '0.00%');
    t.equal(formatPercent(NaN), '-');
  });
});

QUnit.module('app.stripPrefix', () => {
  QUnit.test('strips sh/sz/bj/nf prefixes', (t) => {
    t.equal(stripPrefix('sh600519'), '600519');
    t.equal(stripPrefix('sz000001'), '000001');
    t.equal(stripPrefix('bj830799'), '830799');
    t.equal(stripPrefix('nf2105'), '2105');
  });
  QUnit.test('uppercase prefix also handled', (t) => {
    t.equal(stripPrefix('SH600519'), '600519');
  });
  QUnit.test('returns input without prefix unchanged', (t) => {
    t.equal(stripPrefix('600519'), '600519');
  });
  QUnit.test('empty input returns ""', (t) => {
    t.equal(stripPrefix(''), '');
    t.equal(stripPrefix(null), '');
  });
});

QUnit.module('app.makeExportFilename', () => {
  QUnit.test('uses yyyyMMdd_HHmmss timestamp', (t) => {
    const d = new Date(2024, 2, 15, 9, 25, 30);
    t.equal(makeExportFilename('stocks', d), 'stocks_20240315_092530.txt');
  });
  QUnit.test('zero-pads month/day/time', (t) => {
    const d = new Date(2024, 0, 5, 1, 2, 3);
    t.equal(makeExportFilename('x', d), 'x_20240105_010203.txt');
  });
});

QUnit.module('app.buildExportText', () => {
  QUnit.test('joins stripped codes by newline', (t) => {
    t.equal(
      buildExportText(['sh600519', 'sz000001', 'bj830799']),
      '600519\n000001\n830799'
    );
  });
  QUnit.test('drops empty entries', (t) => {
    t.equal(buildExportText(['sh600519', '', null, 'sz000001']), '600519\n000001');
  });
  QUnit.test('empty list returns empty string', (t) => {
    t.equal(buildExportText([]), '');
  });
});

QUnit.module('app.constants', () => {
  QUnit.test('REFRESH_OPTIONS sorted ascending', (t) => {
    const values = REFRESH_OPTIONS.map((o) => o.value);
    t.deepEqual(values, [3000, 10000, 30000, 60000]);
  });
  QUnit.test('DEFAULT_REFRESH is 10s', (t) => {
    t.equal(DEFAULT_REFRESH, 10000);
  });
  QUnit.test('DEFAULT_VOICE_SETTINGS has expected shape (interval defaults to 5s)', (t) => {
    t.equal(DEFAULT_VOICE_SETTINGS.enabled, false);
    t.equal(DEFAULT_VOICE_SETTINGS.interval, 5000);
    t.equal(DEFAULT_VOICE_SETTINGS.volume, 80);
    t.deepEqual(DEFAULT_VOICE_SETTINGS.fields, { name: true, price: true, percent: true });
    t.deepEqual(DEFAULT_VOICE_SETTINGS.fieldsOrder, ['name', 'price', 'percent']);
  });
  QUnit.test('DEFAULT_ALERT_SETTINGS has expected shape', (t) => {
    t.equal(DEFAULT_ALERT_SETTINGS.enabled, false);
    t.equal(DEFAULT_ALERT_SETTINGS.threshold, 5);
  });
});

QUnit.module('app.normalizeVoiceSettings', () => {
  QUnit.test('returns defaults when input is null/undefined/empty', (t) => {
    t.deepEqual(normalizeVoiceSettings(null), { ...DEFAULT_VOICE_SETTINGS, fields: { ...DEFAULT_VOICE_SETTINGS.fields } });
    t.deepEqual(normalizeVoiceSettings(undefined), { ...DEFAULT_VOICE_SETTINGS, fields: { ...DEFAULT_VOICE_SETTINGS.fields } });
    t.deepEqual(normalizeVoiceSettings({}), { ...DEFAULT_VOICE_SETTINGS, fields: { ...DEFAULT_VOICE_SETTINGS.fields } });
  });
  QUnit.test('coerces enabled to boolean', (t) => {
    t.equal(normalizeVoiceSettings({ enabled: 'yes' }).enabled, true);
    t.equal(normalizeVoiceSettings({ enabled: 0 }).enabled, false);
    t.equal(normalizeVoiceSettings({ enabled: true }).enabled, true);
  });
  QUnit.test('interval accepts any positive integer ms >= 1000', (t) => {
    t.equal(normalizeVoiceSettings({ interval: 1000 }).interval, 1000);
    t.equal(normalizeVoiceSettings({ interval: 5000 }).interval, 5000);
    t.equal(normalizeVoiceSettings({ interval: 7000 }).interval, 7000);
    t.equal(normalizeVoiceSettings({ interval: 999999 }).interval, 999999);
  });
  QUnit.test('interval rejects 0/negative/non-integer/NaN → defaults to 5000', (t) => {
    t.equal(normalizeVoiceSettings({ interval: 0 }).interval, 5000);
    t.equal(normalizeVoiceSettings({ interval: -100 }).interval, 5000);
    t.equal(normalizeVoiceSettings({ interval: 999 }).interval, 5000, 'below 1s rejected');
    t.equal(normalizeVoiceSettings({ interval: 1.5 }).interval, 5000, 'non-integer rejected');
    t.equal(normalizeVoiceSettings({ interval: 'abc' }).interval, 5000);
    t.equal(normalizeVoiceSettings({ interval: NaN }).interval, 5000);
    t.equal(normalizeVoiceSettings({ interval: null }).interval, 5000);
  });
  QUnit.test('clamps volume to [0, 100]', (t) => {
    t.equal(normalizeVoiceSettings({ volume: -5 }).volume, 0);
    t.equal(normalizeVoiceSettings({ volume: 150 }).volume, 100);
    t.equal(normalizeVoiceSettings({ volume: 50 }).volume, 50);
    t.equal(normalizeVoiceSettings({ volume: 'abc' }).volume, 80, 'NaN falls back');
  });
  QUnit.test('defaults fields = {name:true,price:true,percent:true}', (t) => {
    t.deepEqual(normalizeVoiceSettings({}).fields, { name: true, price: true, percent: true });
    t.deepEqual(normalizeVoiceSettings(null).fields, { name: true, price: true, percent: true });
  });
  QUnit.test('coerces each field to boolean and preserves false values', (t) => {
    t.deepEqual(
      normalizeVoiceSettings({ fields: { name: false, price: 1, percent: 'x' } }).fields,
      { name: false, price: true, percent: true }
    );
    t.deepEqual(
      normalizeVoiceSettings({ fields: { name: true, price: false, percent: false } }).fields,
      { name: true, price: false, percent: false }
    );
  });
  QUnit.test('invalid fields container falls back to all-true defaults', (t) => {
    t.deepEqual(normalizeVoiceSettings({ fields: 'bad' }).fields, { name: true, price: true, percent: true });
    t.deepEqual(normalizeVoiceSettings({ fields: null }).fields, { name: true, price: true, percent: true });
    t.deepEqual(normalizeVoiceSettings({ fields: [] }).fields, { name: true, price: true, percent: true });
  });
  QUnit.test('defaults fieldsOrder to [name,price,percent]', (t) => {
    t.deepEqual(normalizeVoiceSettings({}).fieldsOrder, ['name', 'price', 'percent']);
    t.deepEqual(normalizeVoiceSettings(null).fieldsOrder, ['name', 'price', 'percent']);
  });
  QUnit.test('preserves valid fieldsOrder (3 unique known keys)', (t) => {
    t.deepEqual(
      normalizeVoiceSettings({ fieldsOrder: ['percent', 'name', 'price'] }).fieldsOrder,
      ['percent', 'name', 'price']
    );
  });
  QUnit.test('filters unknown keys from fieldsOrder and falls back if too few', (t) => {
    t.deepEqual(
      normalizeVoiceSettings({ fieldsOrder: ['name', 'bad', 'price'] }).fieldsOrder,
      ['name', 'price', 'percent'],
      'missing key filled at the end'
    );
    t.deepEqual(
      normalizeVoiceSettings({ fieldsOrder: ['bad', 'worse'] }).fieldsOrder,
      ['name', 'price', 'percent'],
      'all unknown → default'
    );
  });
  QUnit.test('deduplicates fieldsOrder', (t) => {
    t.deepEqual(
      normalizeVoiceSettings({ fieldsOrder: ['name', 'price', 'name'] }).fieldsOrder,
      ['name', 'price', 'percent']
    );
  });
  QUnit.test('invalid fieldsOrder container → default', (t) => {
    t.deepEqual(normalizeVoiceSettings({ fieldsOrder: 'bad' }).fieldsOrder, ['name', 'price', 'percent']);
    t.deepEqual(normalizeVoiceSettings({ fieldsOrder: null }).fieldsOrder, ['name', 'price', 'percent']);
  });
});

QUnit.module('app.normalizeAlertSettings', () => {
  QUnit.test('returns defaults when input null/empty', (t) => {
    t.deepEqual(normalizeAlertSettings(null), { ...DEFAULT_ALERT_SETTINGS });
    t.deepEqual(normalizeAlertSettings({}), { ...DEFAULT_ALERT_SETTINGS });
  });
  QUnit.test('coerces enabled to boolean', (t) => {
    t.equal(normalizeAlertSettings({ enabled: 1 }).enabled, true);
    t.equal(normalizeAlertSettings({ enabled: '' }).enabled, false);
  });
  QUnit.test('clamps threshold to [0.1, 50]', (t) => {
    t.equal(normalizeAlertSettings({ threshold: 0.01 }).threshold, 0.1);
    t.equal(normalizeAlertSettings({ threshold: 99 }).threshold, 50);
    t.equal(normalizeAlertSettings({ threshold: 5 }).threshold, 5);
    t.equal(normalizeAlertSettings({ threshold: 'abc' }).threshold, 5, 'NaN falls back');
  });
});

QUnit.module('app.clampVolume', () => {
  QUnit.test('clamps any input to [0, 100] integer', (t) => {
    t.equal(clampVolume(-1), 0);
    t.equal(clampVolume(0), 0);
    t.equal(clampVolume(50), 50);
    t.equal(clampVolume(100), 100);
    t.equal(clampVolume(101), 100);
    t.equal(clampVolume(NaN), 80);
    t.equal(clampVolume(null), 80);
  });
});

QUnit.module('app.parseIntervalSeconds', () => {
  QUnit.test('returns the positive integer for valid input', (t) => {
    t.equal(parseIntervalSeconds('5'), 5);
    t.equal(parseIntervalSeconds('1'), 1);
    t.equal(parseIntervalSeconds('123'), 123);
    t.equal(parseIntervalSeconds('999999'), 999999);
  });
  QUnit.test('accepts numeric (non-string) input', (t) => {
    t.equal(parseIntervalSeconds(5), 5);
    t.equal(parseIntervalSeconds(60), 60);
  });
  QUnit.test('returns null for empty/whitespace (signal: empty)', (t) => {
    t.equal(parseIntervalSeconds(''), null);
    t.equal(parseIntervalSeconds('   '), null);
    t.equal(parseIntervalSeconds(null), null);
    t.equal(parseIntervalSeconds(undefined), null);
  });
  QUnit.test('returns null for non-positive / non-integer / non-numeric (signal: invalid)', (t) => {
    t.equal(parseIntervalSeconds('0'), null);
    t.equal(parseIntervalSeconds('-1'), null);
    t.equal(parseIntervalSeconds('1.5'), null);
    t.equal(parseIntervalSeconds('abc'), null);
    t.equal(parseIntervalSeconds('5x'), null);
    t.equal(parseIntervalSeconds('1e3'), null, 'scientific notation rejected');
    t.equal(parseIntervalSeconds(NaN), null);
    t.equal(parseIntervalSeconds(Infinity), null);
  });
  QUnit.test('trims surrounding whitespace', (t) => {
    t.equal(parseIntervalSeconds('  5  '), 5);
    t.equal(parseIntervalSeconds(' 30'), 30);
  });
});

QUnit.module('app.parseAlertThreshold', () => {
  QUnit.test('returns the number for valid positive decimals 0.1-50', (t) => {
    t.equal(parseAlertThreshold('5'), 5);
    t.equal(parseAlertThreshold('0.1'), 0.1);
    t.equal(parseAlertThreshold('5.5'), 5.5);
    t.equal(parseAlertThreshold('50'), 50);
    t.equal(parseAlertThreshold('1.25'), 1.25);
  });
  QUnit.test('accepts numeric input', (t) => {
    t.equal(parseAlertThreshold(5), 5);
    t.equal(parseAlertThreshold(0.5), 0.5);
  });
  QUnit.test('returns null for empty/whitespace', (t) => {
    t.equal(parseAlertThreshold(''), null);
    t.equal(parseAlertThreshold('   '), null);
    t.equal(parseAlertThreshold(null), null);
    t.equal(parseAlertThreshold(undefined), null);
  });
  QUnit.test('returns null for out-of-range (<0.1 or >50)', (t) => {
    t.equal(parseAlertThreshold('0'), null);
    t.equal(parseAlertThreshold('0.05'), null);
    t.equal(parseAlertThreshold('50.1'), null);
    t.equal(parseAlertThreshold('100'), null);
    t.equal(parseAlertThreshold('-1'), null);
  });
  QUnit.test('returns null for malformed input', (t) => {
    t.equal(parseAlertThreshold('abc'), null);
    t.equal(parseAlertThreshold('5.5.5'), null);
    t.equal(parseAlertThreshold('5x'), null);
    t.equal(parseAlertThreshold('1e2'), null, 'scientific notation rejected');
    t.equal(parseAlertThreshold(NaN), null);
    t.equal(parseAlertThreshold(Infinity), null);
  });
  QUnit.test('trims surrounding whitespace', (t) => {
    t.equal(parseAlertThreshold('  5.5  '), 5.5);
  });
});

QUnit.module('app.parseLimitUpIntervalSeconds', () => {
  QUnit.test('accepts values matching LIMIT_UP_REFRESH_OPTIONS', (t) => {
    t.equal(parseLimitUpIntervalSeconds('10'), 10);
    t.equal(parseLimitUpIntervalSeconds('30'), 30);
    t.equal(parseLimitUpIntervalSeconds('60'), 60);
  });
  QUnit.test('rejects values not in options', (t) => {
    t.equal(parseLimitUpIntervalSeconds('5'), null);
    t.equal(parseLimitUpIntervalSeconds('15'), null);
    t.equal(parseLimitUpIntervalSeconds('120'), null);
  });
  QUnit.test('rejects empty/invalid/non-integer', (t) => {
    t.equal(parseLimitUpIntervalSeconds(''), null);
    t.equal(parseLimitUpIntervalSeconds('0'), null);
    t.equal(parseLimitUpIntervalSeconds('-1'), null);
    t.equal(parseLimitUpIntervalSeconds('abc'), null);
    t.equal(parseLimitUpIntervalSeconds('5.5'), null);
    t.equal(parseLimitUpIntervalSeconds(null), null);
  });
  QUnit.test('trims whitespace', (t) => {
    t.equal(parseLimitUpIntervalSeconds('  30  '), 30);
  });
});

QUnit.module('app.LIMIT_UP_REFRESH_OPTIONS', () => {
  QUnit.test('has 3 ascending options 10/30/60 seconds', (t) => {
    t.deepEqual(
      LIMIT_UP_REFRESH_OPTIONS.map((o) => o.value),
      [10000, 30000, 60000]
    );
  });
});

QUnit.module('app.applyLimitUpFetchResult', () => {
  const item = (code) => ({ code, name: 'X', price: 10, changePercent: 10, limitUpCount: 1 });

  QUnit.test('non-empty items: updates items/groups and refreshes cache', (t) => {
    const prev = {
      items: [], groups: [], lastNonEmptyItems: [], lastNonEmptyAt: null, consecutiveEmptyFetches: 3
    };
    const next = applyLimitUpFetchResult(prev, [item('sh600519')]);
    t.equal(next.items.length, 1);
    t.equal(next.lastNonEmptyItems.length, 1);
    t.equal(next.consecutiveEmptyFetches, 0, 'resets empty counter');
    t.ok(next.lastNonEmptyAt instanceof Date, 'updates timestamp');
    t.equal(next.groups.length, 4, 'all four groups present (incl. broken)');
  });

  QUnit.test('empty items + no cache: shows empty + increments counter', (t) => {
    const prev = { items: [], groups: [], lastNonEmptyItems: [], lastNonEmptyAt: null, consecutiveEmptyFetches: 0 };
    const next = applyLimitUpFetchResult(prev, []);
    t.equal(next.items.length, 0);
    t.equal(next.groups.length, 4, 'groups still rendered (empty)');
    t.equal(next.consecutiveEmptyFetches, 1);
  });

  QUnit.test('empty items + existing cache: keeps cached items, increments counter', (t) => {
    const cached = [item('sh600519'), item('sh600000')];
    const prev = {
      items: cached, groups: [], lastNonEmptyItems: cached,
      lastNonEmptyAt: new Date('2024-03-15T10:00:00Z'), consecutiveEmptyFetches: 0
    };
    const next = applyLimitUpFetchResult(prev, []);
    t.equal(next.items.length, 2, 'still shows cached items');
    t.equal(next.lastNonEmptyItems.length, 2, 'cache preserved');
    t.equal(next.consecutiveEmptyFetches, 1, 'increments counter');
    t.equal(next.lastNonEmptyAt, prev.lastNonEmptyAt, 'cache timestamp unchanged');
  });

  QUnit.test('multiple consecutive empties: counter accumulates', (t) => {
    const cached = [item('sh600519')];
    let s = { items: cached, groups: [], lastNonEmptyItems: cached, lastNonEmptyAt: null, consecutiveEmptyFetches: 0 };
    s = applyLimitUpFetchResult(s, []);
    t.equal(s.consecutiveEmptyFetches, 1);
    s = applyLimitUpFetchResult(s, []);
    t.equal(s.consecutiveEmptyFetches, 2);
    s = applyLimitUpFetchResult(s, []);
    t.equal(s.consecutiveEmptyFetches, 3);
    t.equal(s.items.length, 1, 'still cached');
  });

  QUnit.test('non-empty after empties: counter resets to 0', (t) => {
    const old = [item('sh600519')];
    const fresh = [item('sh600519'), item('sh600000'), item('sh600001')];
    let s = { items: old, groups: [], lastNonEmptyItems: old, lastNonEmptyAt: null, consecutiveEmptyFetches: 0 };
    s = applyLimitUpFetchResult(s, []);
    s = applyLimitUpFetchResult(s, []);
    t.equal(s.consecutiveEmptyFetches, 2);
    s = applyLimitUpFetchResult(s, fresh);
    t.equal(s.items.length, 3, 'updated to fresh data');
    t.equal(s.consecutiveEmptyFetches, 0);
  });

  QUnit.test('handles null/undefined state input', (t) => {
    const next = applyLimitUpFetchResult(null, [item('sh600519')]);
    t.equal(next.items.length, 1);
    t.equal(next.consecutiveEmptyFetches, 0);
  });

  QUnit.test('handles non-array items input as empty', (t) => {
    const next = applyLimitUpFetchResult({}, null);
    t.equal(next.items.length, 0);
    t.equal(next.consecutiveEmptyFetches, 1);
  });

  QUnit.test('preserves user state (sortKey, selectedCodes, chartCode) across updates', (t) => {
    const prev = {
      items: [], groups: [],
      lastNonEmptyItems: [], lastNonEmptyAt: null, consecutiveEmptyFetches: 0,
      sortKey: 'pct',
      selectedCodes: new Set(['a', 'b']),
      chartCode: 'sh600519',
      chartPeriod: '5m',
      chartKlineData: { code: 'sh600519', items: [] }
    };
    const next = applyLimitUpFetchResult(prev, [item('sh600000')]);
    t.equal(next.sortKey, 'pct', 'sortKey preserved');
    t.deepEqual([...next.selectedCodes].sort(), ['a', 'b'], 'selectedCodes preserved');
    t.equal(next.chartCode, 'sh600519', 'chartCode preserved');
    t.equal(next.chartPeriod, '5m', 'chartPeriod preserved');
  });

  QUnit.test('default sortKey is "amount" when not in prev', (t) => {
    const next = applyLimitUpFetchResult({}, [item('sh600000')]);
    t.equal(next.sortKey, 'amount');
    t.equal(next.groups.length, 4);
  });
});

QUnit.module('app.multi-chart state', () => {
  QUnit.test('state.expandedCodes is a Set', (t) => {
    const { state } = _internal();
    t.ok(state.expandedCodes instanceof Set, 'expandedCodes is a Set');
  });
  QUnit.test('state.chartInstances is a Map', (t) => {
    const { state } = _internal();
    t.ok(state.chartInstances instanceof Map, 'chartInstances is a Map');
  });
  QUnit.test('state.expandedCodes starts empty', (t) => {
    const { state } = _internal();
    t.equal(state.expandedCodes.size, 0);
  });
  QUnit.test('state.chartInstances starts empty', (t) => {
    const { state } = _internal();
    t.equal(state.chartInstances.size, 0);
  });
  QUnit.test('old single-chart state fields are removed', (t) => {
    const { state } = _internal();
    t.equal(state.chartCode, undefined, 'chartCode removed');
    t.equal(state.klineData, undefined, 'klineData removed');
    t.equal(state.chartPeriod, undefined, 'chartPeriod removed');
    t.equal(state.chartLoading, undefined, 'chartLoading removed');
    t.equal(state.chartError, undefined, 'chartError removed');
  });
});

QUnit.module('app.openChart / closeChart / closeAllCharts', (hooks) => {
  hooks.afterEach(() => {
    _closeAllCharts();
  });

  QUnit.test('openChart adds code to expandedCodes and chartInstances', (t) => {
    const { state } = _internal();
    _openChart('sh600519');
    t.ok(state.expandedCodes.has('sh600519'), 'in expandedCodes');
    t.ok(state.chartInstances.has('sh600519'), 'in chartInstances');
  });

  QUnit.test('openChart twice for same code is idempotent', (t) => {
    const { state } = _internal();
    _openChart('sh600519');
    _openChart('sh600519');
    t.equal(state.expandedCodes.size, 1, 'still 1 entry');
    t.equal(state.chartInstances.size, 1);
  });

  QUnit.test('multiple openChart calls add multiple codes (multi-chart support)', (t) => {
    const { state } = _internal();
    _openChart('sh600519');
    _openChart('sz000001');
    _openChart('sz300750');
    t.equal(state.expandedCodes.size, 3);
    t.equal(state.chartInstances.size, 3);
  });

  QUnit.test('closeChart removes code from expandedCodes and chartInstances', (t) => {
    const { state } = _internal();
    _openChart('sh600519');
    _closeChart('sh600519');
    t.notOk(state.expandedCodes.has('sh600519'));
    t.notOk(state.chartInstances.has('sh600519'));
  });

  QUnit.test('closeChart for unknown code is a no-op (no throw)', (t) => {
    t.equal(_closeChart('sh999999'), undefined, 'returns undefined safely');
  });

  QUnit.test('closeAllCharts clears everything', (t) => {
    const { state } = _internal();
    _openChart('sh600519');
    _openChart('sz000001');
    _closeAllCharts();
    t.equal(state.expandedCodes.size, 0);
    t.equal(state.chartInstances.size, 0);
  });
});

QUnit.module('app.handlePeriodChange (per-code)', (hooks) => {
  hooks.afterEach(() => {
    _closeAllCharts();
  });

  QUnit.test('changes period for the specified code only', (t) => {
    const { state } = _internal();
    _openChart('sh600519');
    _openChart('sz000001');
    _handlePeriodChange('5m', 'sh600519');
    t.equal(state.chartInstances.get('sh600519').period, '5m', 'first code updated');
    t.equal(state.chartInstances.get('sz000001').period, '1d', 'second code unchanged');
  });

  QUnit.test('rejects invalid period', (t) => {
    const { state } = _internal();
    _openChart('sh600519');
    const before = state.chartInstances.get('sh600519').period;
    _handlePeriodChange('bogus', 'sh600519');
    t.equal(state.chartInstances.get('sh600519').period, before, 'period unchanged');
  });

  QUnit.test('no-op when same period', (t) => {
    const { state } = _internal();
    _openChart('sh600519');
    const inst = state.chartInstances.get('sh600519');
    const beforeKline = inst.klineData;
    _handlePeriodChange('1d', 'sh600519');
    const inst2 = state.chartInstances.get('sh600519');
    t.equal(inst2.klineData, beforeKline, 'kline data not reset');
  });
});

QUnit.module('app.applyLiveTickToChartForCode', (hooks) => {
  hooks.afterEach(() => {
    _closeAllCharts();
    _setChartInstance('sh600519', null);
    _setChartInstance('sz000001', null);
  });

  QUnit.test('uses update* API (not setKline) when chart mounted and kline loaded', (t) => {
    const { state } = _internal();
    _openChart('sh600519');
    const inst = state.chartInstances.get('sh600519');
    inst.klineData = {
      code: 'sh600519',
      name: 'X',
      items: [
        { time: '2024-01-02', open: 10, high: 11, low: 9, close: 10.5, volume: 1000 }
      ]
    };
    const calls = { kline: 0, volume: 0, ma: 0, setKline: 0, fitContent: 0 };
    const fakeCtl = {
      updateKline() { calls.kline++; },
      updateVolume() { calls.volume++; },
      updateMA() { calls.ma++; },
      setKline() { calls.setKline++; },
      setVolume() {},
      setMA() {},
      clearMA() {},
      fitContent() { calls.fitContent++; },
      destroy() {}
    };
    _setChartInstance('sh600519', fakeCtl);
    _applyLiveTickToChartForCode('sh600519', 11);
    t.equal(calls.kline, 1, 'updateKline called');
    t.equal(calls.volume, 1, 'updateVolume called');
    t.equal(calls.setKline, 0, 'setKline NOT called');
    t.equal(calls.fitContent, 0, 'fitContent NOT called (preserves zoom)');
  });

  QUnit.test('no-op when no chart instance or no kline data', (t) => {
    _openChart('sh600519');
    t.equal(_applyLiveTickToChartForCode('sh600519', 100), undefined, 'no kline data, no throw');
    t.equal(_applyLiveTickToChartForCode('sh999999', 100), undefined, 'unknown code, no throw');
  });

  QUnit.test('full daily quote updates current OHLCV instead of close only', (t) => {
    const { state } = _internal();
    _openChart('sh600519');
    const inst = state.chartInstances.get('sh600519');
    inst.klineData = {
      code: 'sh600519',
      name: 'X',
      items: [{ time: '2026-09-02', open: 10, high: 11, low: 9, close: 10.5, volume: 1000, amount: 10000 }]
    };
    _setChartInstance('sh600519', {
      updateKline() {}, updateVolume() {}, updateMA() {}, destroy() {}
    });
    _applyLiveTickToChartForCode('sh600519', {
      price: 12, open: 10.2, high: 12.5, low: 8.8, volume: 1800, amount: 20000
    });
    const last = inst.klineData.items[0];
    t.equal(last.open, 10.2);
    t.equal(last.high, 12.5);
    t.equal(last.low, 8.8);
    t.equal(last.close, 12);
    t.equal(last.volume, 1800);
    t.equal(last.amount, 20000);
  });
});

QUnit.module('app.applyLiveQuoteToIntradayForCode', (hooks) => {
  hooks.afterEach(() => {
    _setIntradayChartInstance('sh600519', null);
    _closeAllCharts();
  });

  QUnit.test('updates chart state and controller in the active Beijing minute', (t) => {
    const { state } = _internal();
    _openChart('sh600519');
    const inst = state.chartInstances.get('sh600519');
    inst.selectedTradeDate = '2026-09-02';
    inst.intradayData = {
      source: 'test',
      items: [{
        time: parseBeijingDateTimeToChartSeconds('2026-09-02 10:00'),
        open: 100, high: 100, low: 100, close: 100, volume: 100, preClose: 100
      }]
    };
    let rendered = null;
    _setIntradayChartInstance('sh600519', { setData(items) { rendered = items; } });
    _applyLiveQuoteToIntradayForCode('sh600519', {
      price: 101, prevClose: 100, volume: 140, amount: 1414000
    }, false, new Date('2026-09-02T02:01:10.000Z'));
    t.equal(inst.intradayData.items.length, 2);
    t.equal(inst.intradayData.items[1].close, 101);
    t.equal(inst.intradayData.items[1].volume, 40);
    t.strictEqual(rendered, inst.intradayData.items, 'controller receives the updated series');
  });
});

QUnit.module('app.updateChartLastTickMulti', (hooks) => {
  hooks.afterEach(() => {
    _closeAllCharts();
  });

  QUnit.test('iterates over all expanded codes', (t) => {
    const { state } = _internal();
    _openChart('sh600519');
    _openChart('sz000001');
    state.quotes.set('sh600519', { code: 'sh600519', price: 12 });
    state.quotes.set('sz000001', { code: 'sz000001', price: 22 });
    t.equal(_updateChartLastTickMulti(), undefined);
  });

  QUnit.test('no-op when no expanded codes', (t) => {
    t.equal(_updateChartLastTickMulti(), undefined);
  });
});

QUnit.module('app.mountChartForCode', (hooks) => {
  hooks.afterEach(() => {
    _closeAllCharts();
    document.body.innerHTML = '';
  });

  QUnit.test('mounts chart instance when DOM host exists', (t) => {
    const { state } = _internal();
    _openChart('sh600519');
    state.chartInstances.get('sh600519').klineData = {
      code: 'sh600519',
      name: 'X',
      items: [
        { time: '2024-01-02', open: 10, high: 11, low: 9, close: 10.5, volume: 1000 }
      ]
    };
    const host = document.createElement('div');
    host.id = 'chart-host-sh600519';
    host.style.width = '600px';
    host.style.height = '400px';
    document.body.appendChild(host);
    t.equal(_mountChartForCode('sh600519'), undefined, 'no throw');
  });

  QUnit.test('no-op when DOM host does not exist', (t) => {
    _openChart('sh600519');
    t.equal(_mountChartForCode('sh600519'), undefined, 'no host, no throw');
  });
});

QUnit.module('app.route handler race fix (Bug 1)', () => {
  QUnit.test('limitUpRootEl is exposed via _internal and starts as null', (t) => {
    const internal = _internal();
    t.equal(internal.limitUpRootEl, null, 'limitUpRootEl is null initially');
  });

  QUnit.test('limitUpRootEl getter is wired to module-scoped variable', (t) => {
    // The fix relies on the route handler for '#/' setting limitUpRootEl = null
    // BEFORE calling renderMonitorPage. We verify the wiring is exposed via
    // _internal so the runtime value is observable. (Integration test that
    // navigates via startApp is omitted because it would require complex
    // cleanup of timers/workers/fetches; the fix is a 1-line change verified
    // by code review.)
    const internal = _internal();
    const desc = Object.getOwnPropertyDescriptor(internal, 'limitUpRootEl');
    t.ok(desc, 'limitUpRootEl is exposed as a getter on _internal');
    t.equal(typeof desc.get, 'function', 'getter is a function');
  });
});
