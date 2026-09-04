import {
  PERIODS,
  PERIOD_LABELS,
  DEFAULT_PERIOD,
  isValidPeriod,
  buildKlineUrl,
  buildTencentKlineUrl,
  buildTencentYearKlineUrl,
  parseEastmoneyKline,
  parseTencentKline,
  parseTencentKlineAssignment,
  calcMA,
  formatVolumeBars,
  formatCandleColors,
  periodToKlt,
  getPriceLimit,
  classifyKlineBar,
  LIMIT_UP_COLOR,
  LIMIT_BROKEN_COLOR,
  isMinutePeriod,
  applyLiveTickToKline,
  applyLiveQuoteToKline,
  applyLiveQuoteToIntraday
} from '../src/js/kline.js';
import { parseBeijingDateTimeToChartSeconds } from '../src/js/time.js';

QUnit.module('kline.PERIODS / labels', () => {
  QUnit.test('PERIODS exposes 8 supported periods', (t) => {
    t.deepEqual(Object.keys(PERIODS), [
      '1m',
      '5m',
      '15m',
      '30m',
      '60m',
      '1d',
      '1w',
      '1M'
    ]);
  });
  QUnit.test('periodToKlt maps each period to Eastmoney klt code', (t) => {
    t.equal(periodToKlt('1m'), 1);
    t.equal(periodToKlt('5m'), 5);
    t.equal(periodToKlt('15m'), 15);
    t.equal(periodToKlt('30m'), 30);
    t.equal(periodToKlt('60m'), 60);
    t.equal(periodToKlt('1d'), 101);
    t.equal(periodToKlt('1w'), 102);
    t.equal(periodToKlt('1M'), 103);
  });
  QUnit.test('periodToKlt returns null for unknown', (t) => {
    t.equal(periodToKlt('bogus'), null);
    t.equal(periodToKlt(''), null);
    t.equal(periodToKlt(null), null);
  });
  QUnit.test('isValidPeriod accepts only registered periods', (t) => {
    t.true(isValidPeriod('1d'));
    t.true(isValidPeriod('1m'));
    t.false(isValidPeriod('2d'));
    t.false(isValidPeriod(''));
    t.false(isValidPeriod(null));
  });
  QUnit.test('PERIOD_LABELS has a Chinese label per period', (t) => {
    for (const k of Object.keys(PERIODS)) {
      t.ok(typeof PERIOD_LABELS[k] === 'string' && PERIOD_LABELS[k].length > 0, `${k} label`);
    }
  });
  QUnit.test('DEFAULT_PERIOD is daily K', (t) => {
    t.equal(DEFAULT_PERIOD, '1d');
  });
});

QUnit.module('kline.buildKlineUrl', () => {
  QUnit.test('sh code maps to market 1', (t) => {
    const url = buildKlineUrl('sh600519', { period: '1d' });
    t.ok(url.startsWith('/api/eastmoney-kline/qt/stock/kline/get?'), `prefix ok: ${url}`);
    t.ok(url.includes('secid=1.600519'), `secid: ${url}`);
    t.ok(url.includes('klt=101'), `klt: ${url}`);
    t.ok(url.includes('fqt=1'), `fqt: ${url}`);
    t.ok(url.includes('lmt=1000'), `lmt: ${url}`);
    t.ok(url.includes('fields1='), 'fields1');
    t.ok(url.includes('fields2='), 'fields2');
  });
  QUnit.test('sz code maps to market 0 (weekly K)', (t) => {
    const url = buildKlineUrl('sz000001', { period: '1w' });
    t.ok(url.includes('secid=0.000001'));
    t.ok(url.includes('klt=102'));
  });
  QUnit.test('bj code maps to market 0 (monthly K)', (t) => {
    const url = buildKlineUrl('bj830799', { period: '1M' });
    t.ok(url.includes('secid=0.830799'));
    t.ok(url.includes('klt=103'));
  });
  QUnit.test('default period is 1d when omitted', (t) => {
    const url = buildKlineUrl('sh600519');
    t.ok(url.includes('klt=101'));
  });
  QUnit.test('respects custom lmt and fqt', (t) => {
    const url = buildKlineUrl('sh600519', { period: '1d', lmt: 240, fqt: 0 });
    t.ok(url.includes('lmt=240'));
    t.ok(url.includes('fqt=0'));
  });
  QUnit.test('returns null for invalid code', (t) => {
    t.equal(buildKlineUrl('invalid'), null);
    t.equal(buildKlineUrl(''), null);
    t.equal(buildKlineUrl(null), null);
    t.equal(buildKlineUrl('nf2105'), null);
  });
  QUnit.test('returns null for invalid period', (t) => {
    t.equal(buildKlineUrl('sh600519', { period: 'bogus' }), null);
  });
});

