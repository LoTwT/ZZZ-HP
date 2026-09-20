/**
 * 敌方与环境的「来源标记」：选 Boss → boss_info/boss_record；用户手改 → manual（界面显示「参数已自定义」）
 *
 * 口径（用户 2026-09-20 确认）：选危局 Boss 按文本整表重算抗性是设计意图；但用户改过之后要显示成自定义。
 * 见 dev-docs/damage-calc-state-storage.md §五。
 *
 * 运行：npx vite-node scripts/test-enemy-params-custom.mjs
 */
import { readFileSync } from 'node:fs'
import { normalizeDamageEnemyInput } from '../src/utils/enemyResistance.ts'
import {
  mapBossInfoToDamageEnemyInput,
  mapBossRecordToDamageEnemyInput,
} from '../src/utils/enemyInputFromBoss.ts'

let passed = 0
let failed = 0
function check(name, ok, detail) {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('[1] 归一化白名单不丢来源标记（曾两次栽在白名单上）')
const kept = normalizeDamageEnemyInput({
  defense: 953,
  bossSource: 'manual',
  bossName: '危局 Boss X',
  bossRecordLabel: '第3期 · 房间 2 · 危局 Boss X',
})
check('bossSource 保留', kept.bossSource === 'manual', `bossSource=${kept.bossSource}`)
check('bossName 保留', kept.bossName === '危局 Boss X')
check('bossRecordLabel 保留', kept.bossRecordLabel === '第3期 · 房间 2 · 危局 Boss X')

console.log('[2] 选 Boss 时写的是 boss_info / boss_record（重新同步会把「自定义」标记冲掉）')
const fromInfo = mapBossInfoToDamageEnemyInput({
  boss_name: 'Boss A',
  defense: 1000,
  weakness: '火',
  resistance: '',
})
check('mapBossInfoToDamageEnemyInput → boss_info', fromInfo.bossSource === 'boss_info')
const fromRecord = mapBossRecordToDamageEnemyInput({
  id: 1,
  boss_name: 'Boss B',
  defense: 1000,
})
check('mapBossRecordToDamageEnemyInput → boss_record', fromRecord.bossSource === 'boss_record')

console.log('[3] 源码守卫：手改即标 manual + 界面显示「参数已自定义」')
const section = readFileSync(
  new URL('../src/components/calculator/EnemyEnvironmentSection.vue', import.meta.url),
  'utf8',
)
check(
  'patchEnemyInput：来源是 Boss 时手改标成 manual',
  section.includes("fromBoss ? { ...patch, bossSource: 'manual' } : patch"),
)
check(
  'bossParamsCustomized 判定 = manual + 有 bossName',
  /bossParamsCustomized = computed\(\s*\(\) => model\.value\.bossSource === 'manual' && Boolean\(model\.value\.bossName\)/.test(
    section,
  ),
)
check('模板里有「参数已自定义」标记', section.includes('参数已自定义') && section.includes('bossParamsCustomized'))
check(
  '清除怪物仍然整表回落默认（不带 bossName）',
  section.includes('Object.assign(model.value, createDefaultDamageEnemyInput())'),
)

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
