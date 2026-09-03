import {
  normalizeCode,
  inferMarket,
  parseTencent,
  parseEastmoney,
  parseSinaFuture
} from '../src/js/parser.js';

QUnit.module('parser.normalizeCode', () => {
  QUnit.test('adds sh prefix for 6/5-prefix codes', (t) => {
    t.equal(normalizeCode('600519'), 'sh600519');
    t.equal(normalizeCode('601398'), 'sh601398');
    t.equal(normalizeCode('510300'), 'sh510300');
  });
  QUnit.test('adds sz prefix for 0/3-prefix codes', (t) => {
    t.equal(normalizeCode('000001'), 'sz000001');
    t.equal(normalizeCode('300750'), 'sz300750');
    t.equal(normalizeCode('002594'), 'sz002594');
  });
  QUnit.test('adds bj prefix for 8/4/9-prefix codes', (t) => {
    t.equal(normalizeCode('830799'), 'bj830799');
    t.equal(normalizeCode('872925'), 'bj872925');
    t.equal(normalizeCode('430564'), 'bj430564');
    t.equal(normalizeCode('920002'), 'bj920002');
  });
  QUnit.test('keeps existing valid prefix unchanged', (t) => {
    t.equal(normalizeCode('sh600519'), 'sh600519');
    t.equal(normalizeCode('sz000001'), 'sz000001');
    t.equal(normalizeCode('bj830799'), 'bj830799');
  });
  QUnit.test('lowercases prefix and trims whitespace', (t) => {
    t.equal(normalizeCode('SH600519'), 'sh600519');
    t.equal(normalizeCode('  600519  '), 'sh600519');
    t.equal(normalizeCode('Sz000001'), 'sz000001');
  });
  QUnit.test('returns null for invalid inputs', (t) => {
    t.equal(normalizeCode(''), null);
    t.equal(normalizeCode('abc'), null);
    t.equal(normalizeCode('12345'), null);
    t.equal(normalizeCode(null), null);
    t.equal(normalizeCode(undefined), null);
  });
});

QUnit.module('parser.inferMarket', () => {
  QUnit.test('returns market for code', (t) => {
    t.equal(inferMarket('sh600519'), 'sh');
    t.equal(inferMarket('sz000001'), 'sz');
    t.equal(inferMarket('bj830799'), 'bj');
  });
  QUnit.test('returns null for invalid', (t) => {
    t.equal(inferMarket(''), null);
    t.equal(inferMarket('xx123456'), null);
  });
});

QUnit.module('parser.parseTencent', () => {
  const moutaiQuote =
    'v_sh600519="1~贵州茅台~600519~1850.00~1807.50~1808.00~12500~6230~6270~1849.99~6230~1849.98~5430~1849.97~3200~1849.96~3120~1849.95~4500~1850.00~3210~1850.01~5630~1850.02~3200~1850.03~3120~1850.04~4500~~20240315150100~42.50~2.35~1860.00~1800.00~1850.00/12500/2310000000~12500~231000~0.00~21.45~~1860.00~1800.00~2.27~22451.66~22451.66~0.00~0~0~~~~~~0.00~0.00~0~~GP-A~85.42~12.86~1.69~6.71~~~828.71~9.86~62.31~~~~3060340000~1255830600~~~37~~~1.85~0~5430~33~~~~~";';

  QUnit.test('parses single quote string', (t) => {
    const list = parseTencent(moutaiQuote);
    t.equal(list.length, 1, '1 quote parsed');
    const q = list[0];
    t.equal(q.code, 'sh600519', 'code');
    t.equal(q.name, '贵州茅台', 'name');
    t.equal(q.price, 1850.00, 'price');
    t.equal(q.prevClose, 1807.50, 'prevClose');
    t.equal(q.open, 1808.00, 'open');
    t.equal(q.volume, 12500, 'volume (in 手)');
    t.equal(q.change, 42.50, 'change');
    t.equal(q.changePercent, 2.35, 'changePercent');
    t.equal(q.high, 1860.00, 'high');
    t.equal(q.low, 1800.00, 'low');
    t.equal(q.updateTime, '20240315150100', 'update timestamp');
    t.equal(q.quoteDate, '20240315', 'quote date');
    t.equal(q.marketStatus, '', 'raw Tencent market status field is exposed');
    t.equal(q.type, 'stock', 'type');
  });

  QUnit.test('parses multiple quotes separated by semicolons', (t) => {
    const multi =
      moutaiQuote +
      '\nv_sz000001="51~平安银行~000001~12.50~12.30~12.40~50000~~~~~~~~~~~~~~~~~~~~~~~~20240315150100~0.20~1.63~12.55~12.35~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~";';
    const list = parseTencent(multi);
    t.equal(list.length, 2, '2 quotes');
    t.equal(list[0].code, 'sh600519');
    t.equal(list[1].code, 'sz000001');
    t.equal(list[1].name, '平安银行');
    t.equal(list[1].price, 12.50);
  });

  QUnit.test('returns empty array for malformed input', (t) => {
    t.deepEqual(parseTencent(''), []);
    t.deepEqual(parseTencent('not a quote'), []);
    t.deepEqual(parseTencent('v_sh600519="";'), []);
  });

  QUnit.test('skips entries with insufficient fields', (t) => {
    const bad = 'v_sh600519="1~name~600519";';
    t.deepEqual(parseTencent(bad), []);
  });
});

