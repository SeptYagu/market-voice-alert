// 批量代码解析与导出服务
import { normalizeCode } from '../parser.js';
import { parseFutureInput, isFutureCode } from '../futures/instrument.js';
import { stripPrefix } from '../format.js';

export function normalizeFuture(input) {
  if (!input || typeof input !== 'string') return null;
  const inst = parseFutureInput(input);
  if (inst) return inst.symbol.toLowerCase();
  const raw = input.trim().toLowerCase();
  if (/^nf\d{4}$/.test(raw)) return raw;
  return null;
}

export function isBatchQuery(raw) {
  if (!raw || typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  // Contains comma (English or Chinese)
  if (trimmed.includes(',') || trimmed.includes('，')) return true;
  // Contains internal whitespace (spaces, tabs, newlines)
  if (/\s/.test(trimmed)) return true;
  return false;
}

export function parseBatchInput(input, { allowWhitespace = true } = {}) {
  if (!input || typeof input !== 'string') return [];
  const splitter = allowWhitespace ? /[,，\s]+/ : /[,， ]+/;
  const tokens = input.split(splitter);
  const seen = new Set();
  const out = [];
  for (const tok of tokens) {
    if (!tok) continue;
    const norm = normalizeFuture(tok) || normalizeCode(tok);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

export function parseBatchInputDetails(input, currentWatchList = []) {
  if (!input || typeof input !== 'string') {
    return {
      validCodes: [],
      newCodes: [],
      duplicateCodes: [],
      invalidTokens: [],
      totalTokens: 0
    };
  }

  const existingSet = new Set(Array.isArray(currentWatchList) ? currentWatchList.map((c) => String(c).toLowerCase()) : []);
  const rawTokens = input.trim().split(/[,，\s]+/);
  const tokens = rawTokens.map((t) => t.trim()).filter(Boolean);

  const seenValid = new Set();
  const validCodes = [];
  const newCodes = [];
  const duplicateCodes = [];
  const invalidTokens = [];

  for (const tok of tokens) {
    const norm = normalizeFuture(tok) || normalizeCode(tok);
    if (norm) {
      if (!seenValid.has(norm)) {
        seenValid.add(norm);
        validCodes.push(norm);
        if (existingSet.has(norm)) {
          duplicateCodes.push(norm);
        } else {
          newCodes.push(norm);
        }
      } else {
        duplicateCodes.push(norm);
      }
    } else {
      invalidTokens.push(tok);
    }
  }

  return {
    validCodes,
    newCodes,
    duplicateCodes,
    invalidTokens,
    totalTokens: tokens.length
  };
}

export function buildExportText(codes) {
  return (codes || []).map(stripPrefix).filter(Boolean).join('\n');
}

export function buildExportCsv(codes, quotesMap) {
  const header = ['代码', '名称', '现价', '涨跌幅(%)', '开盘价', '成交量', '成交额/持仓量', '类型'];
  const rows = [header.join(',')];
  for (const code of codes || []) {
    if (!code) continue;
    const q = quotesMap && typeof quotesMap.get === 'function' ? quotesMap.get(code) : null;
    const isFuture = q ? (q.type === 'future' || isFutureCode(code)) : isFutureCode(code);
    const displayCode = isFuture ? code.toUpperCase() : stripPrefix(code);
    let rawName = (q && q.name) ? String(q.name) : displayCode;
    if (/^[=+\-@\t\r]/.test(rawName)) rawName = `'${rawName}`;
    const name = `"${rawName.replace(/"/g, '""')}"`;
    const decimals = isFuture && q && q.priceTick && q.priceTick < 0.01 ? 3 : 2;
    const price = q && Number.isFinite(Number(q.price)) ? Number(q.price).toFixed(decimals) : '';
    const pct = q && Number.isFinite(Number(q.changePercent)) ? Number(q.changePercent).toFixed(2) : '';
    const open = q && Number.isFinite(Number(q.open)) ? Number(q.open).toFixed(decimals) : '';
    const vol = q && Number.isFinite(Number(q.volume)) ? Math.round(Number(q.volume)) : '';
    const amount = q && Number.isFinite(Number(q.amount)) ? Number(q.amount) : '';
    const type = isFuture ? '期货' : '股票';
    rows.push([displayCode, name, price, pct, open, vol, amount, type].join(','));
  }
  return '\uFEFF' + rows.join('\r\n');
}

export function downloadText(text, filename) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const mime = filename.endsWith('.csv') ? 'text/csv;charset=utf-8;' : 'text/plain;charset=utf-8';
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
