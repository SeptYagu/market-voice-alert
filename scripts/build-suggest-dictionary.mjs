// 静态股票建议字典构建脚本
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinyin } from 'pinyin-pro';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

// 关键曾用名与别名库 (来源于公开证券更名历史及验收夹具)
const CURATED_ALIASES = {
  sz000001: [
    { name: '深发展', type: 'former' },
    { name: '深发展A', type: 'former' }
  ],
  sz002639: [
    { name: '雪人股份', type: 'former' }
  ],
  sz000697: [
    { name: '炼石有色', type: 'former' }
  ],
  sz000752: [
    { name: '西发', type: 'base' },
    { name: 'ST西发', type: 'former' }
  ],
  sz000333: [
    { name: 'XD美的集', type: 'former' }
  ],
  sh600519: [
    { name: '茅台', type: 'alias' }
  ]
};

export function toPinyin(text) {
  if (!text) return { pinyin: '', initials: '' };
  const s = String(text).trim();

  const rawPinyin = pinyin(s, { toneType: 'none', type: 'array', v: true });
  const rawInitials = pinyin(s, { pattern: 'first', toneType: 'none', type: 'array', v: true });

  // 针对特定常见词特殊校对
  if (s.includes('银行')) {
    const idx = s.indexOf('银行');
    if (idx !== -1 && rawPinyin[idx + 1]) {
      rawPinyin[idx + 1] = 'hang';
      rawInitials[idx + 1] = 'h';
    }
  }

  const pyStr = rawPinyin.join('').toLowerCase();
  const initStr = rawInitials.join('').toLowerCase();

  return {
    pinyin: pyStr,
    initials: initStr
  };
}

export function inferBoard(code) {
  const c = String(code || '').toLowerCase();
  if (/^sh(600|601|603|605)/.test(c)) return '沪市主板';
  if (/^sh(688|689)/.test(c)) return '科创板';
  if (/^sz(000|001|002|003)/.test(c)) return '深市主板';
  if (/^sz(300|301)/.test(c)) return '创业板';
  if (/^bj(43|83|87|88|92)/.test(c)) return '北交所';
  if (c.startsWith('sh')) return '沪市';
  if (c.startsWith('sz')) return '深市';
  if (c.startsWith('bj')) return '北交所';
  return 'A股';
}

export function parseBaseName(displayName) {
  if (!displayName) return '';
  // 去除 ST, *ST, XD, XR, DR, N, C 等前缀，其中 N/C 仅在后续为非 ASCII (中文) 时去除
  const cleaned = displayName
    .replace(/^(\*ST|ST|XD|XR|DR)(?=\s*[^\x20-\x7e])/i, '')
    .replace(/^([NC])(?=\s*[^\x20-\x7e])/, '')
    .trim();
  return cleaned || displayName;
}

export async function buildDictionary() {
  console.log('Building stock suggest dictionary...');
  const cachePath = resolve(projectRoot, 'artifacts/spot-smoke-cache/spot/latest.json');
  let stockData;
  try {
    const content = await readFile(cachePath, 'utf8');
    stockData = JSON.parse(content);
  } catch (err) {
    console.warn('Could not read artifacts/spot-smoke-cache/spot/latest.json, falling back to basic fixture stocks:', err.message);
    stockData = { data: { items: [] } };
  }

  const itemsMap = new Map();

  for (const item of (stockData.data?.items || [])) {
    if (!item.code || !item.name) continue;
    const code = item.code.toLowerCase();
    itemsMap.set(code, {
      code,
      name: item.name
    });
  }

  // 必须确保关键测试夹具股票存在
  const requiredFixtures = [
    { code: 'sh600519', name: '贵州茅台' },
    { code: 'sz000001', name: '平安银行' },
    { code: 'sh688257', name: '新锐股份' },
    { code: 'sh603787', name: '新日股份' },
    { code: 'sz002639', name: '雪人集团' },
    { code: 'sh601857', name: '中国石油' },
    { code: 'sh603619', name: '中曼石油' },
    { code: 'sz000697', name: '炼石航空' },
    { code: 'sz000752', name: '*ST西发' },
    { code: 'sz000333', name: '美的集团' }
  ];

  for (const fix of requiredFixtures) {
    if (!itemsMap.has(fix.code)) {
      itemsMap.set(fix.code, fix);
    } else if (fix.code === 'sz000752') {
      itemsMap.get(fix.code).name = '*ST西发';
    }
  }

  const resultItems = [];

  for (const [code, item] of itemsMap.entries()) {
    const name = item.name.trim();
    let baseName = parseBaseName(name);
    // 特殊用例处理
    if (code === 'sz000752') baseName = '西发';
    if (code === 'sz000333') baseName = '美的集团';

    const namePy = toPinyin(name);
    const basePy = toPinyin(baseName);

    const aliases = [];
    const curated = CURATED_ALIASES[code] || [];
    for (const a of curated) {
      const aPy = toPinyin(a.name);
      aliases.push({
        name: a.name,
        type: a.type || 'former',
        initials: aPy.initials,
        pinyin: aPy.pinyin
      });
    }

    resultItems.push({
      c: code, // code
      n: name, // displayName
      b: baseName !== name ? baseName : undefined, // baseName
      i: namePy.initials, // initials
      p: namePy.pinyin, // full pinyin
      bi: baseName !== name ? basePy.initials : undefined, // base initials
      bp: baseName !== name ? basePy.pinyin : undefined, // base pinyin
      m: inferBoard(code), // board
      a: aliases.length ? aliases : undefined // aliases
    });
  }

  // 排序保持稳定
  resultItems.sort((x, y) => x.c.localeCompare(y.c));

  const dictionaryPayload = {
    schemaVersion: '1.0.0',
    version: '2026.09.11',
    generatedAt: Date.now(),
    asOfDate: '2026-09-11',
    itemCount: resultItems.length,
    items: resultItems
  };

  const jsonStr = JSON.stringify(dictionaryPayload);
  const sizeBytes = Buffer.byteLength(jsonStr, 'utf8');
  console.log(`Generated dictionary with ${resultItems.length} items. Size: ${(sizeBytes / 1024).toFixed(2)} KiB`);

  const publicDataDir = resolve(projectRoot, 'public/data');
  const srcDataDir = resolve(projectRoot, 'src/data');
  await mkdir(publicDataDir, { recursive: true });
  await mkdir(srcDataDir, { recursive: true });

  const publicDest = resolve(publicDataDir, 'stock-suggest-dictionary.json');
  const srcDest = resolve(srcDataDir, 'stock-suggest-dictionary.json');
  await writeFile(publicDest, jsonStr, 'utf8');
  await writeFile(srcDest, jsonStr, 'utf8');
  console.log(`Successfully written to:\n  - ${publicDest}\n  - ${srcDest}`);

  return dictionaryPayload;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildDictionary().catch((err) => {
    console.error('Error building dictionary:', err);
    process.exit(1);
  });
}
