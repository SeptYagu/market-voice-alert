import './style.css';
import { startApp } from './js/app.js';

function boot() {
  const root = document.getElementById('app');
  if (!root) {
    console.error('#app element not found');
    return;
  }
  startApp(root);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
