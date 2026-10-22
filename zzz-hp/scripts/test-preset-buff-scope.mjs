/**
 * 导入预设弹窗「高级设置」的增益范围（用户口径 2026-10-22）。
 *
 * 用户要求：在导入界面里就能调 Buff，不用导入后再开「选择 Buff」界面；
 * 但这里**只能看本页物件对自身生效的增益**，看不到队友 / 全队。
 *
 * 运行：npm run test:preset-buff-scope
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  PRESET_BUFF_SCOPE_GROUPS,
  buffScopeGroupsForTab,
  filterPresetBuffEffects,
} from '../src/utils/presetBuffScope.ts'

let passed = 0
let failed = 0
function check(name, action) {
  try {
    action()
    passed += 1
    console.log(`  PASS  ${name}`)
  } catch (error) {
    failed += 1
    console.log(`  FAIL  ${name} — ${error.message}`)
  }
}

/** 只关心 group 的假效果条目（其余字段这条链路不读） */
const effect = (group, id) => ({ group, effect: { id }, id })

const allGroups = [
  '自身',
  '自身音擎',
  '自身驱动盘',
  '全队（含自身）',
  '全队音擎',
  '队友',
  '队友音擎',
  '队友驱动盘',
  '额外 Buff',
  '邦布',
  '危局 Buff',
]
const effects = allGroups.map((group) => effect(group, `id-${group}`))
const groupsOf = (list) => list.map((item) => item.group)

console.log('\n[1] 每个页签只给自己那一类「对自身」的增益')
{
  check('武器页只给「自身音擎」', () =>
    assert.deepEqual(groupsOf(filterPresetBuffEffects(effects, 'wengine')), ['自身音擎']))
  check('角色页只给「自身」', () =>
    assert.deepEqual(groupsOf(filterPresetBuffEffects(effects, 'agent')), ['自身']))
  check('驱动盘页只给「自身驱动盘」', () =>
    assert.deepEqual(groupsOf(filterPresetBuffEffects(effects, 'disc')), ['自身驱动盘']))
  check('面板页给三类自身来源', () =>
    assert.deepEqual(groupsOf(filterPresetBuffEffects(effects, 'panel')), [
      '自身',
      '自身音擎',
      '自身驱动盘',
    ]))
}

console.log('\n[2] 队友 / 全队 / 场地类一律不出现')
{
  const forbidden = ['队友', '队友音擎', '队友驱动盘', '全队（含自身）', '全队音擎', '额外 Buff', '邦布', '危局 Buff']
  for (const tab of ['agent', 'wengine', 'disc', 'panel']) {
    const kept = groupsOf(filterPresetBuffEffects(effects, tab))
    check(`${tab}：不含队友/全队/场地`, () => {
      for (const group of forbidden) {
        assert.ok(!kept.includes(group), `${tab} 里出现了 ${group}`)
      }
    })
  }
}

console.log('\n[3] 兜底')
{
  check('未知页签 → 空（不提供高级设置）', () => {
    assert.deepEqual(filterPresetBuffEffects(effects, 'unknown'), [])
    assert.deepEqual([...buffScopeGroupsForTab('unknown')], [])
  })
  check('空列表 → 空', () => assert.deepEqual(filterPresetBuffEffects([], 'wengine'), []))
  check('页签表只登记四个页签', () =>
    assert.deepEqual(Object.keys(PRESET_BUFF_SCOPE_GROUPS).sort(), ['agent', 'disc', 'panel', 'wengine']))
}

console.log('\n[4] 组件接线')
{
  const picker = readFileSync(
    fileURLToPath(
      new URL('../src/components/calculator/UnifiedPresetPicker.vue', import.meta.url),
    ),
    'utf8',
  )
  const page = readFileSync(
    fileURLToPath(new URL('../src/components/calculator/DamageCalcPage.vue', import.meta.url)),
    'utf8',
  )
  check('页面注入按槽位的 Buff 勾选', () =>
    assert.match(page, /provide\(MULTI_SLOT_BUFF_SELECTION_KEY, multiSlotBuffSelection\)/))
  check('弹窗用 inject 取同一份勾选（没有就隐藏入口）', () => {
    assert.match(picker, /inject<MultiSlotBuffSelection \| null>\(\s*MULTI_SLOT_BUFF_SELECTION_KEY,/)
    assert.match(picker, /v-if="multiSlotBuffSelection && advancedBuffEffects\.length"/)
  })
  check('列表按当前页签过滤', () =>
    assert.match(picker, /filterPresetBuffEffects\(draftSelfBuffEffects\.value, activeTab\.value\)/))
  check('按弹窗草稿（未导入）收集，而不是手上的旧配装', () =>
    assert.match(picker, /const draftSlots = props\.teamSlots\.map\(\(slot, index\) =>[\s\S]{0,400}?wengineId: draft\.wengineId/))
  check('复用「选择 Buff」界面，只喂筛过的效果', () => {
    const modal = picker.match(/<BuffEffectPickerModal[\s\S]*?\/>/)
    assert.ok(modal, '没有挂载 BuffEffectPickerModal')
    assert.ok(modal[0].includes(':effects="advancedBuffEffects"'), modal[0])
    assert.ok(modal[0].includes(':multi-selection="multiSlotBuffSelection"'), modal[0])
  })
}

console.log(failed ? `\n❌ ${failed} failed, ${passed} passed` : `\n✅ all passed（${passed}）`)
if (failed) process.exitCode = 1
