import {
  LIMIT_UP_GROUPS,
  classifyByLimitCount,
  sortByLimitCount,
  buildLimitUpGroups,
  mergeLiveTicks,
  isLimitUpName,
  getLimitUpGroupLabel,
  isLimitUpBroken,
  classifyWithBroken,
  sortLimitUpItems,
  mergeLimitUpMetadata
} from '../src/js/limitUp.js';

function item(over) {
  return Object.assign(
    { code: 'sh600519', name: '茅台', price: 100, changePercent: 10, limitUpCount: 1 },
    over || {}
  );
}

QUnit.module('limitUp.LIMIT_UP_GROUPS', () => {
  QUnit.test('exposes 4 groups in display order: 3+ / 2 / 1 / broken', (t) => {
    t.equal(LIMIT_UP_GROUPS.length, 4);
    t.equal(LIMIT_UP_GROUPS[0].key, '3+');
    t.equal(LIMIT_UP_GROUPS[1].key, '2');
    t.equal(LIMIT_UP_GROUPS[2].key, '1');
    t.equal(LIMIT_UP_GROUPS[3].key, 'broken');
  });
  QUnit.test('3+ matcher matches count >= 3', (t) => {
    t.true(LIMIT_UP_GROUPS[0].match(3));
    t.true(LIMIT_UP_GROUPS[0].match(10));
    t.false(LIMIT_UP_GROUPS[0].match(2));
  });
  QUnit.test('2 matcher matches count === 2 only', (t) => {
    t.true(LIMIT_UP_GROUPS[1].match(2));
    t.false(LIMIT_UP_GROUPS[1].match(3));
    t.false(LIMIT_UP_GROUPS[1].match(1));
  });
  QUnit.test('1 matcher matches count === 1 or 0 (first-board)', (t) => {
    t.true(LIMIT_UP_GROUPS[2].match(1));
    t.true(LIMIT_UP_GROUPS[2].match(0));
    t.false(LIMIT_UP_GROUPS[2].match(2));
  });
});

QUnit.module('limitUp.isLimitUpName', () => {
  QUnit.test('detects *ST at start of name', (t) => {
    t.true(isLimitUpName('*ST 华微'));
    t.true(isLimitUpName('*ST超讯'));
  });
  QUnit.test('detects ST at start (without *)', (t) => {
    t.true(isLimitUpName('ST康美'));
  });
  QUnit.test('case-insensitive', (t) => {
    t.true(isLimitUpName('st康美'));
    t.true(isLimitUpName('St康美'));
  });
  QUnit.test('non-ST names return false', (t) => {
    t.false(isLimitUpName('贵州茅台'));
    t.false(isLimitUpName('test'));
    t.false(isLimitUpName(''));
    t.false(isLimitUpName(null));
  });
});

QUnit.module('limitUp.classifyByLimitCount', () => {
  QUnit.test('classifies items into 3 buckets', (t) => {
    const items = [
      item({ code: 'a', limitUpCount: 5 }),
      item({ code: 'b', limitUpCount: 2 }),
      item({ code: 'c', limitUpCount: 1 }),
      item({ code: 'd', limitUpCount: 0 })
    ];
    const groups = classifyByLimitCount(items);
    t.equal(groups['3+'].length, 1);
    t.equal(groups['3+'][0].code, 'a');
    t.equal(groups['2'].length, 1);
    t.equal(groups['2'][0].code, 'b');
    t.equal(groups['1'].length, 2);
    t.equal(groups['1'][0].code, 'c');
    t.equal(groups['1'][1].code, 'd');
  });
  QUnit.test('returns empty groups for empty input', (t) => {
    const g = classifyByLimitCount([]);
    t.equal(g['3+'].length, 0);
    t.equal(g['2'].length, 0);
    t.equal(g['1'].length, 0);
  });
});

