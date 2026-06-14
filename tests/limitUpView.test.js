import { renderLimitUpPage, shiftDateString } from '../src/js/limitUpView.js';

QUnit.module('limitUpView.renderLimitUpPage (sort/select/checkboxes)', (hooks) => {
  let root;

  hooks.beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });
  hooks.afterEach(() => {
    document.body.removeChild(root);
  });

  function buildState(over = {}) {
    // Phase 8 adapter: 旧测试用 chartCode 字符串, 转 expandedCodes Set + chartInstances Map
    let expandedCodes = new Set();
    const chartInstances = new Map();
    if (typeof over.chartCode === 'string' && over.chartCode) {
      expandedCodes = new Set([over.chartCode]);
      chartInstances.set(over.chartCode, {
        ctl: null,
        period: over.chartPeriod || '1d',
        klineData: over.chartKlineData || null,
        loading: !!over.chartLoading,
        error: over.chartError || null,
        abort: null
      });
    }
    return Object.assign(
      {
        items: [],
        groups: [
          { key: '3+', label: '3 连板及以上', items: [] },
          { key: '2', label: '2 连板', items: [] },
          { key: '1', label: '1 连板 / 首板', items: [] },
          { key: 'broken', label: '炸板', items: [] }
        ],
        lastUpdate: new Date('2024-03-15T10:00:00Z'),
        loading: false,
        error: null,
        refreshInterval: 30000,
        sortKey: 'amount',
        selectedCodes: new Set(),
        // Phase 8: 多 chart 架构
        expandedCodes,
        chartInstances,
        chartPeriod: '1d',
        consecutiveEmptyFetches: 0,
        lastNonEmptyAt: null
      },
      over
    );
  }

  function buildItem(over = {}) {
    return Object.assign(
      {
        code: 'sh600519',
        name: '茅台',
        price: 1100,
        change: 100,
        changePercent: 10,
        limitUpCount: 1,
        firstLimitTime: '10:30',
        breakCount: 0,
        isST: false,
        amount: 100000
      },
      over
    );
  }

  QUnit.test('renders sortable table headers with amount active by default', (t) => {
    const state = buildState();
    state.groups[2].items = [buildItem()];
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      sortGroup: () => {},
      onLiveTickUpdate: () => {}
    });
    const headers = root.querySelectorAll('th.lu-sortable');
    t.equal(headers.length, 8, '8 sortable headers');
    const active = root.querySelector('th.lu-amount.active');
    t.ok(active, 'amount header active');
    t.ok(active.textContent.includes('成交额 ↓'), 'shows default desc indicator');
  });

  QUnit.test('groupSort state marks only that group header active', (t) => {
    const state = buildState({ groupSort: { '1': { key: 'pct', direction: 'asc' } } });
    state.groups[2].items = [buildItem()];
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      sortGroup: () => {},
      onLiveTickUpdate: () => {}
    });
    const group = root.querySelector('.lu-group[data-group="1"]');
    const active = group.querySelector('th.lu-pct.active');
    t.ok(active, 'pct header active in 1-board group');
    t.ok(active.textContent.includes('涨幅 ↑'), 'shows asc indicator');
  });

  QUnit.test('clicking a table header invokes sortGroup with group key and sort key', (t) => {
    let captured;
    const state = buildState();
    state.groups[2].items = [buildItem()];
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      sortGroup: (groupKey, key) => { captured = { groupKey, key }; },
      onLiveTickUpdate: () => {}
    });
    root.querySelector('.lu-group[data-group="1"] th.lu-final').click();
    t.deepEqual(captured, { groupKey: '1', key: 'time' });
  });

  QUnit.test('always renders pinned stock group even when empty', (t) => {
    const state = buildState({ pinnedCodes: new Set() });
    state.groups[2].items = [buildItem()];
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      sortGroup: () => {},
      onLiveTickUpdate: () => {}
    });
    const pinned = root.querySelector('.lu-group[data-group="pinned"]');
    t.ok(pinned, 'pinned group exists');
    t.ok(pinned.textContent.includes('置顶股票'), 'has pinned title');
    t.ok(pinned.textContent.includes('0 只'), 'shows zero count');
  });

  QUnit.test('final seal column uses lastLimitTime only', (t) => {
    const state = buildState();
    state.groups[2].items = [
      buildItem({ code: 'sh600519', firstLimitTime: '09:25', lastLimitTime: '14:30' }),
      buildItem({ code: 'sz000001', firstLimitTime: '09:30', lastLimitTime: null })
    ];
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      sortGroup: () => {},
      onLiveTickUpdate: () => {}
    });
    const cells = root.querySelectorAll('.lu-group[data-group="1"] td.lu-final');
    t.equal(cells[0].textContent, '14:30');
    t.equal(cells[1].textContent, '-', 'does not fall back to firstLimitTime');
  });

  QUnit.test('renders add-selected button, disabled when no selection', (t) => {
    const state = buildState({ selectedCodes: new Set() });
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      onSortChange: () => {},
      onLiveTickUpdate: () => {}
    });
    const btn = root.querySelector('#lu-add-selected');
    t.ok(btn, 'add-selected button exists');
    t.true(btn.disabled, 'disabled when selectedCodes is empty');
  });

  QUnit.test('add-selected button enabled when selection non-empty', (t) => {
    const state = buildState({ selectedCodes: new Set(['sh600519']) });
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      onSortChange: () => {},
      onLiveTickUpdate: () => {}
    });
    const btn = root.querySelector('#lu-add-selected');
    t.false(btn.disabled);
  });

  QUnit.test('add-selected click invokes callback with selected codes', (t) => {
    let captured;
    const state = buildState({ selectedCodes: new Set(['sh600519', 'sz000001']) });
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      onSortChange: () => {},
      addSelectedAndNavigate: (codes) => { captured = codes; },
      onLiveTickUpdate: () => {}
    });
    const btn = root.querySelector('#lu-add-selected');
    btn.click();
    t.deepEqual(captured.sort(), ['sh600519', 'sz000001']);
  });

  QUnit.test('"全选" link calls selectAll callback', (t) => {
    let called = 0;
    const state = buildState();
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      onSortChange: () => {},
      selectAll: () => { called++; },
      onLiveTickUpdate: () => {}
    });
    root.querySelector('#lu-select-all').click();
    t.equal(called, 1);
  });

  QUnit.test('"取消全选" link calls selectNone callback', (t) => {
    let called = 0;
    const state = buildState({ selectedCodes: new Set(['sh600519']) });
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      onSortChange: () => {},
      selectNone: () => { called++; },
      onLiveTickUpdate: () => {}
    });
    root.querySelector('#lu-select-none').click();
    t.equal(called, 1);
  });

  QUnit.test('shows "N 已选" count', (t) => {
    const state = buildState({ selectedCodes: new Set(['a', 'b', 'c']) });
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      onSortChange: () => {},
      onLiveTickUpdate: () => {}
    });
    const counter = root.querySelector('#lu-selected-count');
    t.ok(counter);
    t.equal(counter.textContent, '3 已选');
  });

  QUnit.test('rows have a checkbox column (first column)', (t) => {
    const state = buildState();
    state.groups[2].items = [buildItem({ code: 'sh600519' })];
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      onSortChange: () => {},
      onLiveTickUpdate: () => {}
    });
    const row = root.querySelector('tr[data-code="sh600519"]');
    t.ok(row, 'row exists');
    const cells = row.querySelectorAll('td');
    t.ok(cells[0].classList.contains('lu-check'), 'first cell has lu-check class');
    t.ok(cells[0].querySelector('input[type="checkbox"]'), 'first cell contains checkbox');
  });

  QUnit.test('checkbox click toggles selected set (does not trigger row click)', (t) => {
    let toggleCalls = 0;
    let rowClicks = 0;
    const state = buildState();
    state.groups[2].items = [buildItem({ code: 'sh600519' })];
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      onSortChange: () => {},
      openKline: () => { rowClicks++; },
      onLiveTickUpdate: () => {},
      toggleSelect: () => { toggleCalls++; }
    });
    const cb = root.querySelector('tr[data-code="sh600519"] input[type="checkbox"]');
    cb.click();
    t.equal(toggleCalls, 1, 'toggleSelect called');
    t.equal(rowClicks, 0, 'row click NOT triggered');
  });

  QUnit.test('row body click (not on checkbox) invokes openKline', (t) => {
    let klineCode;
    const state = buildState();
    state.groups[2].items = [buildItem({ code: 'sh600519' })];
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      onSortChange: () => {},
      openKline: (code) => { klineCode = code; },
      onLiveTickUpdate: () => {}
    });
    const row = root.querySelector('tr[data-code="sh600519"]');
    const cell = row.querySelector('td.lu-name');
    cell.click();
    t.equal(klineCode, 'sh600519');
  });

  QUnit.test('row click does NOT call addToWatchListAndNavigate', (t) => {
    let added = 0;
    const state = buildState();
    state.groups[2].items = [buildItem({ code: 'sh600519' })];
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => { added++; },
      onRefreshChange: () => {},
      fetchList: () => {},
      onSortChange: () => {},
      onLiveTickUpdate: () => {}
    });
    const row = root.querySelector('tr[data-code="sh600519"]');
    row.querySelector('td.lu-name').click();
    t.equal(added, 0, 'old add-on-click behavior removed');
  });

  QUnit.test('checked state of checkbox reflects selectedCodes', (t) => {
    const state = buildState({ selectedCodes: new Set(['sh600519']) });
    state.groups[2].items = [buildItem({ code: 'sh600519' }), buildItem({ code: 'sz000001' })];
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      onSortChange: () => {},
      onLiveTickUpdate: () => {}
    });
    const boxes = root.querySelectorAll('input[type="checkbox"][data-row-code]');
    t.equal(boxes.length, 2);
    t.true(boxes[0].checked);
    t.false(boxes[1].checked);
  });
});

