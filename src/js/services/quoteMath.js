/**
 * 分时图成交量加权平均价 (VWAP) 与行情数学纯函数服务
 */

/**
 * 计算分时图成交量加权平均价 (VWAP)
 * @param {number} cumAmount - 累计成交额 (元)
 * @param {number} cumVolume - 累计成交量
 * @param {number} closePrice - 当前收盘价/现价
 * @param {boolean} [isLotUnit=false] - 是否以手 (100股) 为成交量单位
 * @returns {number} 均价，若不合法或超出合理倍数 (0.1~10倍现价) 则返回 0
 */
export function computeVwap(cumAmount, cumVolume, closePrice, isLotUnit = false) {
  const vol = Number(cumVolume);
  const amt = Number(cumAmount);
  const price = Number(closePrice);
  if (!Number.isFinite(vol) || !Number.isFinite(amt) || !Number.isFinite(price) || vol <= 0 || amt <= 0 || price <= 0) {
    return 0;
  }
  const divisor = isLotUnit ? vol * 100 : vol;
  const ratio = amt / divisor;
  if (ratio >= price * 0.1 && ratio <= price * 10) {
    return Math.round(ratio * 1000) / 1000;
  }
  if (!isLotUnit && (ratio / 100) >= price * 0.1 && (ratio / 100) <= price * 10) {
    return Math.round((ratio / 100) * 1000) / 1000;
  }
  return 0;
}
