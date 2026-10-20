/**
 * 前端条件体系：旧 scope 迁移 / 8 类伤害类型 / 引擎命中 / 显示。
 * 运行：npx vite-node scripts/test-buff-damage-types.mjs
 */
import { createEmptyBuffEffect, effectMatchesContext, effectSummaryLabel, normalizeBuffEffect } from '../src/utils/buffEffect.ts'
import {
  damageTypesLabel,
  damageTypesOf,
  legacyScopeToDamageTypes,
  normalizeDamageTypes,
  normalizeEffectConditionsForStat,
} from '../src/utils/buffDamageTypes.ts'

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

function ctx(kind, sub, generic = false) {
  return {
    damageKind: kind,
    categoryId: 'basic',
    subcategoryId: null,
    coords: [],
    element: '电',
    staggerPhase: 'stagger',
    isFollowUp: false,
    ...(kind === 'anomaly' ? { anomalySubKind: sub } : { directSubKind: sub }),
    generic,
  }
}

console.log('\n[1] 8 类词表与顺序')
check(
  '固定顺序',
  normalizeDamageTypes(['anomalyRelease', 'radiance', 'normal', 'pierce', 'sharpen', 'anomaly', 'disorder', 'turbulence']).join(',') ===
    'normal,pierce,sharpen,anomaly,turbulence,disorder,radiance,anomalyRelease',
)
check('非法值剔除', normalizeDamageTypes(['bogus', 'normal']).join(',') === 'normal')
check('空 = 全部', damageTypesLabel([]) === '全部')
check('显示只显示第二级', damageTypesLabel(['anomaly', 'disorder']) === '属性异常 / 紊乱')

console.log('\n[2] 旧 scope → damageTypes')
check('anomaly', legacyScopeToDamageTypes(['anomaly']).join(',') === 'anomaly')
check('mutation → 异常 5 项', legacyScopeToDamageTypes('mutation').length === 5)
check('general → 全部', legacyScopeToDamageTypes(['general']).length === 0)
check('skill → 全部（招式另由 skillTargets 表达）', legacyScopeToDamageTypes(['skill']).length === 0)
check('多成员并集去重', legacyScopeToDamageTypes(['radiance', 'anomaly', 'anomaly']).join(',') === 'anomaly,radiance')

console.log('\n[3] 归一化：conditions 优先 / 子类 stat 去冗余 / 不写 scope')
const normalized = normalizeBuffEffect({
  id: 'n1',
  stat: 'dmgBonus',
  value: 10,
  scope: ['anomaly'],
  groupId: ' grp ',
})
check('旧 scope 迁到 conditions', normalized.conditions.damageTypes.join(',') === 'anomaly')
check('不再有 scope 字段', normalized.scope === undefined)
check('groupId 保留', normalized.groupId === 'grp')

const anomalyStat = normalizeBuffEffect({
  id: 'n2',
  stat: 'anomalyDmgBonus',
  value: 10,
  scope: ['anomaly'],
  conditions: { damageTypes: ['anomaly'] },
})
check('子类 stat 不写冗余 conditions', anomalyStat.conditions === undefined)

const explicit = normalizeBuffEffect({
  id: 'n3',
  stat: 'atk',
  value: 10,
  scope: ['anomaly'],
  conditions: { damageTypes: ['normal', 'pierce'] },
})
check('conditions 优先于 scope', explicit.conditions.damageTypes.join(',') === 'normal,pierce')

check(
  'normalizeEffectConditionsForStat 对子类字段清空',
  normalizeEffectConditionsForStat({ damageTypes: ['anomaly'] }, undefined, 'turbulenceDmgBonus') ===
    undefined,
)

console.log('\n[4] 引擎命中：直伤 3 类')
{
  const fx = createEmptyBuffEffect({
    id: 'e1',
    stat: 'atk',
    value: 30,
    conditions: { damageTypes: ['pierce'] },
  })
  check('命破命中', effectMatchesContext(fx, ctx('direct', 'pierce')))
  check('普通直伤不命中', !effectMatchesContext(fx, ctx('direct', 'normal')))
  check('锋御不命中', !effectMatchesContext(fx, ctx('direct', 'sharpen')))
  check('异常不命中', !effectMatchesContext(fx, ctx('anomaly', 'anomaly')))
  check('通用面板不命中', !effectMatchesContext(fx, ctx('direct', 'pierce', true)))
}

console.log('\n[5] 引擎命中：异常 5 类 / 跨类 / 全部')
{
  const fx = createEmptyBuffEffect({
    id: 'e2',
    stat: 'atk',
    value: 30,
    conditions: { damageTypes: ['anomaly', 'disorder'] },
  })
  check('属性异常命中', effectMatchesContext(fx, ctx('anomaly', 'anomaly')))
  check('紊乱命中', effectMatchesContext(fx, ctx('anomaly', 'disorder')))
  check('乱流不命中', !effectMatchesContext(fx, ctx('anomaly', 'turbulence')))
  check('直伤不命中', !effectMatchesContext(fx, ctx('direct', 'normal')))

  const all = createEmptyBuffEffect({ id: 'e3', stat: 'atk', value: 30 })
  check('无条件 = 全部直伤', effectMatchesContext(all, ctx('direct', 'sharpen')))
  check('无条件 = 全部异常', effectMatchesContext(all, ctx('anomaly', 'radiance')))

  const cross = createEmptyBuffEffect({
    id: 'e4',
    stat: 'atk',
    value: 30,
    conditions: { damageTypes: ['normal', 'anomaly'] },
  })
  check('跨类：普通直伤命中', effectMatchesContext(cross, ctx('direct', 'normal')))
  check('跨类：属性异常命中', effectMatchesContext(cross, ctx('anomaly', 'anomaly')))
  check('跨类：命破不命中', !effectMatchesContext(cross, ctx('direct', 'pierce')))
}

console.log('\n[6] 旧 scope 直接构造的效果仍按条件命中')
{
  const legacy = createEmptyBuffEffect({ id: 'e5', stat: 'dmgBonus', value: 10, scope: ['anomaly'] })
  check('createEmpty 迁移 scope', damageTypesOf(legacy).join(',') === 'anomaly')
  check('异常命中', effectMatchesContext(legacy, ctx('anomaly', 'anomaly')))
  check('直伤不命中', !effectMatchesContext(legacy, ctx('direct', 'normal')))
}

console.log('\n[7] 显示：第二级 + 招式')
{
  const fx = createEmptyBuffEffect({
    id: 'e6',
    stat: 'atk',
    value: 30,
    conditions: { damageTypes: ['pierce'] },
    skillTargets: [{ category: 'basic', subcategoryId: null }],
  })
  const label = effectSummaryLabel(fx, (stat) => stat)
  check('含命破', label.includes('命破'), label)
  check('不含「直伤类」前缀', !label.includes('直伤类'), label)
  check('含招式', label.includes('招式'), label)
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
