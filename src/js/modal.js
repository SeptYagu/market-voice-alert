// 非阻塞自定义确认对话框，替代阻塞主线程的 window.confirm

let activeModalCleanup = null;

export function showConfirmModal(message, options = {}) {
  if (typeof document === 'undefined' || !document.body) {
    return Promise.resolve(true);
  }

  // If another modal is already open, cancel it first
  if (activeModalCleanup) {
    activeModalCleanup(false);
  }

  const {
    title = '提示',
    confirmText = '确定',
    cancelText = '取消',
    danger = true
  } = options;

  return new Promise((resolve) => {
    const prevActiveElement = document.activeElement;

    const overlay = document.createElement('div');
    overlay.className = 'app-modal-backdrop';
    overlay.setAttribute('role', 'presentation');

    const dialog = document.createElement('div');
    dialog.className = 'app-modal-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'app-modal-title');
    dialog.setAttribute('aria-describedby', 'app-modal-message');

    const header = document.createElement('div');
    header.className = 'app-modal-header';
    const titleEl = document.createElement('h3');
    titleEl.id = 'app-modal-title';
    titleEl.className = 'app-modal-title';
    titleEl.textContent = title;
    header.appendChild(titleEl);

    const body = document.createElement('div');
    body.id = 'app-modal-message';
    body.className = 'app-modal-body';
    body.textContent = message;

    const footer = document.createElement('div');
    footer.className = 'app-modal-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'app-modal-btn btn-secondary';
    cancelBtn.textContent = cancelText;

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = `app-modal-btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    confirmBtn.textContent = confirmText;

    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);

    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    let isSettled = false;

    const cleanup = (result) => {
      if (isSettled) return;
      isSettled = true;
      activeModalCleanup = null;
      document.removeEventListener('keydown', handleKeydown, true);
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      if (prevActiveElement && typeof prevActiveElement.focus === 'function') {
        try { prevActiveElement.focus(); } catch { /* ignore */ }
      }
      resolve(result);
    };

    activeModalCleanup = cleanup;

    function handleKeydown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cleanup(false);
      } else if (e.key === 'Enter') {
        if (document.activeElement === cancelBtn) {
          e.preventDefault();
          cleanup(false);
        } else {
          e.preventDefault();
          cleanup(true);
        }
      }
    }

    document.addEventListener('keydown', handleKeydown, true);

    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      cleanup(false);
    });

    confirmBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      cleanup(true);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        cleanup(false);
      }
    });

    // Auto-focus confirm button
    try {
      confirmBtn.focus();
    } catch {
      /* ignore */
    }
  });
}
