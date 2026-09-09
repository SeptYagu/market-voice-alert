import { getFuturesSession } from '../src/js/futures/session.js';
import { getFuturesSession as backend } from '../server/futures/futuresSessionService.js';

QUnit.module('Shared session boundary contract', () => {
  QUnit.test('all metadata close times stop at the boundary, with frontend/backend parity', assert => {
    const dates = ['2026-09-08', '2026-09-09', '2026-09-10'];
    for (const [code, end] of [['RB0', '2026-09-09T23:00:00+08:00'], ['CU0', '2026-09-10T01:00:00+08:00'],
      ['AU0', '2026-09-10T02:30:00+08:00'], ['T0', '2026-09-09T15:15:00+08:00'], ['IF0', '2026-09-09T15:00:00+08:00']]) {
      for (const delta of [-60000, 0, 60000]) {
        const now = new Date(Date.parse(end) + delta);
        const result = getFuturesSession(code, now, dates);
        assert.equal(result.isTrading, delta < 0, `${code} offset ${delta}`);
        assert.deepEqual(result, backend(code, now, dates));
      }
    }
  });
});
