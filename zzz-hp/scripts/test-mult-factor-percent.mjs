// Run: npx vite-node scripts/test-mult-factor-percent.mjs
import assert from 'node:assert/strict'
import {
  combineMultFactorPercent,
  normalizeBuffMultFactorDelta,
  normalizePanelMultFactorPercent,
} from '../src/utils/multFactorPercent.ts'

// Buff 增量：一律百分点，不再对 |x|≤5 非整数 ×100
assert.equal(normalizeBuffMultFactorDelta(0.5), 0.5, '小数百分点 0.5 应原样保留')
assert.equal(normalizeBuffMultFactorDelta(1.5), 1.5, '小数百分点 1.5 应原样保留')
assert.equal(normalizeBuffMultFactorDelta(-0.5), -0.5, '负小数百分点应原样保留')
assert.equal(normalizeBuffMultFactorDelta(5), 5, '整数 5 应原样保留')
assert.equal(normalizeBuffMultFactorDelta(5.1), 5.1, '5.1 应原样保留')
assert.equal(normalizeBuffMultFactorDelta(-75), -75, '蕾米特殊修正 -75 应原样保留')
assert.equal(normalizeBuffMultFactorDelta(20), 20, '整数百分点 20 应原样保留')
assert.equal(normalizeBuffMultFactorDelta(0), 0)
assert.equal(normalizeBuffMultFactorDelta(null), 0)
assert.equal(normalizeBuffMultFactorDelta(undefined), 0)
assert.equal(normalizeBuffMultFactorDelta(Number.NaN), 0)

// 面板基数启发式本轮不动：≤10 仍 ×100
assert.equal(normalizePanelMultFactorPercent(1), 100)
assert.equal(normalizePanelMultFactorPercent(1.2), 120)
assert.equal(normalizePanelMultFactorPercent(100), 100)

// 合成：面板 100 + 小数百分点增量
assert.equal(combineMultFactorPercent(100, 0.5), 100.5, '0.5pp → 合成 100.5')
assert.equal(combineMultFactorPercent(100, 1.5), 101.5, '1.5pp → 合成 101.5')
assert.equal(combineMultFactorPercent(100, -75), 25, '-75pp → 合成 25')
assert.equal(combineMultFactorPercent(100, 20), 120, '+20pp → 合成 120')
assert.equal(combineMultFactorPercent(1, 0), 100, '旧面板乘数 1 仍迁为 100')

console.log('test-mult-factor-percent: ok')