QUnit.module('limitUpView.renderLimitUpPage (kline panel)', (hooks) => {
  let root;
  hooks.beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });
  hooks.afterEach(() => {
    document.body.removeChild(root);
  });

  function buildState(over = {}) {
    let expandedCodes = new Set();
    const chartInstances = new Map();
    if (typeof over.chartCode === 'string' && over.chartCode) {
      expandedCodes = new Set([over.chartCode]);
      chartInstances.set(over.chartCode, {
        ctl: null,
        period: over.chartPeriod || '1d',
        klineData: over.chartKlineData || null,
        loading: !!over.chartLoading,
        error: over.chartError || null,
        abort: null
      });
    }
    return Object.assign(
      {
        items: [],
        groups: [
          { key: '3+', label: '3 连板及以上', items: [] },
          { key: '2', label: '2 连板', items: [] },
          { key: '1', label: '1 连板 / 首板', items: [] },
          { key: 'broken', label: '炸板', items: [] }
        ],
        lastUpdate: null,
        loading: false,
        error: null,
        refreshInterval: 30000,
        sortKey: 'amount',
        selectedCodes: new Set(),
        expandedCodes,
        chartInstances,
        chartPeriod: '1d',
        consecutiveEmptyFetches: 0,
        lastNonEmptyAt: null
      },
      over
    );
  }

  function buildItem(over = {}) {
    return Object.assign(
      {
        code: 'sh600519',
        name: '茅台',
        price: 1100,
        change: 100,
        changePercent: 10,
        limitUpCount: 1,
        firstLimitTime: '10:30',
        breakCount: 0,
        isST: false,
        amount: 100000
      },
      over
    );
  }

  QUnit.test('does NOT render chart row when chartCode is null', (t) => {
    const state = buildState();
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      onSortChange: () => {},
      onLiveTickUpdate: () => {}
    });
    t.strictEqual(root.querySelector('.lu-chart-row'), null, 'no chart row');
    t.strictEqual(root.querySelector('#lu-chart-host'), null, 'no chart host');
    t.strictEqual(root.querySelector('#lu-kline-panel'), null, 'no bottom panel');
  });

  QUnit.test('renders chart row inline immediately after the matching stock row', (t) => {
    const state = buildState({ chartCode: 'sh600519' });
    state.groups[2].items = [
      buildItem({ code: 'sh600519', name: 'A' }),
      buildItem({ code: 'sz000001', name: 'B' }),
      buildItem({ code: 'sz000002', name: 'C' })
    ];
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      onSortChange: () => {},
      onLiveTickUpdate: () => {}
    });
    const tbody = root.querySelector('.lu-group[data-group="1"] tbody');
    const rows = tbody.querySelectorAll('tr');
    t.equal(rows.length, 4, '3 stock rows + 1 chart row');
    t.equal(rows[0].dataset.code, 'sh600519', 'row 0 = matching stock');
    t.ok(rows[0].classList.contains('lu-active'), 'row 0 has lu-active');
    t.ok(rows[1].classList.contains('lu-chart-row'), 'row 1 is chart row');
    t.equal(rows[1].dataset.chartFor, 'sh600519', 'chart row tagged with code');
    t.equal(rows[2].dataset.code, 'sz000001', 'row 2 = next stock');
    t.equal(rows[3].dataset.code, 'sz000002', 'row 3 = next stock');
  });

  QUnit.test('chart row sits inside the matching group tbody, NOT at page bottom', (t) => {
    const state = buildState({ chartCode: 'sh600519' });
    state.groups[2].items = [buildItem({ code: 'sh600519' })];
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      onSortChange: () => {},
      onLiveTickUpdate: () => {}
    });
    t.strictEqual(root.querySelector('#lu-kline-panel'), null, 'bottom panel removed');
    const groupTbody = root.querySelector('.lu-group[data-group="1"] tbody');
    const chartRow = groupTbody.querySelector('.lu-chart-row');
    t.ok(chartRow, 'chart row inside group tbody');
  });

  QUnit.test('chart row contains name, code, period tabs, close button, status, host', (t) => {
    const state = buildState({ chartCode: 'sh600519' });
    state.groups[2].items = [buildItem({ code: 'sh600519', name: '贵州茅台' })];
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      onSortChange: () => {},
      onLiveTickUpdate: () => {}
    });
    const chartRow = root.querySelector('.lu-chart-row');
    t.ok(chartRow, 'chart row exists');
    t.ok(chartRow.querySelector('.lu-chart-inline-header'), 'inline header exists');
    t.ok(chartRow.querySelector('.lu-chart-inline-title'), 'title block exists');
    t.ok(chartRow.querySelector('.lu-chart-close'), 'close button exists');
    const tabs = chartRow.querySelectorAll('.lu-period-tab');
    t.ok(tabs.length >= 3, 'period tabs exist');
    // Phase 8: host id per code (multi-chart)
    t.ok(chartRow.querySelector('#lu-chart-host-sh600519'), 'chart host exists (per-code)');
    t.ok(chartRow.querySelector('#lu-chart-status-sh600519'), 'status exists (per-code)');
    t.ok(chartRow.textContent.includes('贵州茅台'), 'shows name');
    t.ok(chartRow.textContent.includes('sh600519'), 'shows code');
  });

  QUnit.test('chart row td has colspan covering all 13 columns', (t) => {
    const state = buildState({ chartCode: 'sh600519' });
    state.groups[2].items = [buildItem({ code: 'sh600519' })];
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      onSortChange: () => {},
      onLiveTickUpdate: () => {}
    });
    const td = root.querySelector('.lu-chart-row > td');
    t.ok(td, 'td exists');
    t.equal(td.getAttribute('colspan'), '13', 'colspan = 13');
  });

  QUnit.test('chart row period tab click invokes changeKlinePeriod', (t) => {
    let captured;
    const state = buildState({ chartCode: 'sh600519' });
    state.groups[2].items = [buildItem({ code: 'sh600519' })];
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      onSortChange: () => {},
      changeKlinePeriod: (p) => { captured = p; },
      onLiveTickUpdate: () => {}
    });
    const tab = root.querySelector('.lu-chart-row .lu-period-tab[data-period="5m"]');
    tab.click();
    t.equal(captured, '5m');
  });

  QUnit.test('chart row close button invokes closeKline', (t) => {
    let called = 0;
    const state = buildState({ chartCode: 'sh600519' });
    state.groups[2].items = [buildItem({ code: 'sh600519' })];
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      onSortChange: () => {},
      closeKline: () => { called++; },
      onLiveTickUpdate: () => {}
    });
    const btn = root.querySelector('.lu-chart-row .lu-chart-close');
    t.ok(btn, 'close button exists in chart row');
    btn.click();
    t.equal(called, 1);
  });

  QUnit.test('active period tab in chart row has active class', (t) => {
    const state = buildState({ chartCode: 'sh600519', chartPeriod: '1w' });
    state.groups[2].items = [buildItem({ code: 'sh600519' })];
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      onSortChange: () => {},
      onLiveTickUpdate: () => {}
    });
    const active = root.querySelector('.lu-chart-row .lu-period-tab.active');
    t.ok(active, 'has active period tab in chart row');
    t.equal(active.dataset.period, '1w');
  });

  QUnit.test('row with code === chartCode has lu-active class', (t) => {
    const state = buildState({ chartCode: 'sh600519' });
    state.groups[2].items = [
      { code: 'sh600519', name: 'A', price: 100, changePercent: 10, limitUpCount: 1, firstLimitTime: '10:30', breakCount: 0 },
      { code: 'sz000001', name: 'B', price: 100, changePercent: 10, limitUpCount: 1, firstLimitTime: '10:30', breakCount: 0 }
    ];
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      onSortChange: () => {},
      onLiveTickUpdate: () => {}
    });
    const activeRow = root.querySelector('tr.lu-active');
    t.equal(activeRow.dataset.code, 'sh600519');
  });

  QUnit.test('does NOT render chart row when chartCode matches no item in any group', (t) => {
    const state = buildState({ chartCode: 'sz999999' });
    state.groups[2].items = [buildItem({ code: 'sh600519' })];
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      onSortChange: () => {},
      onLiveTickUpdate: () => {}
    });
    t.strictEqual(root.querySelector('.lu-chart-row'), null, 'no chart row when no matching item');
    t.strictEqual(root.querySelector('#lu-chart-host'), null, 'no chart host when no matching item');
  });

  QUnit.test('chart row position: matching row in groups[1] (key "2") → chart row in that group, not the other group', (t) => {
    const state = buildState({ chartCode: 'sz000777' });
    state.groups[1].items = [
      buildItem({ code: 'sh600001' }),
      buildItem({ code: 'sz000777' })
    ];
    state.groups[2].items = [
      buildItem({ code: 'sh600519' })
    ];
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      onSortChange: () => {},
      onLiveTickUpdate: () => {}
    });
    const group2Tbody = root.querySelector('.lu-group[data-group="2"] tbody');
    const group2Rows = group2Tbody.querySelectorAll('tr');
    t.equal(group2Rows.length, 3, 'group "2" (with match): 2 stock + 1 chart');
    t.equal(group2Rows[0].dataset.code, 'sh600001', 'row 0 = first stock');
    t.equal(group2Rows[1].dataset.code, 'sz000777', 'row 1 = matching stock');
    t.equal(group2Rows[2].dataset.chartFor, 'sz000777', 'row 2 = chart row, right after matching stock');
    const group1Tbody = root.querySelector('.lu-group[data-group="1"] tbody');
    const group1Rows = group1Tbody.querySelectorAll('tr');
    t.equal(group1Rows.length, 1, 'group "1" (no match): 1 stock row, no chart row');
    t.equal(group1Rows[0].dataset.code, 'sh600519');
  });

  QUnit.test('chart row status text reflects chartLoading/chartError/chartKlineData', (t) => {
    const state = buildState({
      chartCode: 'sh600519',
      chartLoading: true
    });
    state.groups[2].items = [buildItem({ code: 'sh600519' })];
    renderLimitUpPage(root, state, {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      onSortChange: () => {},
      onLiveTickUpdate: () => {}
    });
    // Phase 8: status id is per-code
    const status = root.querySelector('.lu-chart-row #lu-chart-status-sh600519');
    t.ok(status, 'status element exists');
    t.ok(status.textContent.includes('图表加载中'), 'shows loading text');
  });
});

