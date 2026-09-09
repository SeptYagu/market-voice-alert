(() => {
  const $ = id => document.getElementById(id);
  const names = { server: '服务器', upstream: '上游', browser: '浏览器上报', error: '错误', warning: '警告', info: '信息', http: 'HTTP 失败', network: '网络异常', timeout: '请求超时', runtime: '运行异常', rejection: '未处理 Promise', resource: '资源加载失败', console: '控制台报错/警告', startup: '服务启动' };
  let data = null;
  let loading = false;
  function render() {
    const rows = (data?.entries || []).filter(e => (!$('source').value || e.source === $('source').value) && (!$('level').value || e.level === $('level').value) && `${e.location} ${e.status} ${e.errorCode} ${e.errorName} ${names[e.kind]}`.toLowerCase().includes($('search').value.toLowerCase()));
    $('entries').replaceChildren();
    for (const e of rows) {
      const tr = document.createElement('tr');
      for (const value of [new Date(e.time).toLocaleString(), names[e.source], names[e.level], [names[e.kind], e.errorName, e.errorCode].filter(Boolean).join(' · '), e.location + (e.line ? `:${e.line}` : ''), e.status || '—', e.count]) {
        const td = document.createElement('td'); td.textContent = String(value); tr.append(td);
      }
      $('entries').append(tr);
    }
    if (!rows.length) {
      const td = document.createElement('td'); td.colSpan = 7;
      td.textContent = '当前没有符合条件的记录；没有日志并不保证所有功能正常。';
      const tr = document.createElement('tr'); tr.append(td); $('entries').append(tr);
    }
  }
  async function refresh() {
    if (loading) return;
    loading = true; $('refresh').disabled = true;
    try {
      const response = await fetch('/api/cache/diagnostics', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = await response.json();
      if (!Array.isArray(next.entries)) throw new Error('日志接口未部署或返回格式不正确');
      data = next; render();
      $('status').textContent = `服务器版本 ${data.version} · 已运行 ${Math.floor(data.uptimeSeconds / 60)} 分钟 · ${data.entries.length} 组 · 更新于 ${new Date().toLocaleTimeString()}${data.persistenceError ? ' · 日志写盘失败，目前仅保存在内存' : ''}`;
    } catch (e) { $('status').textContent = `读取失败：${e.message}。${data ? '保留上次数据。' : ''}请确认后端与反向代理已更新；服务离线时本页也无法读取日志。`; }
    finally { loading = false; $('refresh').disabled = false; }
  }
  for (const id of ['source', 'level', 'search']) $(id).addEventListener('input', render);
  $('refresh').onclick = refresh;
  $('export').onclick = () => {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'market-diagnostics.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  setInterval(() => { if ($('auto').checked && !document.hidden) void refresh(); }, 10000);
  void refresh();
})();
