import {
  buildWatchHeaderCheckbox,
  updateWatchHeaderCheckbox,
  renderRow,
  renderTableView,
  updateRowQuoteCells
} from '../src/js/views/monitorTableView.js';

QUnit.module('views.monitorTableView', (hooks) => {
  let root;

  hooks.beforeEach(() => {
    root = document.createElement('div');
    root.id = 'table-wrap';
    document.body.appendChild(root);
  });

  hooks.afterEach(() => {
    if (root && root.parentNode) root.parentNode.removeChild(root);
  });

  QUnit.test('buildWatchHeaderCheckbox generates checkbox with correct checked and indeterminate state', (t) => {
    let selectAllTriggered = false;
    let selectNoneTriggered = false;
    const watchList = ['sh600519', 'sz000001'];

    // 0 selected
    const inputEmpty = buildWatchHeaderCheckbox(watchList, new Set(), () => { selectAllTriggered = true; }, () => { selectNoneTriggered = true; });
    t.false(inputEmpty.checked);
    t.false(inputEmpty.indeterminate);

    // 1 of 2 selected -> indeterminate
    const inputPartial = buildWatchHeaderCheckbox(watchList, new Set(['sh600519']), () => {}, () => {});
    t.false(inputPartial.checked);
    t.true(inputPartial.indeterminate);

    // 2 of 2 selected -> checked
    const inputFull = buildWatchHeaderCheckbox(watchList, new Set(['sh600519', 'sz000001']), () => { selectAllTriggered = true; }, () => { selectNoneTriggered = true; });
    t.true(inputFull.checked);
    t.false(inputFull.indeterminate);

    inputEmpty.checked = true;
    inputEmpty.dispatchEvent(new window.Event('change'));
    t.true(selectAllTriggered);

    inputFull.checked = false;
    inputFull.dispatchEvent(new window.Event('change'));
    t.true(selectNoneTriggered);
  });

  QUnit.test('renderTableView renders empty state when watchList is empty', (t) => {
    renderTableView(root, { watchList: [] });
    const emptyEl = root.querySelector('.empty');
    t.ok(emptyEl, 'renders .empty element');
    t.true(emptyEl.textContent.includes('空空如也'));
  });

  QUnit.test('renderTableView renders table with semantic data-field headers and rows', (t) => {
    const watchList = ['sh600519'];
    const quotesMap = new Map([
      ['sh600519', { code: 'sh600519', name: '贵州茅台', price: 1800, changePercent: 2.5, open: 1780, volumeRatio: 1.2, amount: 5000000000 }]
    ]);

    renderTableView(root, {
      watchList,
      quotesMap,
      selectedSet: new Set(),
      subscribedSet: new Set()
    });

    const table = root.querySelector('table.watch-table');
    t.ok(table, 'renders watch-table');

    const row = table.querySelector('tr[data-code="sh600519"]');
    t.ok(row, 'renders data row');

    t.ok(row.querySelector('td[data-field="price"]'), 'has price cell with data-field');
    t.equal(row.querySelector('td[data-field="name"]').textContent, '贵州茅台');
    t.equal(row.querySelector('td[data-field="price"]').textContent, '1800.00');
  });

  QUnit.test('updateWatchHeaderCheckbox updates DOM checkbox state', (t) => {
    const input = document.createElement('input');
    input.id = 'watch-select-all';
    root.appendChild(input);

    const watchList = ['sh600519', 'sz000001'];
    updateWatchHeaderCheckbox(watchList, new Set(['sh600519']));
    t.true(input.indeterminate);
    t.false(input.checked);

    updateWatchHeaderCheckbox(watchList, new Set(['sh600519', 'sz000001']));
    t.false(input.indeterminate);
    t.true(input.checked);
  });

  QUnit.test('renderRow constructs individual data row with accessibility attributes', (t) => {
    const row = renderRow('sh600519', false, {
      quotesMap: new Map([['sh600519', { code: 'sh600519', name: '茅台', price: 1800 }]])
    });
    t.equal(row.getAttribute('role'), 'button');
    t.equal(row.getAttribute('aria-expanded'), 'false');
    t.equal(row.getAttribute('data-code'), 'sh600519');
  });

  QUnit.test('updateRowQuoteCells updates quote cells in place via data-field', (t) => {
    const watchList = ['sh600519'];
    const quotesMap = new Map([
      ['sh600519', { code: 'sh600519', name: '贵州茅台', price: 1800, changePercent: 2.5, open: 1780, volumeRatio: 1.2, amount: 5000000000 }]
    ]);

    renderTableView(root, {
      watchList,
      quotesMap
    });

    const newQuote = {
      code: 'sh600519',
      name: '贵州茅台',
      price: 1850,
      changePercent: 5.3,
      open: 1780,
      volumeRatio: 1.8,
      amount: 6000000000
    };

    updateRowQuoteCells('sh600519', newQuote);

    const priceCell = root.querySelector('tr[data-code="sh600519"] td[data-field="price"]');
    t.equal(priceCell.textContent, '1850.00');

    const percentCell = root.querySelector('tr[data-code="sh600519"] td[data-field="percent"]');
    t.equal(percentCell.textContent, '+5.30%');
  });
});