QUnit.module('parser.parseEastmoney', () => {
  const moutai = {
    rc: 0,
    rt: 4,
    data: {
      f43: 185000,
      f44: 186000,
      f45: 180000,
      f46: 180800,
      f47: 12500,
      f48: 2310000000,
      f57: '600519',
      f58: '贵州茅台',
      f60: 180750,
      f169: 4250,
      f170: 235
    }
  };

  QUnit.test('parses Eastmoney JSON to quote object', (t) => {
    const q = parseEastmoney(moutai);
    t.equal(q.code, 'sh600519');
    t.equal(q.name, '贵州茅台');
    t.equal(q.price, 1850.00);
    t.equal(q.high, 1860.00);
    t.equal(q.low, 1800.00);
    t.equal(q.open, 1808.00);
    t.equal(q.prevClose, 1807.50);
    t.equal(q.change, 42.50);
    t.equal(q.changePercent, 2.35);
    t.equal(q.volume, 12500);
    t.equal(q.type, 'stock');
  });

  QUnit.test('returns null when data missing', (t) => {
    t.equal(parseEastmoney(null), null);
    t.equal(parseEastmoney({}), null);
    t.equal(parseEastmoney({ data: null }), null);
    t.equal(parseEastmoney({ data: {} }), null);
  });

  QUnit.test('infers market prefix when secid available', (t) => {
    const q = parseEastmoney({ data: { ...moutai.data, f57: '000001' } });
    t.equal(q.code, 'sz000001');
  });

  QUnit.test('handles missing optional fields gracefully', (t) => {
    const q = parseEastmoney({
      data: { f43: 185000, f57: '600519', f58: '贵州茅台', f60: 180750 }
    });
    t.equal(q.price, 1850.00);
    t.equal(q.change, 42.50, 'computes change from price - prevClose');
    t.ok(Math.abs(q.changePercent - 2.35) < 0.01, 'computes changePercent');
  });
});

QUnit.module('parser.parseSinaFuture', () => {
  const rb =
    'var hq_str_nf2105="螺纹2105,150000,5180.00,5220.00,5180.00,5160.00,5200.00,5200.00,5200.00,5200.00,5210.00,5,10,1000000,12500,1000,2,2024-03-15,RB,";';

  QUnit.test('parses Sina future quote', (t) => {
    const list = parseSinaFuture(rb);
    t.equal(list.length, 1);
    const q = list[0];
    t.equal(q.code, 'nf2105');
    t.equal(q.name, '螺纹2105');
    t.equal(q.price, 5200.00);
    t.equal(q.open, 5180.00);
    t.equal(q.high, 5220.00);
    t.equal(q.low, 5180.00);
    t.equal(q.prevClose, 5160.00);
    t.equal(q.type, 'future');
    t.equal(q.change, 40.00, 'change = price - prevClose');
    t.ok(Math.abs(q.changePercent - 0.7752) < 0.01, 'change percent');
  });

  QUnit.test('returns empty array for malformed input', (t) => {
    t.deepEqual(parseSinaFuture(''), []);
    t.deepEqual(parseSinaFuture('garbage'), []);
    t.deepEqual(parseSinaFuture('var hq_str_nf2105="";'), []);
  });
});