QUnit.module('kline.parseEastmoneyKline', () => {
  const dailyJson = {
    rc: 0,
    data: {
      code: '600519',
      market: 1,
      name: '贵州茅台',
      klines: [
        '2024-03-13,1800.00,1820.00,1830.00,1795.00,10000,1820000000,1.94,1.11,20.00,0.50',
        '2024-03-14,1820.00,1810.00,1825.00,1805.00,8000,1452000000,1.10,-0.55,-10.00,0.40',
        '2024-03-15,1808.00,1850.00,1860.00,1800.00,12500,2310000000,3.31,2.21,40.00,0.62'
      ]
    }
  };

  QUnit.test('parses daily K to {code, name, items[]}', (t) => {
    const out = parseEastmoneyKline(dailyJson);
    t.equal(out.code, 'sh600519', 'normalized code with market prefix');
    t.equal(out.name, '贵州茅台');
    t.equal(out.items.length, 3);
  });
  QUnit.test('daily item keeps time as YYYY-MM-DD string', (t) => {
    const { items } = parseEastmoneyKline(dailyJson);
    t.equal(items[0].time, '2024-03-13');
    t.equal(items[2].time, '2024-03-15');
  });
  QUnit.test('item exposes open/high/low/close/volume/amount', (t) => {
    const { items } = parseEastmoneyKline(dailyJson);
    const it = items[2];
    t.equal(it.open, 1808.00);
    t.equal(it.close, 1850.00);
    t.equal(it.high, 1860.00);
    t.equal(it.low, 1800.00);
    t.equal(it.volume, 12500);
    t.equal(it.amount, 2310000000);
    t.equal(it.changePercent, 2.21);
  });
  QUnit.test('intraday minute time is UTC seconds number', (t) => {
    const json = {
      data: {
        code: '600519',
        market: 1,
        name: '贵州茅台',
        klines: ['2024-03-15 09:30,1808,1810,1812,1807,1000,1810000,0,0,0,0']
      }
    };
    const { items } = parseEastmoneyKline(json);
    t.equal(items.length, 1);
    t.equal(typeof items[0].time, 'number', 'minute time is number');
    t.ok(items[0].time > 1700000000, 'reasonable UNIX seconds');
  });
  QUnit.test('returns null when input is malformed', (t) => {
    t.equal(parseEastmoneyKline(null), null);
    t.equal(parseEastmoneyKline({}), null);
    t.equal(parseEastmoneyKline({ data: null }), null);
  });
  QUnit.test('returns empty items when klines missing or empty', (t) => {
    const out = parseEastmoneyKline({
      data: { code: '600519', market: 1, name: '茅台', klines: [] }
    });
    t.deepEqual(out.items, []);
    t.equal(out.code, 'sh600519');
  });
  QUnit.test('skips malformed kline rows silently', (t) => {
    const json = {
      data: {
        code: '600519',
        market: 1,
        name: '茅台',
        klines: [
          '2024-03-15,1808,1850,1860,1800,12500,2310000000,3.31,2.21,40.00,0.62',
          'garbage',
          '2024-03-16,not-a-number,oops'
        ]
      }
    };
    const out = parseEastmoneyKline(json);
    t.equal(out.items.length, 1);
  });
  QUnit.test('infers sz prefix when market=0', (t) => {
    const out = parseEastmoneyKline({
      data: { code: '000001', market: 0, name: '平安银行', klines: [] }
    });
    t.equal(out.code, 'sz000001');
  });
  QUnit.test('falls back to normalizeCode when market unknown', (t) => {
    const out = parseEastmoneyKline({
      data: { code: '600519', name: '茅台', klines: [] }
    });
    t.equal(out.code, 'sh600519');
  });
});

QUnit.module('kline.calcMA', () => {
  const sample = [
    { time: '2024-03-11', open: 10, high: 11, low: 9, close: 10, volume: 1 },
    { time: '2024-03-12', open: 10, high: 11, low: 9, close: 12, volume: 1 },
    { time: '2024-03-13', open: 10, high: 11, low: 9, close: 14, volume: 1 },
    { time: '2024-03-14', open: 10, high: 11, low: 9, close: 16, volume: 1 },
    { time: '2024-03-15', open: 10, high: 11, low: 9, close: 18, volume: 1 }
  ];

  QUnit.test('returns [] when n exceeds data length', (t) => {
    t.deepEqual(calcMA(sample, 10), []);
    t.deepEqual(calcMA([], 5), []);
  });
  QUnit.test('returns [] when n is non-positive or non-integer', (t) => {
    t.deepEqual(calcMA(sample, 0), []);
    t.deepEqual(calcMA(sample, -2), []);
    t.deepEqual(calcMA(sample, 1.5), []);
  });
  QUnit.test('MA(3) skips first 2 points and averages last 3 closes', (t) => {
    const ma = calcMA(sample, 3);
    t.equal(ma.length, 3, '5 - 3 + 1 points');
    t.equal(ma[0].time, '2024-03-13');
    t.equal(ma[0].value, 12, '(10+12+14)/3');
    t.equal(ma[1].time, '2024-03-14');
    t.equal(ma[1].value, 14);
    t.equal(ma[2].time, '2024-03-15');
    t.equal(ma[2].value, 16);
  });
  QUnit.test('rounds to 4 decimals for cleanliness', (t) => {
    const data = [
      { time: 't1', close: 1 },
      { time: 't2', close: 2 },
      { time: 't3', close: 4 }
    ];
    const ma = calcMA(data, 3);
    t.equal(ma[0].value, 2.3333);
  });
  QUnit.test('ignores items without finite close', (t) => {
    const data = [
      { time: 't1', close: 10 },
      { time: 't2', close: NaN },
      { time: 't3', close: 14 }
    ];
    const ma = calcMA(data, 3);
    t.deepEqual(ma, []);
  });
});

