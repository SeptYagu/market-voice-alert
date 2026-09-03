import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseSinaFuture } from '../src/js/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures', 'futures');

QUnit.module('Futures Parser with Real Fixtures');

QUnit.test('parseSinaFuture parses real commodity futures (RB0)', (assert) => {
  const text = fs.readFileSync(path.join(fixturesDir, 'sina_spot_commodity.txt'), 'utf8');
  const quotes = parseSinaFuture(text);

  assert.equal(quotes.length, 1, 'parsed 1 quote');
  const q = quotes[0];
  assert.equal(q.code, 'rb0', 'code is normalized to canonical lowercase rb0 without nf_ prefix');
  assert.equal(q.name, '螺纹钢连续', 'name is 螺纹钢连续');
  assert.equal(q.price, 3156, 'current price is 3156');
  assert.equal(q.prevSettlement, 3137, 'prevSettlement is 3137');
  assert.equal(q.openInterest, 1467749, 'openInterest matches hold f[13]');
  assert.equal(q.volume, 245269, 'volume matches f[14]');
  assert.equal(q.open, 3145, 'open matches f[2]');
  assert.equal(q.high, 3158, 'high matches f[3]');
  assert.equal(q.low, 3137, 'low matches f[4]');
  assert.ok(q.change > 0, 'change is positive relative to prevSettlement');
  assert.equal(q.change, 19, 'change is 3156 - 3137 = 19');
});

QUnit.test('parseSinaFuture parses real financial futures (IF0)', (assert) => {
  const text = fs.readFileSync(path.join(fixturesDir, 'sina_spot_financial.txt'), 'utf8');
  const quotes = parseSinaFuture(text);

  assert.equal(quotes.length, 1, 'parsed 1 quote');
  const q = quotes[0];
  assert.equal(q.code, 'if0', 'code is normalized to canonical lowercase if0 without nf_ prefix');
  assert.equal(q.name, '沪深300指数期货连续', 'financial name correctly extracted');
  assert.equal(q.price, 4536.8, 'price is 4536.8');
  assert.equal(q.open, 4541, 'open is 4541');
  assert.equal(q.high, 4561.2, 'high is 4561.2');
  assert.equal(q.low, 4510.4, 'low is 4510.4');
  assert.equal(q.prevClose, 4530.4, 'prevClose is 4530.4');
  assert.equal(q.openInterest, 131612, 'openInterest matches hold');
  assert.equal(q.volume, 59047, 'volume matches');
  assert.equal(q.type, 'future', 'type is future');
});