// ============================================================
// Date shift + prev/next buttons (2026-06-05)
// ============================================================
QUnit.module('limitUpView.shiftDateString', () => {
  QUnit.test('shifts YYYY-MM-DD by +1 day', (t) => {
    t.equal(shiftDateString('2026-06-04', 1), '2026-06-05');
  });
  QUnit.test('shifts YYYY-MM-DD by -1 day', (t) => {
    t.equal(shiftDateString('2026-06-04', -1), '2026-06-03');
  });
  QUnit.test('crosses month boundary', (t) => {
    t.equal(shiftDateString('2026-05-31', 1), '2026-06-01');
  });
  QUnit.test('crosses year boundary', (t) => {
    t.equal(shiftDateString('2025-12-31', 1), '2026-01-01');
  });
  QUnit.test('handles leap year Feb 29', (t) => {
    t.equal(shiftDateString('2024-02-28', 1), '2024-02-29');
  });
  QUnit.test('non-leap year Feb 28 + 1 = Mar 1', (t) => {
    t.equal(shiftDateString('2025-02-28', 1), '2025-03-01');
  });
  QUnit.test('null/empty input uses today as base', (t) => {
    const today = new Date();
    today.setDate(today.getDate() + 1);
    const expected = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0')
    ].join('-');
    t.equal(shiftDateString(null, 1), expected);
    t.equal(shiftDateString('', 1), expected);
  });
  QUnit.test('invalid date string returns input unchanged', (t) => {
    t.equal(shiftDateString('not-a-date', 1), 'not-a-date');
  });
});