QUnit.module('kline.formatVolumeBars', () => {
  QUnit.test('maps each item to {time, value, color} with A-stock red-up/green-down', (t) => {
    const items = [
      { time: 't1', open: 100, close: 105, volume: 1000 },
      { time: 't2', open: 105, close: 102, volume: 800 },
      { time: 't3', open: 102, close: 102, volume: 500 }
    ];
    const bars = formatVolumeBars(items, { up: '#E74C3C', down: '#27AE60' });
    t.equal(bars.length, 3);
    t.equal(bars[0].time, 't1');
    t.equal(bars[0].value, 1000);
    t.equal(bars[0].color, '#E74C3C', 'up bar red');
    t.equal(bars[1].color, '#27AE60', 'down bar green');
    t.equal(bars[2].color, '#27AE60', 'flat treated as down for stable color');
  });
  QUnit.test('defaults colors when none supplied', (t) => {
    const bars = formatVolumeBars([
      { time: 't1', open: 100, close: 105, volume: 100 }
    ]);
    t.ok(typeof bars[0].color === 'string' && bars[0].color.startsWith('#'));
  });
  QUnit.test('returns [] for empty/invalid input', (t) => {
    t.deepEqual(formatVolumeBars([]), []);
    t.deepEqual(formatVolumeBars(null), []);
  });
});

QUnit.module('kline.buildTencentKlineUrl', () => {
  QUnit.test('day uses fqkline endpoint with qfq suffix', (t) => {
    const url = buildTencentKlineUrl('sh600519', { period: '1d', lmt: 320 });
    t.ok(url.startsWith('/api/qq-kline/appstock/app/fqkline/get?'), `got: ${url}`);
    t.ok(url.includes('param=sh600519,day,,,320,qfq'), `param: ${url}`);
  });
  QUnit.test('week and month map to week/month', (t) => {
    t.ok(buildTencentKlineUrl('sz000001', { period: '1w' }).includes('param=sz000001,week,,,'));
    t.ok(buildTencentKlineUrl('sz000001', { period: '1M' }).includes('param=sz000001,month,,,'));
  });
  QUnit.test('minute periods use mkline endpoint without qfq', (t) => {
    const m5 = buildTencentKlineUrl('sh600519', { period: '5m', lmt: 100 });
    t.ok(m5.startsWith('/api/qq-kline-min/appstock/app/kline/mkline?'), `got: ${m5}`);
    t.ok(m5.includes('param=sh600519,m5,,100'));
    t.ok(buildTencentKlineUrl('sh600519', { period: '1m' }).includes(',m1,,'));
    t.ok(buildTencentKlineUrl('sh600519', { period: '60m' }).includes(',m60,,'));
  });
  QUnit.test('default lmt is 320 when omitted', (t) => {
    t.ok(buildTencentKlineUrl('sh600519', { period: '1d' }).includes(',320,qfq'));
  });
  QUnit.test('lowercases code', (t) => {
    t.ok(buildTencentKlineUrl('SH600519', { period: '1d' }).includes('param=sh600519,'));
  });
  QUnit.test('rejects non-stock and invalid input', (t) => {
    t.equal(buildTencentKlineUrl('nf2105', { period: '1d' }), null);
    t.equal(buildTencentKlineUrl('invalid', { period: '1d' }), null);
    t.equal(buildTencentKlineUrl('', { period: '1d' }), null);
    t.equal(buildTencentKlineUrl(null), null);
  });
  QUnit.test('rejects unknown period', (t) => {
    t.equal(buildTencentKlineUrl('sh600519', { period: 'bogus' }), null);
  });
});

QUnit.module('kline Tencent modern daily endpoint', () => {
  QUnit.test('builds the documented year endpoint for all stock markets', (t) => {
    const url = buildTencentYearKlineUrl('BJ920001', 2026);
    t.ok(url.startsWith('https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get?'));
    t.ok(url.includes('_var=kline_dayqfq2026'));
    t.ok(url.includes('param=bj920001%2Cday%2C2025-01-01%2C2026-12-31%2C640%2Cqfq'));
    t.equal(buildTencentYearKlineUrl('invalid', 2026), null);
    t.equal(buildTencentYearKlineUrl('sh600519', 1989), null);
  });

  QUnit.test('parses JavaScript assignment response', (t) => {
    const text = 'kline_dayqfq2026={"code":0,"data":{"sh603533":{"qfqday":[["2026-09-02","24.85","24.15","25.80","24.15","850997.00"]]}}};';
    const out = parseTencentKlineAssignment(text, '1d');
    t.equal(out.code, 'sh603533');
    t.equal(out.items.length, 1);
    t.equal(out.items[0].close, 24.15);
    t.equal(parseTencentKlineAssignment('not-json', '1d'), null);
  });
});

