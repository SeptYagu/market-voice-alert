import { decideVoiceSchedule } from '../src/js/services/voiceSchedule.js';

const SETTINGS = {
  enabled: true,
  manualDisabledDate: null,
  smartSchedule: { enabled: true, autoStartAuction: false, pauseLunchBreak: true, autoStopAfterClose: true }
};

// 逐拍推进并返回每一拍的判定，模拟 30s 检查器的 previous 链。
function run(steps, overrides = {}) {
  let previous = null;
  return steps.map(({ now, codes }) => {
    const d = decideVoiceSchedule({
      codes,
      settings: { ...SETTINGS, ...overrides },
      now: new Date(now),
      tradingDates: [],
      previous
    });
    previous = d;
    return d;
  });
}

QUnit.module('services.voiceSchedule: 停播提示后的最后一轮', () => {
  QUnit.test('收盘提示那一拍的补播集合取自上一拍（本拍 eligibleCodes 必为空）', (t) => {
    const [live, close] = run([
      { now: '2026-09-09T14:59:30+08:00', codes: ['sh600519'] },
      { now: '2026-09-09T15:00:30+08:00', codes: ['sh600519'] }
    ]);
    t.deepEqual(live.eligibleCodes, ['sh600519']);
    t.equal(close.transitionNotice, '已收盘');
    t.deepEqual(close.eligibleCodes, [], '收盘那一拍本来就没有可播标的——所以不能用它当补播集合');
    t.deepEqual(close.finalCodes, ['sh600519'], '补播集合只能来自上一拍');
  });

  QUnit.test('午休、期货日夜空档、夜盘收盘三种提示都带补播集合', (t) => {
    const [lunchLive, lunch] = run([
      { now: '2026-09-09T11:29:30+08:00', codes: ['sh600519'] },
      { now: '2026-09-09T11:30:30+08:00', codes: ['sh600519'] }
    ]);
    t.equal(lunch.transitionNotice, '中午休市');
    t.deepEqual(lunch.finalCodes, lunchLive.eligibleCodes);

    const [dayLive, dayClose] = run([
      { now: '2026-09-09T14:58:30+08:00', codes: ['rb0'] },
      { now: '2026-09-09T15:00:30+08:00', codes: ['rb0'] }
    ]);
    t.equal(dayClose.transitionNotice, '已收盘');
    t.deepEqual(dayClose.finalCodes, dayLive.eligibleCodes, '期货日盘收盘同样补播');

    const [nightLive, nightClose] = run([
      { now: '2026-09-10T02:29:30+08:00', codes: ['au0'] },
      { now: '2026-09-10T02:31:00+08:00', codes: ['au0'] }
    ]);
    t.equal(nightClose.transitionNotice, '已收盘');
    t.deepEqual(nightClose.finalCodes, nightLive.eligibleCodes, '夜盘 02:30 收盘同样补播');
  });

  QUnit.test('普通交易拍没有补播集合', (t) => {
    const [, mid] = run([
      { now: '2026-09-09T14:59:30+08:00', codes: ['sh600519'] },
      { now: '2026-09-09T14:59:45+08:00', codes: ['sh600519'] }
    ]);
    t.equal(mid.transitionNotice, null);
    t.deepEqual(mid.finalCodes, []);
  });

  QUnit.test('补播集合按当前订阅过滤，已退订的标的不播', (t) => {
    const [, close] = run([
      { now: '2026-09-09T14:59:30+08:00', codes: ['sh600519', 'sz000001'] },
      { now: '2026-09-09T15:00:30+08:00', codes: ['sh600519'] }
    ]);
    t.equal(close.transitionNotice, '已收盘', '上一拍仍有在订阅的标的，所以提示照发');
    t.deepEqual(close.finalCodes, ['sh600519'], '但已退订的 sz000001 不能跟着播出来');
  });

  QUnit.test('上一拍在播的标的全部退订后连提示都不发（既有行为）', (t) => {
    const [, close] = run([
      // 夜盘只有 rb0 可播，随后 rb0 被退订 → 提示的触发条件不成立
      { now: '2026-09-09T22:59:30+08:00', codes: ['sh600519', 'rb0'] },
      { now: '2026-09-09T23:00:30+08:00', codes: ['sh600519'] }
    ]);
    t.equal(close.transitionNotice, null);
    t.deepEqual(close.finalCodes, []);
  });

  QUnit.test('订阅清空时连提示都不发，自然也没有补播', (t) => {
    const [, close] = run([
      { now: '2026-09-09T22:59:30+08:00', codes: ['rb0'] },
      { now: '2026-09-09T23:00:30+08:00', codes: [] }
    ]);
    t.equal(close.transitionNotice, null, '订阅清空时连提示都不发（既有行为）');
    t.deepEqual(close.finalCodes, []);
  });

  QUnit.test('关掉自动停播/午休暂停后不再有提示，也就没有补播', (t) => {
    const closeOff = run([
      { now: '2026-09-09T14:59:30+08:00', codes: ['sh600519'] },
      { now: '2026-09-09T15:00:30+08:00', codes: ['sh600519'] }
    ], { smartSchedule: { enabled: true, autoStopAfterClose: false, pauseLunchBreak: true } });
    t.equal(closeOff[1].transitionNotice, null);
    t.deepEqual(closeOff[1].finalCodes, []);

    const lunchOff = run([
      { now: '2026-09-09T11:29:30+08:00', codes: ['sh600519'] },
      { now: '2026-09-09T11:30:30+08:00', codes: ['sh600519'] }
    ], { smartSchedule: { enabled: true, autoStopAfterClose: true, pauseLunchBreak: false } });
    t.equal(lunchOff[1].transitionNotice, null);
    t.deepEqual(lunchOff[1].finalCodes, []);
  });

  QUnit.test('提示只发一次，补播不会跟着重复', (t) => {
    const [, , again] = run([
      { now: '2026-09-09T14:59:30+08:00', codes: ['sh600519'] },
      { now: '2026-09-09T15:00:30+08:00', codes: ['sh600519'] },
      { now: '2026-09-09T15:01:30+08:00', codes: ['sh600519'] }
    ]);
    t.equal(again.transitionNotice, null);
    t.deepEqual(again.finalCodes, []);
  });
});
