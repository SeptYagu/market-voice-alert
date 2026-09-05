import { showConfirmModal } from '../src/js/modal.js';

QUnit.module('modal.showConfirmModal', (hooks) => {
  hooks.afterEach(() => {
    const backdrop = document.querySelector('.app-modal-backdrop');
    if (backdrop && backdrop.parentNode) {
      backdrop.parentNode.removeChild(backdrop);
    }
  });

  QUnit.test('renders modal dialog with accessible attributes', async (t) => {
    const promise = showConfirmModal('确定删除选中的 3 个标的？', {
      title: '删除确认',
      confirmText: '确定删除',
      cancelText: '取消',
      danger: true
    });

    const backdrop = document.querySelector('.app-modal-backdrop');
    t.ok(backdrop, 'backdrop mounted in DOM');

    const dialog = backdrop.querySelector('.app-modal-dialog');
    t.equal(dialog.getAttribute('role'), 'dialog', 'role is dialog');
    t.equal(dialog.getAttribute('aria-modal'), 'true', 'aria-modal is true');

    const title = dialog.querySelector('.app-modal-title');
    t.equal(title.textContent, '删除确认', 'title matches');

    const body = dialog.querySelector('.app-modal-body');
    t.equal(body.textContent, '确定删除选中的 3 个标的？', 'message matches');

    const confirmBtn = dialog.querySelector('.app-modal-btn.btn-danger');
    t.equal(confirmBtn.textContent, '确定删除', 'confirm button text matches');

    const cancelBtn = dialog.querySelector('.app-modal-btn.btn-secondary');
    t.equal(cancelBtn.textContent, '取消', 'cancel button text matches');

    confirmBtn.click();
    const result = await promise;
    t.true(result, 'resolves true on confirm click');
    t.notOk(document.querySelector('.app-modal-backdrop'), 'backdrop removed from DOM');
  });

  QUnit.test('cancel button resolves false and removes DOM', async (t) => {
    const promise = showConfirmModal('测试取消');
    const cancelBtn = document.querySelector('.app-modal-btn.btn-secondary');
    t.ok(cancelBtn, 'cancel button exists');

    cancelBtn.click();
    const result = await promise;
    t.false(result, 'resolves false on cancel click');
    t.notOk(document.querySelector('.app-modal-backdrop'), 'backdrop removed from DOM');
  });

  QUnit.test('Escape key cancels modal', async (t) => {
    const promise = showConfirmModal('测试 ESC');
    const ev = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    document.dispatchEvent(ev);

    const result = await promise;
    t.false(result, 'resolves false on ESC');
    t.notOk(document.querySelector('.app-modal-backdrop'), 'backdrop removed from DOM');
  });

  QUnit.test('Enter key confirms normal modal', async (t) => {
    const promise = showConfirmModal('测试 Enter');
    const ev = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    document.dispatchEvent(ev);

    const result = await promise;
    t.true(result, 'resolves true on Enter');
    t.notOk(document.querySelector('.app-modal-backdrop'), 'backdrop removed from DOM');
  });

  QUnit.test('danger modal focuses cancel button and Enter cancels', async (t) => {
    const promise = showConfirmModal('测试 Danger Enter', { danger: true });
    const ev = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    document.dispatchEvent(ev);

    const result = await promise;
    t.false(result, 'resolves false on Enter when danger: true');
    t.notOk(document.querySelector('.app-modal-backdrop'), 'backdrop removed from DOM');
  });

  QUnit.test('backdrop click cancels modal', async (t) => {
    const promise = showConfirmModal('测试遮罩点击');
    const backdrop = document.querySelector('.app-modal-backdrop');
    backdrop.click();

    const result = await promise;
    t.false(result, 'resolves false on backdrop click');
    t.notOk(document.querySelector('.app-modal-backdrop'), 'backdrop removed from DOM');
  });
});