QUnit.module('kline.parseTencentKline', () => {
  const dayJson = {
    code: 0,
    msg: '',
    data: {
      sz000001: {
        qfqday: [
          ['2026-05-29', '10.650', '10.930', '10.930', '10.620', '1399368.000'],
          ['2026-06-01', '10.900', '10.990', '10.990', '10.810', '954596.000']
        ],
        qt: {
          sz000001: ['51', '平安银行', '000001', '10.95']
        }
      }
    }
  };

  QUnit.test('parses day kline with qfqday key', (t) => {
    const out = parseTencentKline(dayJson, '1d');
    t.equal(out.code, 'sz000001');
    t.equal(out.name, '平安银行');
    t.equal(out.items.length, 2);
    t.equal(out.items[0].time, '2026-05-29');
    t.equal(out.items[0].open, 10.65);
    t.equal(out.items[0].close, 10.93);
    t.equal(out.items[0].high, 10.93);
    t.equal(out.items[0].low, 10.62);
    t.equal(out.items[0].volume, 1399368);
  });

  QUnit.test('falls back to non-qfq key (day) when qfqday missing (e.g. BJ)', (t) => {
    const bj = {
      code: 0,
      data: {
        bj830799: {
          day: [['2026-06-01', '34.28', '34.50', '35.00', '34.00', '1000']],
          qt: { bj830799: ['62', '艾融软件', '830799'] }
        }
      }
    };
    const out = parseTencentKline(bj, '1d');
    t.equal(out.code, 'bj830799');
    t.equal(out.items.length, 1);
    t.equal(out.items[0].close, 34.5);
  });

  QUnit.test('parses minute kline with mN key and YYYYMMDDHHMM time', (t) => {
    const min = {
      code: 0,
      data: {
        sh600519: {
          m5: [['202606041500', '1268.50', '1268.00', '1268.61', '1268.00', '1062.00']],
          qt: { sh600519: ['1', '贵州茅台', '600519'] }
        }
      }
    };
    const out = parseTencentKline(min, '5m');
    t.equal(out.items.length, 1);
    t.equal(typeof out.items[0].time, 'number');
    t.ok(out.items[0].time > 1700000000);
    t.equal(out.items[0].close, 1268);
  });

  QUnit.test('returns null for invalid input', (t) => {
    t.equal(parseTencentKline(null, '1d'), null);
    t.equal(parseTencentKline({}, '1d'), null);
    t.equal(parseTencentKline({ data: null }, '1d'), null);
    t.equal(parseTencentKline({ data: {} }, '1d'), null);
  });

  QUnit.test('returns empty items when no matching kline array', (t) => {
    const noArr = { data: { sh600519: { qt: { sh600519: ['1', '茅台'] } } } };
    const out = parseTencentKline(noArr, '1d');
    t.equal(out.code, 'sh600519');
    t.deepEqual(out.items, []);
  });

  QUnit.test('week period reads qfqweek', (t) => {
    const wkJson = {
      data: {
        sh600519: {
          qfqweek: [['2024-03-15', '1800', '1850', '1860', '1790', '50000']],
          qt: { sh600519: ['1', '贵州茅台'] }
        }
      }
    };
    const out = parseTencentKline(wkJson, '1w');
    t.equal(out.items.length, 1);
    t.equal(out.items[0].close, 1850);
  });

  QUnit.test('skips malformed rows silently', (t) => {
    const mixed = {
      data: {
        sh600519: {
          qfqday: [
            ['2024-03-15', '1800', '1850', '1860', '1790', '50000'],
            'garbage',
            ['only', 'three']
          ],
          qt: { sh600519: ['1', '茅台'] }
        }
      }
    };
    const out = parseTencentKline(mixed, '1d');
    t.equal(out.items.length, 1);
  });
});