QUnit.module('limitUp.sortByLimitCount', () => {
  QUnit.test('sorts by count desc, then changePercent desc, then code asc', (t) => {
    const items = [
      item({ code: 'c', limitUpCount: 1, changePercent: 10 }),
      item({ code: 'a', limitUpCount: 3, changePercent: 10 }),
      item({ code: 'b', limitUpCount: 3, changePercent: 5 }),
      item({ code: 'd', limitUpCount: 3, changePercent: 10 })
    ];
    const sorted = sortByLimitCount(items);
    t.equal(sorted[0].code, 'a', 'a: count=3 pct=10 first');
    t.equal(sorted[1].code, 'd', 'd: count=3 pct=10 second (a<d)');
    t.equal(sorted[2].code, 'b', 'b: count=3 pct=5 third');
    t.equal(sorted[3].code, 'c', 'c: count=1 last');
  });
  QUnit.test('does not mutate input', (t) => {
    const items = [item({ code: 'a', limitUpCount: 1 }), item({ code: 'b', limitUpCount: 3 })];
    const snapshot = items.map((x) => x.code);
    sortByLimitCount(items);
    t.deepEqual(items.map((x) => x.code), snapshot);
  });
});

QUnit.module('limitUp.buildLimitUpGroups', () => {
  QUnit.test('returns ordered groups with items sorted', (t) => {
    const items = [
      item({ code: 'a', limitUpCount: 1, changePercent: 10 }),
      item({ code: 'b', limitUpCount: 5, changePercent: 10 }),
      item({ code: 'c', limitUpCount: 5, changePercent: 10 })
    ];
    const out = buildLimitUpGroups(items);
    t.equal(out.length, 4, 'four group entries (incl. broken)');
    t.equal(out[0].key, '3+');
    t.equal(out[0].items.length, 2);
    t.equal(out[0].items[0].code, 'b', 'higher count first');
    t.equal(out[1].key, '2');
    t.equal(out[1].items.length, 0);
    t.equal(out[2].key, '1');
    t.equal(out[2].items.length, 1);
    t.equal(out[3].key, 'broken');
    t.equal(out[3].items.length, 0);
  });
  QUnit.test('skips groups that are empty (still keeps order)', (t) => {
    const items = [item({ code: 'a', limitUpCount: 1 })];
    const out = buildLimitUpGroups(items);
    t.equal(out.length, 4);
    t.equal(out[0].items.length, 0, '3+ empty');
    t.equal(out[1].items.length, 0, '2 empty');
    t.equal(out[2].items.length, 1, '1 has the item');
    t.equal(out[3].items.length, 0, 'broken empty');
  });
});

QUnit.module('limitUp.mergeLiveTicks', () => {
  QUnit.test('patches price/change/changePercent from live quote', (t) => {
    const items = [item({ code: 'sh600519', price: 100, change: 0, changePercent: 10 })];
    const live = new Map([['sh600519', { code: 'sh600519', price: 105, change: 5, changePercent: 10.5 }]]);
    const out = mergeLiveTicks(items, live);
    t.equal(out[0].price, 105);
    t.equal(out[0].change, 5);
    t.equal(out[0].changePercent, 10.5);
  });
  QUnit.test('keeps item unchanged when code not in live map', (t) => {
    const items = [item({ code: 'sh600519', price: 100 })];
    const live = new Map();
    const out = mergeLiveTicks(items, live);
    t.equal(out[0].price, 100);
  });
  QUnit.test('does not mutate input array or items', (t) => {
    const items = [item({ code: 'sh600519', price: 100 })];
    const live = new Map([['sh600519', { code: 'sh600519', price: 105, change: 0, changePercent: 10 }]]);
    const out = mergeLiveTicks(items, live);
    t.notStrictEqual(out, items);
    t.equal(items[0].price, 100, 'original untouched');
  });
  QUnit.test('handles non-Map liveQuotes (object)', (t) => {
    const items = [item({ code: 'sh600519', price: 100 })];
    const live = { sh600519: { code: 'sh600519', price: 110, change: 0, changePercent: 11 } };
    const out = mergeLiveTicks(items, live);
    t.equal(out[0].price, 110);
  });
  QUnit.test('skips live quote with invalid (non-finite) price', (t) => {
    const items = [item({ code: 'sh600519', price: 100 })];
    const live = new Map([['sh600519', { code: 'sh600519', price: NaN, change: 0, changePercent: 10 }]]);
    const out = mergeLiveTicks(items, live);
    t.equal(out[0].price, 100);
  });
});

