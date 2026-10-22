/**
 * NumberStepper 取值归一 + 层数允许小数（纯函数）。
 * 运行：npx vite-node scripts/test-number-stepper.mjs
 *
 * 背景（2026-10-22 用户口径）：音擎层数类增益要能填 2 位小数（1.33 / 1.66），
 * 但「± 按钮仍按 1 层」；同时要求填整数时行为完全不变（整数不会因为放开精度变成小数）。
 */
import {
  clampToStep,
  resolveButtonStep,
  snapToStep,
  stepDecimals,
} from '../src/utils/numberInputStep.ts'
import { normalizeBuffEffect, resolveEffectBaseValue } from '../src/utils/buffEffect.ts'

let passed = 0
let failed = 0
function check(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('\n[1] stepDecimals：精度由 step 决定')
{
  check('step=1 → 0 位', stepDecimals(1) === 0)
  check('step=0.01 → 2 位', stepDecimals(0.01) === 2)
  check('step=0.1 → 1 位', stepDecimals(0.1) === 1)
  check('step=0.0001 → 4 位（数值框现状）', stepDecimals(0.0001) === 4)
  check('非法 step → 按整数', stepDecimals(0) === 0 && stepDecimals(-1) === 0 && stepDecimals(NaN) === 0)
}

console.log('\n[2] step=1（旧行为不变）：四舍五入到整数')
{
  check('1.4 → 1', snapToStep(1.4, 1) === 1)
  check('1.5 → 2', snapToStep(1.5, 1) === 2)
  check('2 → 2', snapToStep(2, 1) === 2)
}

console.log('\n[3] step=0.01：2 位小数，整数仍是整数')
{
  check('1.33 原样保留', snapToStep(1.33, 0.01) === 1.33)
  check('1.66 原样保留', snapToStep(1.66, 0.01) === 1.66)
  check('1/3 → 0.33', snapToStep(1 / 3, 0.01) === 0.33)
  check('5/3 → 1.67', snapToStep(5 / 3, 0.01) === 1.67)
  check('0.005 向上进位到 0.01', snapToStep(0.005, 0.01) === 0.01)
  const two = snapToStep(2, 0.01)
  check('整数 2 归一后仍是整数', Number.isInteger(two) && two === 2)
  check('整数 2 的 JSON 仍是 2（不是 2.0）', JSON.stringify(two) === '2')
  check('整数 10 归一后仍是整数', Number.isInteger(snapToStep(10, 0.01)))
}

console.log('\n[4] clampToStep：上下限仍然生效')
{
  check('上限 2 + 填 2.5 → 2', clampToStep(2.5, 0, 2, 0.01) === 2)
  check('下限 0 + 填 -0.5 → 0', clampToStep(-0.5, 0, 99, 0.01) === 0)
  check('下限 1 + 填 0.5 → 1（最大层数最小为 1）', clampToStep(0.5, 1, 99, 0.01) === 1)
  check('NaN → 取下限', clampToStep(NaN, 0, 99, 0.01) === 0)
  check('区间内 + 2 位 → 夹紧后仍保留 2 位', clampToStep(1.337, 0, 99, 0.01) === 1.34)
}

console.log('\n[5] resolveButtonStep：按钮步进与输入精度解耦')
{
  check('精度 0.01 + 按钮 1 → 按钮 1', resolveButtonStep(0.01, 1) === 1)
  check('精度 0.01、没给按钮步长 → 跟 step（旧行为）', resolveButtonStep(0.01) === 0.01)
  check('转模框 step=10 没给按钮 → 10（不变）', resolveButtonStep(10) === 10)
  check('按钮步长非法/0 → 回退到 step', resolveButtonStep(0.01, 0) === 0.01 && resolveButtonStep(0.01, NaN) === 0.01)
}

console.log('\n[6] 计算侧：小数层数直接参与乘法')
{
  const stacked = { kind: 'stacked', valuePerStack: 7, maxStacks: 4, value: 0 }
  check('7 × 1.33 = 9.31', Math.abs(resolveEffectBaseValue(stacked, 1.33) - 9.31) < 1e-9)
  check('7 × 2 = 14（整数不受影响）', resolveEffectBaseValue(stacked, 2) === 14)
  check('0 层 = 0', resolveEffectBaseValue(stacked, 0) === 0)
  const capped = { kind: 'stacked', valuePerStack: 7, maxStacks: 2, value: 0 }
  check('超出最大层数仍夹到上限（现行行为）', resolveEffectBaseValue(capped, 2.5) === 14)
  const fracMax = { kind: 'stacked', valuePerStack: 7, maxStacks: 2.5, value: 0 }
  check('最大层数 2.5 生效：3 层 → 17.5', Math.abs(resolveEffectBaseValue(fracMax, 3) - 17.5) < 1e-9)
}

console.log('\n[7] 数据归一：小数不退化成整数、整数不变形')
{
  const a = normalizeBuffEffect({ id: 'e1', kind: 'stacked', stat: 'dmgBonus', valuePerStack: 7, maxStacks: 2.5, defaultStacks: 1.33 })
  check('maxStacks 2.5 保留', a?.maxStacks === 2.5)
  check('defaultStacks 1.33 保留', a?.defaultStacks === 1.33)
  const b = normalizeBuffEffect({ id: 'e2', kind: 'stacked', stat: 'dmgBonus', valuePerStack: 7, maxStacks: 2, defaultStacks: 2 })
  check('整数层数不变形', b?.maxStacks === 2 && b?.defaultStacks === 2)
  check('整数层数 JSON 仍是 2', JSON.stringify(b?.defaultStacks) === '2')
  const c = normalizeBuffEffect({ id: 'e3', kind: 'stacked', stat: 'dmgBonus', valuePerStack: 7, maxStacks: 0.5, defaultStacks: 0.5 })
  check('maxStacks 下限仍为 1（0.5 → 1）', c?.maxStacks === 1)
  check('defaultStacks 0.5 保留', c?.defaultStacks === 0.5)
}

console.log(`\n结果：${passed} passed / ${failed} failed`)
if (failed) process.exitCode = 1