QUnit.module('kline.getPriceLimit', () => {
  QUnit.test('main board (sh 60x / sz 00x) returns 10', (t) => {
    t.equal(getPriceLimit('sh600519', '贵州茅台'), 10);
    t.equal(getPriceLimit('sh601398', '工商银行'), 10);
    t.equal(getPriceLimit('sz000001', '平安银行'), 10);
    t.equal(getPriceLimit('sz000858', '五粮液'), 10);
  });
  QUnit.test('ChiNext (sz 30x) returns 20', (t) => {
    t.equal(getPriceLimit('sz300750', '宁德时代'), 20);
    t.equal(getPriceLimit('sz300059', '东方财富'), 20);
  });
  QUnit.test('STAR market (sh 688x and CDR 689x) returns 20', (t) => {
    t.equal(getPriceLimit('sh688981', '中芯国际'), 20);
    t.equal(getPriceLimit('sh688036', '传音控股'), 20);
    t.equal(getPriceLimit('sh689009', '九号公司-WD'), 20, 'CDR 689xxx has 20% limit');
  });
  QUnit.test('Beijing exchange (bj) returns 30', (t) => {
    t.equal(getPriceLimit('bj830799', '艾融软件'), 30);
    t.equal(getPriceLimit('bj872925', 'Some Co'), 30);
  });
  QUnit.test('Main board ST returns 5', (t) => {
    t.equal(getPriceLimit('sh600519', 'ST茅台'), 5);
    t.equal(getPriceLimit('sz000001', '*ST银行'), 5);
  });
  QUnit.test('ChiNext, STAR, and BSE ST stocks keep their board price limits (20% and 30%)', (t) => {
    t.equal(getPriceLimit('sz300750', 'ST宁德'), 20, 'ChiNext ST stock has 20% limit');
    t.equal(getPriceLimit('sh688981', '*ST中芯'), 20, 'STAR ST stock has 20% limit');
    t.equal(getPriceLimit('bj830799', 'ST艾融'), 30, 'BSE stock has 30% limit');
  });
  QUnit.test('ST detection case-insensitive for main board', (t) => {
    t.equal(getPriceLimit('sh600519', 'st 茅台'), 5);
    t.equal(getPriceLimit('sh600519', '*st 茅台'), 5);
  });
  QUnit.test('does NOT misclassify normal names starting with S', (t) => {
    t.equal(getPriceLimit('sh600519', 'SOHO中国'), 10);
    t.equal(getPriceLimit('sh600519', '圣农发展'), 10);
  });
  QUnit.test('defaults to 10 when name unknown', (t) => {
    t.equal(getPriceLimit('sh600519', null), 10);
    t.equal(getPriceLimit('sh600519', undefined), 10);
    t.equal(getPriceLimit('sh600519', ''), 10);
  });
  QUnit.test('falls back to 10 when code invalid', (t) => {
    t.equal(getPriceLimit(null, '茅台'), 10);
    t.equal(getPriceLimit('', '茅台'), 10);
  });
});

QUnit.module('kline.classifyKlineBar', () => {
  // Main board limit-up = +10%, threshold close 9.8, threshold high 9.1
  QUnit.test('main-board: close=high and gain >= limit - 0.2 → "limit-up"', (t) => {
    const bar = { time: 't', open: 100, high: 110, low: 100, close: 110 };
    t.equal(classifyKlineBar(bar, 100, 10), 'limit-up');
  });
  QUnit.test('main-board: high reached limit area but close < high → "limit-up-failed"', (t) => {
    const bar = { time: 't', open: 100, high: 110, low: 100, close: 105 };
    t.equal(classifyKlineBar(bar, 100, 10), 'limit-up-failed');
  });
  QUnit.test('ordinary bar (gain < threshold) → "normal"', (t) => {
    const bar = { time: 't', open: 100, high: 105, low: 99, close: 104 };
    t.equal(classifyKlineBar(bar, 100, 10), 'normal');
  });
  QUnit.test('ChiNext 20% limit recognised', (t) => {
    const up = { time: 't', open: 100, high: 120, low: 100, close: 120 };
    t.equal(classifyKlineBar(up, 100, 20), 'limit-up');
    const failed = { time: 't', open: 100, high: 120, low: 100, close: 115 };
    t.equal(classifyKlineBar(failed, 100, 20), 'limit-up-failed');
    const small = { time: 't', open: 100, high: 110, low: 100, close: 105 };
    t.equal(classifyKlineBar(small, 100, 20), 'normal');
  });
  QUnit.test('ST 5% limit recognised', (t) => {
    const up = { time: 't', open: 100, high: 105, low: 100, close: 105 };
    t.equal(classifyKlineBar(up, 100, 5), 'limit-up');
    const failed = { time: 't', open: 100, high: 105, low: 100, close: 102 };
    t.equal(classifyKlineBar(failed, 100, 5), 'limit-up-failed');
  });
  QUnit.test('returns "normal" when prevClose missing or invalid', (t) => {
    const bar = { time: 't', open: 100, high: 110, low: 100, close: 110 };
    t.equal(classifyKlineBar(bar, null, 10), 'normal');
    t.equal(classifyKlineBar(bar, 0, 10), 'normal');
    t.equal(classifyKlineBar(bar, NaN, 10), 'normal');
  });
  QUnit.test('returns "normal" when high gain just under threshold', (t) => {
    const bar = { time: 't', open: 100, high: 109, low: 100, close: 105 };
    t.equal(classifyKlineBar(bar, 100, 10), 'normal', 'high 9% < 9.1 threshold');
  });
});

