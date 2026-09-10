import { parseTencentMinute } from '../src/js/api.js';

// 真实样本：2026-09-10 盘中 贵州茅台 sh600519（minute/query）
const REAL_SAMPLE = {
  code: 0,
  msg: '',
  data: {
    sh600519: {
      qt: {
        sh600519: Array.from({ length: 50 }, (_, i) => (i === 1 ? '贵州茅台' : i === 4 ? '1290.88' : '0'))
      },
      data: {
        date: '20260910',
        data: [
          '0930 1291.00 90 11619000.00',
          '0931 1293.60 427 55211205.00',
          '0932 1287.00 1079 139320583.00'
        ]
      }
    }
  }
};

QUnit.module('parseTencentMinute', () => {
  QUnit.test('真实样本：时间/价格/分钟量差分/累计额均价', (assert) => {
    const parsed = parseTencentMinute(REAL_SAMPLE, { code: 'sh600519', date: '2026-09-10' });
    assert.ok(parsed, '样本可解析');
    assert.equal(parsed.source, 'tencent-minute');
    assert.equal(parsed.name, '贵州茅台');
    assert.equal(parsed.preClose, 1290.88);
    assert.equal(parsed.items.length, 3);

    const [first, second, third] = parsed.items;
    // 第一根包含集合竞价量：cumVol=90 → 分钟量 90
    assert.equal(first.volume, 90);
    assert.equal(first.price, 1291);
    assert.ok(Math.abs(first.avgPrice - 11619000 / (90 * 100)) < 0.01, '均价=累计额/(累计量*100)');

    // 第二根分钟量 = 427 - 90 = 337
    assert.equal(second.volume, 337);
    assert.equal(third.volume, 1079 - 427);
    assert.equal(third.amount, 139320583 - 55211205);

    // 涨跌幅基于昨收
    const expectedPct = (1293.6 / 1290.88 - 1) * 100;
    assert.ok(Math.abs(second.percent - expectedPct) < 1e-9);
  });

  QUnit.test('日期不匹配返回 null（防止把今天的数当历史日期）', (assert) => {
    const parsed = parseTencentMinute(REAL_SAMPLE, { code: 'sh600519', date: '2026-09-09' });
    assert.equal(parsed, null);
  });

  QUnit.test('缺少代码或结构异常返回 null', (assert) => {
    assert.equal(parseTencentMinute({}, { code: 'sh600519' }), null);
    assert.equal(parseTencentMinute(REAL_SAMPLE, { code: '' }), null);
    const badDate = JSON.parse(JSON.stringify(REAL_SAMPLE));
    badDate.data.sh600519.data.date = 'x';
    assert.equal(parseTencentMinute(badDate, { code: 'sh600519' }), null);
  });
});
