import {
  parseBeijingDateTimeToChartSeconds,
  parseTencentMinuteToChartSeconds,
  chartSecondsToDate,
  chartSecondsToTime,
  chartTimeToDate,
  getBeijingClockParts,
  getBeijingDate,
  shiftCalendarDate
} from '../src/js/time.js';

QUnit.module('time Beijing chart seconds', () => {
  QUnit.test('parses Eastmoney minute time as Beijing wall-clock chart time', (t) => {
    const ts = parseBeijingDateTimeToChartSeconds('2026-06-05 09:30');
    t.equal(chartSecondsToDate(ts), '2026-06-05');
    t.equal(chartSecondsToTime(ts), '09:30');
  });

  QUnit.test('parses Tencent compact minute time as Beijing wall-clock chart time', (t) => {
    const ts = parseTencentMinuteToChartSeconds('202606051500');
    t.equal(chartSecondsToDate(ts), '2026-06-05');
    t.equal(chartSecondsToTime(ts), '15:00');
  });

  QUnit.test('chartTimeToDate handles both business-day strings and minute timestamps', (t) => {
    const ts = parseBeijingDateTimeToChartSeconds('2026-06-05 13:01');
    t.equal(chartTimeToDate('2026-06-05'), '2026-06-05');
    t.equal(chartTimeToDate(ts), '2026-06-05');
  });

  QUnit.test('shiftCalendarDate crosses weekends without timezone drift', (t) => {
    t.equal(shiftCalendarDate('2026-06-05', 1), '2026-06-06');
    t.equal(shiftCalendarDate('2026-06-01', -1), '2026-05-31');
  });

  QUnit.test('Beijing date stays correct when host timezone is on the previous day', (t) => {
    const instant = new Date('2026-06-01T16:30:00.000Z');
    t.equal(getBeijingDate(instant), '2026-06-02');
    const parts = getBeijingClockParts(instant);
    t.equal(parts.hour, 0);
    t.equal(parts.minute, 30);
  });
});