QUnit.module('kline.formatCandleColors', () => {
  const items = [
    { time: '2024-03-13', open: 100, high: 102, low: 99, close: 100, volume: 1 },
    { time: '2024-03-14', open: 100, high: 110, low: 100, close: 110, volume: 2 },
    { time: '2024-03-15', open: 110, high: 121, low: 110, close: 115, volume: 3 }
  ];

  QUnit.test('returns array of same length with time/OHLC preserved', (t) => {
    const out = formatCandleColors(items, 'sh600519', '贵州茅台');
    t.equal(out.length, 3);
    t.equal(out[0].time, '2024-03-13');
    t.equal(out[2].close, 115);
  });
  QUnit.test('first bar has no prevClose → no override color', (t) => {
    const out = formatCandleColors(items, 'sh600519', '贵州茅台');
    t.equal(out[0].color, undefined);
    t.equal(out[0].borderColor, undefined);
  });
  QUnit.test('second bar gain +10 with close=high → limit-up (yellow)', (t) => {
    const out = formatCandleColors(items, 'sh600519', '贵州茅台');
    t.equal(out[1].color, LIMIT_UP_COLOR);
    t.equal(out[1].borderColor, LIMIT_UP_COLOR);
    t.equal(out[1].wickColor, LIMIT_UP_COLOR);
  });
  QUnit.test('third bar high +10 but close < high → limit-up-failed (purple)', (t) => {
    const out = formatCandleColors(items, 'sh600519', '贵州茅台');
    t.equal(out[2].color, LIMIT_BROKEN_COLOR);
    t.equal(out[2].borderColor, LIMIT_BROKEN_COLOR);
    t.equal(out[2].wickColor, LIMIT_BROKEN_COLOR);
  });
  QUnit.test('ChiNext 20% threshold takes effect', (t) => {
    const ck = [
      { time: 't0', open: 50, high: 51, low: 49, close: 50 },
      { time: 't1', open: 50, high: 60, low: 50, close: 60 }
    ];
    const out = formatCandleColors(ck, 'sz300750', '宁德时代');
    t.equal(out[1].color, LIMIT_UP_COLOR);
    // Same bar would be normal on main board (+20% triggers limit-up on 20% boards too)
    const out2 = formatCandleColors(ck, 'sh600519', '贵州茅台');
    t.equal(out2[1].color, LIMIT_UP_COLOR, '+20% on 10% board is also "limit-up" since exceeds threshold');
  });
  QUnit.test('ST 5% threshold takes effect (otherwise normal)', (t) => {
    const stBar = [
      { time: 't0', open: 100, high: 100, low: 99, close: 100 },
      { time: 't1', open: 100, high: 105, low: 100, close: 105 }
    ];
    const out = formatCandleColors(stBar, 'sh600000', 'ST 浦发');
    t.equal(out[1].color, LIMIT_UP_COLOR, '+5% on ST = limit-up');
    const out2 = formatCandleColors(stBar, 'sh600000', '浦发银行');
    t.equal(out2[1].color, undefined, '+5% on main board = normal');
  });
  QUnit.test('does not mutate input items', (t) => {
    const ck = JSON.parse(JSON.stringify(items));
    formatCandleColors(items, 'sh600519', '贵州茅台');
    t.deepEqual(items, ck, 'inputs unchanged');
  });
  QUnit.test('LIMIT_UP_COLOR is yellow-ish, LIMIT_BROKEN_COLOR is purple-ish', (t) => {
    t.ok(typeof LIMIT_UP_COLOR === 'string' && LIMIT_UP_COLOR.startsWith('#'));
    t.ok(typeof LIMIT_BROKEN_COLOR === 'string' && LIMIT_BROKEN_COLOR.startsWith('#'));
    t.notEqual(LIMIT_UP_COLOR, LIMIT_BROKEN_COLOR);
  });
  QUnit.test('returns [] for empty/invalid input', (t) => {
    t.deepEqual(formatCandleColors([], 'sh600519', '茅台'), []);
    t.deepEqual(formatCandleColors(null, 'sh600519', '茅台'), []);
  });
});

QUnit.module('kline.isMinutePeriod', () => {
  QUnit.test('identifies minute periods (1m, 5m, 15m, 30m, 60m)', (t) => {
    t.true(isMinutePeriod('1m'));
    t.true(isMinutePeriod('5m'));
    t.true(isMinutePeriod('15m'));
    t.true(isMinutePeriod('30m'));
    t.true(isMinutePeriod('60m'));
  });
  QUnit.test('rejects non-minute periods', (t) => {
    t.false(isMinutePeriod('1d'));
    t.false(isMinutePeriod('1w'));
    t.false(isMinutePeriod('1M'));
    t.false(isMinutePeriod('m0'));
    t.false(isMinutePeriod('m1'));
    t.false(isMinutePeriod('5m1'));
    t.false(isMinutePeriod(null));
    t.false(isMinutePeriod(undefined));
    t.false(isMinutePeriod(''));
  });
});