QUnit.module('limitUp.getLimitUpGroupLabel', () => {
  QUnit.test('returns Chinese label for known keys', (t) => {
    t.equal(getLimitUpGroupLabel('3+'), '3 连板及以上');
    t.equal(getLimitUpGroupLabel('2'), '2 连板');
    t.equal(getLimitUpGroupLabel('1'), '1 连板 / 首板');
  });
  QUnit.test('returns key for unknown', (t) => {
    t.equal(getLimitUpGroupLabel('?'), '?');
  });
});

QUnit.module('limitUp.isLimitUpBroken', () => {
  QUnit.test('sh600xxx (limit 10) is broken when changePercent < 9.5', (t) => {
    t.true(isLimitUpBroken(item({ code: 'sh600519', name: 'A', changePercent: 9.4 })));
    t.true(isLimitUpBroken(item({ code: 'sh600519', name: 'A', changePercent: 5 })));
  });
  QUnit.test('sh600xxx at or above 9.5 is not broken', (t) => {
    t.false(isLimitUpBroken(item({ code: 'sh600519', name: 'A', changePercent: 9.5 })));
    t.false(isLimitUpBroken(item({ code: 'sh600519', name: 'A', changePercent: 10 })));
  });
  QUnit.test('sz300xxx (limit 20) is broken when changePercent < 19.5', (t) => {
    t.true(isLimitUpBroken(item({ code: 'sz300750', name: 'B', changePercent: 19.4 })));
    t.false(isLimitUpBroken(item({ code: 'sz300750', name: 'B', changePercent: 19.5 })));
  });
  QUnit.test('bj code (limit 30) is broken when changePercent < 29.5', (t) => {
    t.true(isLimitUpBroken(item({ code: 'bj830799', name: 'C', changePercent: 29 })));
    t.false(isLimitUpBroken(item({ code: 'bj830799', name: 'C', changePercent: 29.5 })));
  });
  QUnit.test('ST name (limit 5) is broken when changePercent < 4.5', (t) => {
    t.true(isLimitUpBroken(item({ code: 'sh600000', name: '*ST 华微', changePercent: 4.4 })));
    t.false(isLimitUpBroken(item({ code: 'sh600000', name: '*ST 华微', changePercent: 4.5 })));
  });
  QUnit.test('handles invalid changePercent gracefully (treated as broken)', (t) => {
    t.true(isLimitUpBroken(item({ code: 'sh600000', name: 'A', changePercent: null })));
    t.true(isLimitUpBroken(item({ code: 'sh600000', name: 'A', changePercent: NaN })));
  });
  QUnit.test('handles missing code/name (defaults to 10)', (t) => {
    t.true(isLimitUpBroken({ changePercent: 9 }));
    t.false(isLimitUpBroken({ changePercent: 10 }));
  });
});

QUnit.module('limitUp.classifyWithBroken', () => {
  QUnit.test('buckets broken (changePercent < threshold - 0.5) into "broken"', (t) => {
    const items = [
      item({ code: 'sh600519', name: 'A', changePercent: 10, limitUpCount: 1 }),
      item({ code: 'sz300750', name: 'B', changePercent: 19.4, limitUpCount: 1 })
    ];
    const b = classifyWithBroken(items);
    t.equal(b['1'].length, 1);
    t.equal(b['1'][0].code, 'sh600519');
    t.equal(b.broken.length, 1);
    t.equal(b.broken[0].code, 'sz300750');
  });
  QUnit.test('all buckets present in result', (t) => {
    const b = classifyWithBroken([]);
    t.ok(Array.isArray(b['3+']));
    t.ok(Array.isArray(b['2']));
    t.ok(Array.isArray(b['1']));
    t.ok(Array.isArray(b.broken));
  });
  QUnit.test('passes through 3+ and 2 boards when at limit', (t) => {
    const items = [
      item({ code: 'a', changePercent: 10, limitUpCount: 5 }),
      item({ code: 'b', changePercent: 10, limitUpCount: 2 })
    ];
    const b = classifyWithBroken(items);
    t.equal(b['3+'].length, 1);
    t.equal(b['2'].length, 1);
    t.equal(b['1'].length, 0);
    t.equal(b.broken.length, 0);
  });
  QUnit.test('handles empty / non-array input', (t) => {
    t.deepEqual(classifyWithBroken([]), { '3+': [], '2': [], '1': [], broken: [] });
    t.deepEqual(classifyWithBroken(null), { '3+': [], '2': [], '1': [], broken: [] });
  });
});