QUnit.module('limitUpView.renderLimitUpPage (date buttons)', (hooks) => {
  let root;
  hooks.beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });
  hooks.afterEach(() => {
    document.body.removeChild(root);
  });

  function buildState(over = {}) {
    let expandedCodes = new Set();
    const chartInstances = new Map();
    if (typeof over.chartCode === 'string' && over.chartCode) {
      expandedCodes = new Set([over.chartCode]);
      chartInstances.set(over.chartCode, {
        ctl: null,
        period: over.chartPeriod || '1d',
        klineData: over.chartKlineData || null,
        loading: !!over.chartLoading,
        error: over.chartError || null,
        abort: null
      });
    }
    return Object.assign(
      {
        items: [],
        groups: [],
        lastUpdate: null,
        loading: false,
        error: null,
        refreshInterval: 30000,
        sortKey: 'amount',
        selectedCodes: new Set(),
        selectedDate: null,
        latestTradingDate: '2026-06-05',
        previousTradingDate: null,
        nextTradingDate: null,
        expandedCodes,
        chartInstances,
      },
      over
    );
  }

  function buildCallbacks() {
    return {
      navigateTo: () => {},
      addToWatchListAndNavigate: () => {},
      onRefreshChange: () => {},
      fetchList: () => {},
      onLiveTickUpdate: () => {},
      onSortChange: () => {},
      toggleSelect: () => {},
      selectAll: () => {},
      selectNone: () => {},
      addSelectedAndNavigate: () => {},
      openKline: () => {},
      closeKline: () => {},
      changeKlinePeriod: () => {},
      onDateChange: () => {}
    };
  }

  QUnit.test('renders "前一天" and "后一天" buttons', (t) => {
    renderLimitUpPage(root, buildState(), buildCallbacks());
    t.notEqual(root.querySelector('#lu-date-prev'), null, 'has prev button');
    t.notEqual(root.querySelector('#lu-date-next'), null, 'has next button');
    t.notEqual(root.querySelector('#lu-date-today'), null, 'has today button');
  });

  QUnit.test('"后一天" button is disabled when selectedDate is today', (t) => {
    renderLimitUpPage(root, buildState(), buildCallbacks());
    const nextBtn = root.querySelector('#lu-date-next');
    t.equal(nextBtn.disabled, true, 'next disabled on today');
  });

  QUnit.test('"后一天" button is enabled when nextTradingDate exists', (t) => {
    renderLimitUpPage(root, buildState({
      selectedDate: '2026-06-04',
      previousTradingDate: '2026-06-03',
      nextTradingDate: '2026-06-05'
    }), buildCallbacks());
    const nextBtn = root.querySelector('#lu-date-next');
    t.equal(nextBtn.disabled, false, 'next enabled on past date');
  });

  QUnit.test('clicking "前一天" calls onDateChange with previousTradingDate', (t) => {
    let captured = null;
    const cb = buildCallbacks();
    cb.onDateChange = (d) => { captured = d; };
    renderLimitUpPage(root, buildState({
      selectedDate: '2026-06-04',
      previousTradingDate: '2026-06-03',
      nextTradingDate: '2026-06-05'
    }), cb);
    root.querySelector('#lu-date-prev').click();
    t.equal(captured, '2026-06-03', `expected 2026-06-03, got ${captured}`);
  });

  QUnit.test('clicking "后一天" calls onDateChange with nextTradingDate', (t) => {
    let captured = null;
    const cb = buildCallbacks();
    cb.onDateChange = (d) => { captured = d; };
    renderLimitUpPage(root, buildState({
      selectedDate: '2026-06-04',
      previousTradingDate: '2026-06-03',
      nextTradingDate: '2026-06-05'
    }), cb);
    root.querySelector('#lu-date-next').click();
    t.equal(captured, '2026-06-05', `expected 2026-06-05, got ${captured}`);
  });

  QUnit.test('"今天" button calls onDateChange with latestTradingDate', (t) => {
    let captured = '__unset__';
    const cb = buildCallbacks();
    cb.onDateChange = (d) => { captured = d; };
    renderLimitUpPage(root, buildState({
      selectedDate: '2026-06-04',
      latestTradingDate: '2026-06-05'
    }), cb);
    root.querySelector('#lu-date-today').click();
    t.equal(captured, '2026-06-05', `expected 2026-06-05, got ${captured}`);
  });
});
