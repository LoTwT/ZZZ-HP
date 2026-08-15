/**
 * 危局血量↔分数：沿对应表累计拐点分段线性插值
 *
 * 运行：npx vite-node scripts/test-crisis-hp-score-convert.mjs
 */
import {
  convertHpRatioToScore,
  convertScoreToHpRatio,
  FS_HP_RATIO_NORMAL,
} from '../src/data/crisisScoreHpTable.ts'

let failed = 0
const check = (name, actual, expected, eps = 1e-6) => {
  const ok = typeof expected === 'number' ? Math.abs(actual - expected) <= eps : actual === expected
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  期望 ${expected} 实际 ${actual}`}`)
}

console.log('=== 正常：拐点 ===')
check('0% → 0', convertHpRatioToScore('normal', 0).score, 0)
check('100% → 60000', convertHpRatioToScore('normal', 1).score, 60000)
check('第11管完 20.84% → 14200', convertHpRatioToScore('normal', 0.2084).score, 14200)
check('1.5w 节点 21.96% → 15000', convertHpRatioToScore('normal', 0.2196).score, 15000)
check('FS-HP 28.12% → 20000', convertHpRatioToScore('normal', FS_HP_RATIO_NORMAL).score, 20000)

console.log('\n=== 正常：节点切开第12管 ===')
const mid12 = convertHpRatioToScore('normal', 0.2266)
check('21.96%~23.36% 中点 → 15500', mid12.score, 15500, 0.6)
check('该段是第12管', mid12.row?.bar, 12)

console.log('\n=== 正常：反查 ===')
check('20000 → FS-HP', convertScoreToHpRatio('normal', 20000).hpRatio, FS_HP_RATIO_NORMAL)
check('15000 → 21.96%', convertScoreToHpRatio('normal', 15000).hpRatio, 0.2196)
check('0 → 0%', convertScoreToHpRatio('normal', 0).hpRatio, 0)

console.log('\n=== 困难：节点 ===')
check('13.68% → 5000', convertHpRatioToScore('hard', 0.1368).score, 5000)
check('28.21% → 15000', convertHpRatioToScore('hard', 0.2821).score, 15000)
check('39.41% → 25000', convertHpRatioToScore('hard', 0.3941).score, 25000)
check('25000 → 39.41%', convertScoreToHpRatio('hard', 25000).hpRatio, 0.3941)

if (failed) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nall passed')