QUnit.module('limitUp.sortLimitUpItems', () => {
  QUnit.test('sortKey="count" sorts by limitUpCount desc, then pct desc, then code asc', (t) => {
    const items = [
      item({ code: 'c', limitUpCount: 1, changePercent: 10 }),
      item({ code: 'a', limitUpCount: 3, changePercent: 10 }),
      item({ code: 'b', limitUpCount: 3, changePercent: 5 })
    ];
    const sorted = sortLimitUpItems(items, 'count');
    t.equal(sorted[0].code, 'a');
    t.equal(sorted[1].code, 'b');
    t.equal(sorted[2].code, 'c');
  });
  QUnit.test('sortKey="pct" sorts by changePercent desc, then count desc, then code asc', (t) => {
    const items = [
      item({ code: 'a', limitUpCount: 3, changePercent: 5 }),
      item({ code: 'b', limitUpCount: 1, changePercent: 10 }),
      item({ code: 'c', limitUpCount: 3, changePercent: 10 })
    ];
    const sorted = sortLimitUpItems(items, 'pct');
    t.equal(sorted[0].code, 'c', 'pct=10 count=3 (c > b on count)');
    t.equal(sorted[1].code, 'b', 'pct=10 count=1');
    t.equal(sorted[2].code, 'a', 'pct=5 last');
  });
  QUnit.test('sortKey="time" sorts by lastLimitTime asc; null goes last', (t) => {
    const items = [
      item({ code: 'a', firstLimitTime: '09:30', lastLimitTime: '10:30' }),
      item({ code: 'b', firstLimitTime: '09:15', lastLimitTime: null }),
      item({ code: 'c', firstLimitTime: '10:00', lastLimitTime: '09:15' })
    ];
    const sorted = sortLimitUpItems(items, 'time');
    t.equal(sorted[0].code, 'c');
    t.equal(sorted[1].code, 'a');
    t.equal(sorted[2].code, 'b', 'null goes last');
  });
  QUnit.test('sortKey="time" ties on time break by changePercent desc', (t) => {
    const items = [
      item({ code: 'a', lastLimitTime: '10:00', changePercent: 5 }),
      item({ code: 'b', lastLimitTime: '10:00', changePercent: 10 })
    ];
    const sorted = sortLimitUpItems(items, 'time');
    t.equal(sorted[0].code, 'b');
  });
  QUnit.test('sortKey="amount" sorts by amount desc, then pct desc, then code asc', (t) => {
    const items = [
      item({ code: 'a', amount: 100, changePercent: 10 }),
      item({ code: 'b', amount: 500, changePercent: 5 }),
      item({ code: 'c', amount: 500, changePercent: 10 })
    ];
    const sorted = sortLimitUpItems(items, 'amount');
    t.equal(sorted[0].code, 'c', 'amount=500 pct=10 first');
    t.equal(sorted[1].code, 'b', 'amount=500 pct=5');
    t.equal(sorted[2].code, 'a');
  });
  QUnit.test('does not mutate input', (t) => {
    const items = [item({ code: 'a' }), item({ code: 'b' })];
    const snap = items.map((x) => x.code);
    sortLimitUpItems(items, 'count');
    t.deepEqual(items.map((x) => x.code), snap);
  });
  QUnit.test('unknown sortKey falls back to count behavior', (t) => {
    const items = [
      item({ code: 'a', limitUpCount: 1 }),
      item({ code: 'b', limitUpCount: 3 })
    ];
    const sorted = sortLimitUpItems(items, 'nonsense');
    t.equal(sorted[0].code, 'b');
  });
});

