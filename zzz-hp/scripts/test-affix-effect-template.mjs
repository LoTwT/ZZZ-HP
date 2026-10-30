/**
 * 词条预设效果模板：从 target 编出的 spec 必须与适配器同构。
 * 运行：npx vite-node scripts/test-affix-effect-template.mjs
 */
import { adaptAffixLibraryEntry } from '../src/utils/effectAdapters.ts'
/** 读时兼容：单值字符串与数组都算（scope 数组改造期间的容错比较，不比数值） */
function sameScopes(value, expected) {
  const list = Array.isArray(value) ? value : value == null || value === '' ? [] : [value]
  return list.length === expected.length && list.every((item, index) => item === expected[index])
}

import {
  buildAffixEffectTemplate,
  parseAffixEffectTemplate,
} from '../src/utils/affixEffectTemplate.ts'
import { parseAffixPresetEntries, resolveAffixScopeForSave } from '../src/utils/affixLibrary.ts'
import { affixEntry } from './_effectPipelineHarness.mjs'

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

console.log('\n[1] 十格形态的 panel: 仍是计数桶')
{
  const entry = affixEntry('substat:critRate', 'panel:critRate', 2.4)
  const template = buildAffixEffectTemplate(entry)
  const allocated = adaptAffixLibraryEntry(entry, 3)
  check('模板 allocation=count', template?.allocation === 'count')
  check('适配器仍是 count', allocated?.type === 'count')
  check('等效档数按每档折算', allocated?.type === 'count' && allocated.equivalentRolls === 3)
}

console.log('\n[2] panel: / gain: 模板与适配器同构')
{
  const panel = affixEntry('panel:penRate', 'panel:penRate', 24)
  const fromTarget = adaptAffixLibraryEntry(panel, 1)
  const stored = { ...panel, effectTemplate: buildAffixEffectTemplate(panel) ?? undefined }
  const fromStored = adaptAffixLibraryEntry(stored, 1)
  check('panel 模板是 effect', stored.effectTemplate?.allocation === 'effect')
  check('panel 阶段 external', stored.effectTemplate?.allocation === 'effect' && stored.effectTemplate.spec.stage === 'external')
  check('有无模板适配结果同构', JSON.stringify(fromTarget) === JSON.stringify(fromStored))
  check('panel 走 affix-panel', fromTarget?.type === 'effect' && fromTarget.instance.sourceFamily === 'affix-panel')

  const gain = {
    ...affixEntry('gain-basic', 'gain:dmgBonus', 15),
    scope: 'skill',
    skillCategory: 'basic',
  }
  const gainTemplate = buildAffixEffectTemplate(gain)
  const gainAlloc = adaptAffixLibraryEntry({ ...gain, effectTemplate: gainTemplate ?? undefined }, 1)
  check('gain 阶段 combatPreConvert', gainTemplate?.allocation === 'effect' && gainTemplate.spec.stage === 'combatPreConvert')
  check(
    '招式条件进 spec',
    gainTemplate?.allocation === 'effect' &&
      gainTemplate.spec.conditions.skillTargets?.[0]?.category === 'basic',
  )
  check('gain 走 affix-gain', gainAlloc?.type === 'effect' && gainAlloc.instance.sourceFamily === 'affix-gain')
}

console.log('\n[3] 读新优先：effectJson 条件能抬到条目上')
{
  const raw = [
    {
      id: 'gain-basic',
      label: '普攻增伤',
      target: 'gain:dmgBonus',
      perRoll: 15,
      cap: 1,
      group: '',
      rollCost: 1,
      enabledByDefault: true,
      effectJson: buildAffixEffectTemplate({
        id: 'gain-basic',
        label: '普攻增伤',
        target: 'gain:dmgBonus',
        perRoll: 15,
        cap: 1,
        group: '',
        rollCost: 1,
        enabledByDefault: true,
        scope: 'skill',
        skillCategory: 'basic',
      }),
    },
  ]
  const { entries, skipped } = parseAffixPresetEntries(raw)
  check('没有跳过', skipped === 0)
  check('抄上 scope=skill', sameScopes(entries[0]?.scope, ['skill']))
  check('抄上招式大类', entries[0]?.skillCategory === 'basic')
}

console.log('\n[4] 坏模板回退 target')
{
  const entry = affixEntry('panel:penRate', 'panel:penRate', 24)
  const parsed = parseAffixEffectTemplate({ version: 1, allocation: 'nope' })
  const allocated = adaptAffixLibraryEntry({ ...entry, effectTemplate: parsed ?? undefined }, 1)
  check('坏模板 parse 失败', parsed === null)
  check('仍能从 target 编出 panel 效果', allocated?.type === 'effect')
}

if (failed) {
  console.log(`\n结果：${passed} passed, ${failed} failed`)
  process.exit(1)
}
console.log(`\n结果：${passed} passed, 0 failed`)
console.log('\n[scope 数组：表单保存不得静默压扁多值]')
{
  const original = ['attributeAnomaly', 'anomalyRelease']
  const kept = resolveAffixScopeForSave(original, 'attributeAnomaly', false)
  check(
    '未改动 scope → 原样保留多值数组',
    Array.isArray(kept) && kept.length === 2 && kept[0] === 'attributeAnomaly' && kept[1] === 'anomalyRelease',
  )
  const changed = resolveAffixScopeForSave(original, 'radiance', true)
  check('显式改动 scope → 写成该单元素数组', JSON.stringify(changed) === JSON.stringify(['radiance']))
  const normalized = resolveAffixScopeForSave(['attributeAnomaly', 'general'], 'attributeAnomaly', false)
  check('未改动时也按规则归一化（含 general → 只留 general）', JSON.stringify(normalized) === JSON.stringify(['general']))
}