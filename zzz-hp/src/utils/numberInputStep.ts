/**
 * `NumberStepper` 的取值归一（纯函数，抽出来便于测试与复用）。
 *
 * 语义与组件原来内联的实现一致：
 * - `step` 决定**小数位数**（1 → 整数，0.01 → 2 位，0.0001 → 4 位），输入按格点四舍五入；
 * - 整数输入归一后仍是整数（`2` 不会变成 `2.0`），所以整数条目不受"放开小数"影响；
 * - `buttonStep` 只影响 ± 按钮的步进，不改变输入框精度；没给就跟 `step` 走（各处旧行为不变）。
 */

/** `step` 的小数位数：1 → 0、0.01 → 2、0.0001 → 4；非法 / 非正按 0（整数）处理 */
export function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0
  const text = String(step)
  if (/e/i.test(text)) return 6
  const idx = text.indexOf('.')
  return idx === -1 ? 0 : text.length - idx - 1
}

/** 按 `step` 的小数位归一到最接近的格点 */
export function snapToStep(value: number, step: number): number {
  const decimals = stepDecimals(step)
  if (decimals <= 0) return Math.round(value)
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/** 先夹到 `[min, max]`，再按 `step` 归一 */
export function clampToStep(value: number, min: number, max: number, step: number): number {
  const n = Number.isFinite(value) ? value : min
  return snapToStep(Math.min(max, Math.max(min, n)), step)
}

/** ± 按钮的步长：显式给了正的 `buttonStep` 就用它，否则跟 `step` 走 */
export function resolveButtonStep(step: number, buttonStep?: number): number {
  return buttonStep != null && Number.isFinite(buttonStep) && buttonStep > 0 ? buttonStep : step
}