QUnit.module('kline.applyLiveTickToKline', () => {
  const dayItem = { time: 1700000000, open: 100, close: 100, high: 102, low: 99, volume: 1000 };
  const m5Item = { time: 1700000000, open: 100, close: 100, high: 101, low: 99.5, volume: 500 };
  const items = [dayItem, m5Item, { time: 1700000060, open: 100, close: 100, high: 102, low: 99, volume: 2000 }];

  QUnit.test('returns input unchanged for empty/invalid', (t) => {
    t.deepEqual(applyLiveTickToKline([], 100, '1d'), []);
    t.deepEqual(applyLiveTickToKline(null, 100, '1d'), null);
    t.deepEqual(applyLiveTickToKline(items, NaN, '1d'), items);
    t.deepEqual(applyLiveTickToKline(items, 0, '1d'), items);
    t.deepEqual(applyLiveTickToKline(items, -5, '1d'), items);
    t.deepEqual(applyLiveTickToKline(items, 100, '1d'), items, 'returns original reference when invalid');
  });

  QUnit.test('day/week/month period: only updates close on last item', (t) => {
    const out = applyLiveTickToKline(items, 105, '1d');
    t.equal(out.length, items.length);
    const last = out[out.length - 1];
    t.equal(last.close, 105);
    t.equal(last.high, 102, 'high unchanged');
    t.equal(last.low, 99, 'low unchanged');
    t.equal(last.open, 100, 'open unchanged');
    t.equal(last.volume, 2000, 'volume unchanged');
    t.equal(last.time, 1700000060, 'time unchanged');
    // immutability
    t.notStrictEqual(out, items);
    t.notStrictEqual(out[out.length - 1], items[items.length - 1]);
    t.deepEqual(out[0], items[0], 'non-last items untouched');
  });

  QUnit.test('minute period (1m): updates close + expands high/low to encompass price', (t) => {
    const out = applyLiveTickToKline(items, 103, '1m');
    const last = out[out.length - 1];
    t.equal(last.close, 103);
    t.equal(last.high, 103, 'high expanded to include 103');
    t.equal(last.low, 99, 'low unchanged (99 < 103)');
  });

  QUnit.test('minute period: low expands when price drops below last low', (t) => {
    const out = applyLiveTickToKline(items, 95, '5m');
    const last = out[out.length - 1];
    t.equal(last.close, 95);
    t.equal(last.high, 102, 'high unchanged (102 > 95)');
    t.equal(last.low, 95, 'low expanded to include 95');
  });

  QUnit.test('minute period: high stays when price between open and existing high', (t) => {
    const out = applyLiveTickToKline(items, 100.5, '15m');
    const last = out[out.length - 1];
    t.equal(last.close, 100.5);
    t.equal(last.high, 102, 'high unchanged');
    t.equal(last.low, 99, 'low unchanged');
  });

  QUnit.test('week period: same as day - only close', (t) => {
    const out = applyLiveTickToKline(items, 200, '1w');
    const last = out[out.length - 1];
    t.equal(last.close, 200);
    t.equal(last.high, 102);
    t.equal(last.low, 99);
  });

  QUnit.test('month period: same as day - only close', (t) => {
    const out = applyLiveTickToKline(items, 1, '1M');
    const last = out[out.length - 1];
    t.equal(last.close, 1);
    t.equal(last.high, 102, 'high not affected by low price');
    t.equal(last.low, 99, 'low not affected by low price');
  });

  QUnit.test('handles missing high/low on last item (minute period)', (t) => {
    const broken = [{ time: 1, open: 50, close: 50, volume: 0 }];
    const out = applyLiveTickToKline(broken, 55, '5m');
    const last = out[0];
    t.equal(last.close, 55);
    t.equal(last.high, 55, 'high derived from price when missing');
    t.equal(last.low, 55, 'low derived from price when missing');
  });
});

QUnit.module('kline.applyLiveQuoteToKline', () => {
  QUnit.test('daily quote updates the complete current OHLCV bar', (t) => {
    const items = [{
      time: '2026-09-02', open: 100, high: 103, low: 98, close: 101, volume: 1000, amount: 100000
    }];
    const out = applyLiveQuoteToKline(items, {
      price: 104, open: 99, high: 105, low: 97, volume: 1800, amount: 180000
    }, '1d');
    t.deepEqual(out[0], {
      time: '2026-09-02', open: 99, high: 105, low: 97, close: 104, volume: 1800, amount: 180000
    });
    t.notStrictEqual(out, items, 'returns immutable replacement');
  });

  QUnit.test('weekly quote expands price range without corrupting aggregated volume', (t) => {
    const items = [{ time: '2026-09-02', open: 100, high: 103, low: 98, close: 101, volume: 9000 }];
    const out = applyLiveQuoteToKline(items, {
      price: 97, high: 104, low: 96, volume: 1800
    }, '1w');
    t.equal(out[0].close, 97);
    t.equal(out[0].high, 104);
    t.equal(out[0].low, 96);
    t.equal(out[0].volume, 9000, 'daily cumulative volume must not replace weekly aggregate');
  });

  QUnit.test('appends a new daily bar when quote date is later than last bar date', (t) => {
    const items = [
      { time: '2026-09-02', open: 100, high: 103, low: 98, close: 101, volume: 1000, amount: 100000 },
      { time: '2026-09-03', open: 101, high: 104, low: 100, close: 102, volume: 1100, amount: 110000 }
    ];
    // Quote with date: '2026-09-04'
    const out = applyLiveQuoteToKline(items, {
      date: '2026-09-04',
      price: 105,
      open: 103,
      high: 106,
      low: 102.5,
      volume: 1500,
      amount: 150000,
      changePercent: 2.94
    }, '1d');

    t.equal(out.length, 3, 'appends 1 bar');
    t.equal(out[1].close, 102, 'previous bar untouched');
    t.deepEqual(out[2], {
      time: '2026-09-04',
      open: 103,
      high: 106,
      low: 102.5,
      close: 105,
      volume: 1500,
      amount: 150000,
      changePercent: 2.94
    });
  });

  QUnit.test('recognizes quoteDate YYYYMMDD and tradingDay YYYY-MM-DD', (t) => {
    const items = [{ time: '2026-09-03', open: 10, high: 11, low: 9, close: 10, volume: 100 }];
    const tencentQuote = {
      quoteDate: '20260904',
      price: 10.5,
      open: 10.1,
      high: 10.8,
      low: 10.0,
      volume: 50,
      amount: 500
    };
    const out1 = applyLiveQuoteToKline(items, tencentQuote, '1d');
    t.equal(out1.length, 2);
    t.equal(out1[1].time, '2026-09-04');
    t.equal(out1[1].close, 10.5);

    const futureQuote = {
      tradingDay: '2026-09-04',
      price: 3500,
      open: 3480,
      high: 3520,
      low: 3470,
      volume: 20000,
      amount: 0
    };
    const out2 = applyLiveQuoteToKline(items, futureQuote, '1d');
    t.equal(out2.length, 2);
    t.equal(out2[1].time, '2026-09-04');
    t.equal(out2[1].close, 3500);
  });

  QUnit.test('updates existing bar in-place when quote date matches last bar date', (t) => {
    const items = [
      { time: '2026-09-03', open: 101, high: 104, low: 100, close: 102, volume: 1100, amount: 110000 },
      { time: '2026-09-04', open: 103, high: 105, low: 102, close: 104, volume: 500, amount: 50000 }
    ];
    const out = applyLiveQuoteToKline(items, {
      date: '2026-09-04',
      price: 106,
      high: 107,
      low: 102,
      volume: 800,
      amount: 80000
    }, '1d');

    t.equal(out.length, 2, 'does not append duplicate bar');
    t.equal(out[1].close, 106);
    t.equal(out[1].high, 107);
    t.equal(out[1].volume, 800);
  });
});

