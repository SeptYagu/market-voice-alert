import { parseFutureInput, PRODUCT_MAP } from './contractCatalog.js';

export { parseFutureInput, PRODUCT_MAP };

export function isFutureCode(input) {
  return !!parseFutureInput(input);
}

export function normalizeFutureCode(input) {
  const parsed = parseFutureInput(input);
  return parsed ? parsed.symbol : null;
}

export function toSinaFutureSymbol(input) {
  const parsed = parseFutureInput(input);
  return parsed ? parsed.providerSymbols.sina : null;
}

export function formatFutureDisplayName(instrumentOrSymbol) {
  if (!instrumentOrSymbol) return '';
  if (typeof instrumentOrSymbol === 'object') {
    return instrumentOrSymbol.name || instrumentOrSymbol.symbol || '';
  }
  const parsed = parseFutureInput(instrumentOrSymbol);
  return parsed ? parsed.name : String(instrumentOrSymbol);
}
