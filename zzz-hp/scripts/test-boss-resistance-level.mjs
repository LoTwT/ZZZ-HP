/**
 * Boss 抗性 20% / 40% 双档：resistance_high（40% 子集）在解析层与展示层的一致性
 *
 * 口径：一属性一档，40% 由 resistance_high 显式标注；未标注的 resistance 属性仍为 20%（向下兼容）。
 * 见 dev-docs/boss-resistance-level.md。
 *
 * 运行：npx vite-node scripts/test-boss-resistance-level.mjs
 */
import { readFileSync } from 'node:fs'
import { RESISTANCE_VALUE_MAP } from '../src/utils/enemyResistance.ts'
import { parseBossTraitToElementResistance } from '../src/utils/enemyBossTextParse.ts'
import { parseElementIcons } from '../src/utils/elementIcons.ts'
import { mapBossInfoToDamageEnemyInput } from '../src/utils/enemyInputFromBoss.ts'

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

console.log('[1] parseBossTraitToElementResistance：高抗性（40%）与普通抗性（20%）分档')
const mixed = parseBossTraitToElementResistance('冰', '冰、火', '火')
check('resistance_high 命中的属性 → res40', mixed['火'] === 'res40', `火=${mixed['火']}`)
check(
  '同属性既在 weakness 又在 resistance → 抗性覆盖弱点',
  mixed['冰'] === 'res20',
  `冰=${mixed['冰']}`,
)
const split = parseBossTraitToElementResistance('冰', '火、以太', '火')
check('弱点属性 → weak', split['冰'] === 'weak', `冰=${split['冰']}`)
check('非高抗性属性 → res20', split['以太'] === 'res20', `以太=${split['以太']}`)
check('未出现属性 → normal', split['电'] === 'normal', `电=${split['电']}`)

console.log('[2] 第三参缺省：与改动前完全一致（全部 20%）')
const legacy = parseBossTraitToElementResistance('冰', '火、以太')
check('无 resistance_high 时 火 → res20', legacy['火'] === 'res20', `火=${legacy['火']}`)
check('无 resistance_high 时 以太 → res20', legacy['以太'] === 'res20', `以太=${legacy['以太']}`)

console.log('[3] resistance_high 非 resistance 子集时不得越权加档')
const stray = parseBossTraitToElementResistance(null, '火', '冰')
check('未在 resistance 里的高抗性属性被忽略', stray['冰'] === 'normal', `冰=${stray['冰']}`)
check('resistance 内属性仍 res20', stray['火'] === 'res20', `火=${stray['火']}`)

console.log('[4] parseElementIcons：按档位带百分比')
const icons = parseElementIcons('冰、火', '火')
const byName = Object.fromEntries(icons.map((item) => [item.name, item.percent]))
check('冰 → 20', byName['冰'] === 20, `percent=${byName['冰']}`)
check('火 → 40', byName['火'] === 40, `percent=${byName['火']}`)
check('百分比由 RESISTANCE_VALUE_MAP 推导', byName['冰'] === RESISTANCE_VALUE_MAP.res20 * 100 && byName['火'] === RESISTANCE_VALUE_MAP.res40 * 100)
check('两参缺省时仍可解析（旧调用方）', parseElementIcons('冰')[0]?.percent === RESISTANCE_VALUE_MAP.res20 * 100)
check('高抗性值里的未收录属性不产生图标', parseElementIcons('冰', '流明').length === 1)

console.log('[5] 计算器回填：选 Boss 时按录入档位生效')
const enemyInput = mapBossInfoToDamageEnemyInput({
  boss_name: 'Boss A',
  defense: 953,
  weakness: '冰',
  resistance: '火、以太',
  resistance_high: '火',
})
check(
  'elementResistance.火 → res40',
  enemyInput.elementResistance?.['火'] === 'res40',
  `火=${enemyInput.elementResistance?.['火']}`,
)
check(
  'elementResistance.以太 → res20',
  enemyInput.elementResistance?.['以太'] === 'res20',
  `以太=${enemyInput.elementResistance?.['以太']}`,
)
check('RESISTANCE_VALUE_MAP 40% 档为 0.4', RESISTANCE_VALUE_MAP.res40 === 0.4)

console.log('[6] 源码守卫：ElementTraitChips 高抗性行默认关闭且 high ⊆ value')
const chips = readFileSync(
  new URL('../src/components/shared/ElementTraitChips.vue', import.meta.url),
  'utf8',
)
check(
  'high 模型为可选 v-model',
  chips.includes("defineModel<string>('high', { default: '' })"),
)
check('allowHigh 默认 false', /allowHigh:\s*false/.test(chips))
check(
  '取消主行选中时同步移出高抗性',
  chips.includes('if (props.allowHigh && !next.includes(el))') &&
    chips.includes('highSelected.value.filter((item) => item !== el)'),
)
check('模板含「高抗性（40%）」二级行', chips.includes('高抗性（40%）'))
check('二级行只列已选属性', chips.includes('v-if="allowHigh && selected.length"'))

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