QUnit.module('kline.applyLiveQuoteToIntraday', () => {
  const firstTime = parseBeijingDateTimeToChartSeconds('2026-09-02 10:00');
  const base = [{
    time: firstTime,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 100,
    avgPrice: 100,
    preClose: 100,
    percent: 0
  }];

  QUnit.test('updates the current minute with price, volume, average, and percent', (t) => {
    const now = new Date('2026-09-02T02:00:30.000Z');
    const out = applyLiveQuoteToIntraday(base, {
      price: 102,
      prevClose: 100,
      volume: 150,
      amount: 1515000
    }, now);
    t.equal(out.length, 1);
    t.equal(out[0].close, 102);
    t.equal(out[0].high, 102);
    t.equal(out[0].low, 99);
    t.equal(out[0].volume, 150);
    t.equal(out[0].avgPrice, 101);
    t.ok(Math.abs(out[0].percent - 2) < 1e-9);
  });

  QUnit.test('appends a new point when the Beijing minute advances', (t) => {
    const now = new Date('2026-09-02T02:01:10.000Z');
    const out = applyLiveQuoteToIntraday(base, {
      price: 101,
      prevClose: 100,
      volume: 140,
      amount: 1414000
    }, now);
    t.equal(out.length, 2);
    t.equal(out[1].time, parseBeijingDateTimeToChartSeconds('2026-09-02 10:01'));
    t.equal(out[1].volume, 40, 'new minute gets the cumulative-volume delta');
    t.equal(out[1].close, 101);
  });

  QUnit.test('does not append outside continuous trading', (t) => {
    const lunch = new Date('2026-09-02T04:00:00.000Z');
    t.strictEqual(applyLiveQuoteToIntraday(base, { price: 103 }, lunch), base);
  });

  QUnit.test('appends point during futures night trading (21:30) and morning trading (09:10)', (t) => {
    // 21:30 Beijing time on 2026-09-02 is 13:30 UTC
    const night = new Date('2026-09-02T13:30:00.000Z');
    const stockOut = applyLiveQuoteToIntraday(base, { price: 103, code: 'sh600519' }, night);
    t.strictEqual(stockOut, base, 'stock quote is blocked during night');

    const futureOut = applyLiveQuoteToIntraday(base, {
      code: 'rb0',
      type: 'future',
      price: 3150,
      prevSettlement: 3140,
      volume: 200,
      amount: 0
    }, night);
    t.equal(futureOut.length, 2, 'future quote is accepted during night session');
    t.equal(futureOut[1].close, 3150);

    // 09:10 Beijing time on 2026-09-02 is 01:10 UTC
    const morning = new Date('2026-09-02T01:10:00.000Z');
    const morningBase = [{
      time: parseBeijingDateTimeToChartSeconds('2026-09-02 09:05'),
      open: 3140,
      high: 3145,
      low: 3138,
      close: 3140,
      volume: 100,
      avgPrice: 3140,
      preClose: 3140,
      percent: 0
    }];
    const futureMorningOut = applyLiveQuoteToIntraday(morningBase, {
      code: 'rb0',
      type: 'future',
      price: 3160,
      prevSettlement: 3140,
      volume: 250,
      amount: 0
    }, morning);
    t.equal(futureMorningOut.length, 2, 'future quote is accepted during 09:00-09:30 morning session');
    t.equal(futureMorningOut[1].close, 3160);
  });
});