QUnit.module('limitUp.mergeLimitUpMetadata', () => {
  QUnit.test('applies metadata (limitUpCount/firstLimitTime/lastLimitTime/breakCount) to matching codes', (t) => {
    const items = [
      item({ code: 'sh600519', limitUpCount: 0, firstLimitTime: null, lastLimitTime: null, breakCount: 0 }),
      item({ code: 'sz000001', limitUpCount: 0, firstLimitTime: null, lastLimitTime: null, breakCount: 0 })
    ];
    const meta = new Map([
      ['sh600519', { limitUpCount: 3, firstLimitTime: '10:30', lastLimitTime: '14:30', breakCount: 1 }],
      ['sz000001', { limitUpCount: 0, firstLimitTime: null, lastLimitTime: null, breakCount: 0 }]
    ]);
    const out = mergeLimitUpMetadata(items, meta);
    t.equal(out[0].limitUpCount, 3);
    t.equal(out[0].firstLimitTime, '10:30');
    t.equal(out[0].lastLimitTime, '14:30');
    t.equal(out[0].breakCount, 1);
    t.equal(out[1].limitUpCount, 0);
  });
  QUnit.test('leaves items unchanged when no metadata for code', (t) => {
    const items = [item({ code: 'sh600519', limitUpCount: 0 })];
    const out = mergeLimitUpMetadata(items, new Map());
    t.equal(out[0].limitUpCount, 0);
  });
  QUnit.test('does not mutate input array or items', (t) => {
    const items = [item({ code: 'sh600519', limitUpCount: 0 })];
    const meta = new Map([['sh600519', { limitUpCount: 5, firstLimitTime: '10:00', breakCount: 2 }]]);
    const out = mergeLimitUpMetadata(items, meta);
    t.notStrictEqual(out, items);
    t.equal(items[0].limitUpCount, 0, 'original untouched');
  });
  QUnit.test('handles null/undefined meta gracefully', (t) => {
    const items = [item({ code: 'sh600519' })];
    t.strictEqual(mergeLimitUpMetadata(items, null), items);
    t.strictEqual(mergeLimitUpMetadata(items, undefined), items);
  });
  QUnit.test('handles null items gracefully', (t) => {
    t.deepEqual(mergeLimitUpMetadata(null, new Map()), null);
  });
  QUnit.test('skips null items in array', (t) => {
    const items = [item({ code: 'a' }), null, item({ code: 'b', limitUpCount: 0 })];
    const meta = new Map([['b', { limitUpCount: 5, firstLimitTime: null, breakCount: 0 }]]);
    const out = mergeLimitUpMetadata(items, meta);
    t.equal(out.length, 3);
    t.equal(out[0].limitUpCount, 1, 'item a unchanged (no meta)');
    t.equal(out[1], null, 'null preserved');
    t.equal(out[2].limitUpCount, 5, 'item b updated from meta');
  });
});

QUnit.module('limitUp.LIMIT_UP_GROUPS (broken group)', () => {
  QUnit.test('includes 4 groups: 3+ / 2 / 1 / broken', (t) => {
    t.equal(LIMIT_UP_GROUPS.length, 4);
    t.equal(LIMIT_UP_GROUPS[0].key, '3+');
    t.equal(LIMIT_UP_GROUPS[1].key, '2');
    t.equal(LIMIT_UP_GROUPS[2].key, '1');
    t.equal(LIMIT_UP_GROUPS[3].key, 'broken');
    t.equal(LIMIT_UP_GROUPS[3].label, '炸板');
  });
});

QUnit.module('limitUp.buildLimitUpGroups (sortKey param)', () => {
  QUnit.test('default sortKey is "amount"', (t) => {
    const items = [
      item({ code: 'a', limitUpCount: 3, changePercent: 10, amount: 100 }),
      item({ code: 'b', limitUpCount: 3, changePercent: 10, amount: 500 })
    ];
    const out = buildLimitUpGroups(items);
    t.equal(out.length, 4, '4 group entries including broken');
    t.equal(out[0].items[0].code, 'b', 'amount desc by default');
  });
  QUnit.test('sortKey="pct" applies pct ordering within buckets', (t) => {
    const items = [
      item({ code: 'a', limitUpCount: 1, changePercent: 5 }),
      item({ code: 'b', limitUpCount: 1, changePercent: 10 })
    ];
    const out = buildLimitUpGroups(items, 'pct');
    const bucket1 = out.find((g) => g.key === '1');
    t.equal(bucket1.items[0].code, 'b', 'higher pct first');
  });
  QUnit.test('places broken items in broken bucket', (t) => {
    const items = [
      item({ code: 'a', name: 'A', changePercent: 10, limitUpCount: 1 }),
      item({ code: 'b', name: 'B', changePercent: 9, limitUpCount: 0 })
    ];
    const out = buildLimitUpGroups(items);
    const broken = out.find((g) => g.key === 'broken');
    t.equal(broken.items.length, 1);
    t.equal(broken.items[0].code, 'b');
  });
});
