/** 计算器统一显示/折算精度（小数点后位数） */
export const CALC_NUMBER_PRECISION = 4

export function roundCalc(value: number, precision = CALC_NUMBER_PRECISION): number {
  if (!Number.isFinite(value)) return value
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

/**
 * 明确展示到指定小数位（默认 4 位）。
 * 整数且绝对值 < 1000 时不补小数位。
 */
export function formatCalcDecimal(value: number, precision = CALC_NUMBER_PRECISION): string {
  if (!Number.isFinite(value)) return String(value)
  if (Number.isInteger(value) && Math.abs(value) < 1000) {
    return value.toLocaleString('en-US')
  }
  const rounded = roundCalc(value, precision)
  if (Number.isInteger(rounded) && Math.abs(rounded) < 1000) {
    return rounded.toLocaleString('en-US')
  }
  return rounded.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: precision,
  })
}

/** 带符号的小数展示，转模/增益数值用 */
export function formatCalcSigned(value: number, precision = CALC_NUMBER_PRECISION): string {
  const rounded = roundCalc(value, precision)
  const body = formatCalcDecimal(Math.abs(rounded), precision)
  if (rounded > 0) return `+ ${body}`
  if (rounded < 0) return `-${body}`
  return formatCalcDecimal(0, precision)
}

/**
 * 公式左侧乘区因子（基础伤害、各类倍率区与期望基数）的展示：**不加千分号**、
 * 最多 `precision` 位小数（默认 3）。用户 2026-10-22：左侧要方便照抄复算，
 * 千分号与 4 位小数会和右侧「结果」混在一起看不出主次。
 * 箭头右侧的结果值不走这里，用「取整 + 千分号」。
 */
export function formatCalcPlain(value: number, precision = 3): string {
  if (!Number.isFinite(value)) return String(value)
  return String(roundCalc(value, precision))
}
