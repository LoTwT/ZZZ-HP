/**
 * 导入预设弹窗：筛选随选中项自动打开（用户口径 2026-10-22）。
 *
 * 打开弹窗时除回填当前槽位的角色 / 音擎 / 驱动盘，还要把筛选按选中项打开：
 * - 角色页：特性 = 该角色的特性；
 * - 武器页：特性 + 稀有度 = 该音擎自己的特性与稀有度（不拿角色职业去套武器，
 *   否则异装备搭配时会把当前选中项自己筛掉）；
 * - 取值必须落在既有筛选项常量里，否则留空（不筛）。
 *
 * 运行：npm run test:preset-picker-auto-filter
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolvePresetPickerAutoFilters } from '../src/utils/presetPickerAutoFilter.ts'

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

console.log('\n[1] 武器页：按音擎自己的特性 + 稀有度筛')
{
  const r = resolvePresetPickerAutoFilters({
    agent: { profession: '异常', element: '以太' },
    wengine: { id: 'w-lingering-echo', profession: '异常', rarity: 'S' },
  })
  check('特性跟音擎（异常）', () => assert.equal(r.wengineRoleFilter, '异常'))
  check('稀有度跟音擎（S）', () => assert.equal(r.wengineRarityFilter, 'S'))
  check('角色页特性跟角色（异常）', () => assert.equal(r.agentRoleFilter, '异常'))
  check('角色属性不自动筛（避免只剩一两条）', () => assert.equal(r.agentElementFilter, ''))

  const aRank = resolvePresetPickerAutoFilters({
    agent: { profession: '强攻', element: '火' },
    wengine: { id: 'w-a', profession: '强攻', rarity: 'A' },
  })
  check('A 档音擎按 A 筛（不写死 S）', () => assert.equal(aRank.wengineRarityFilter, 'A'))
  check('B 档音擎按 B 筛', () =>
    assert.equal(
      resolvePresetPickerAutoFilters({ wengine: { id: 'w-b', profession: '支援', rarity: 'B' } })
        .wengineRarityFilter,
      'B',
    ))

  // 异装备搭配：角色 异常、音擎 强攻 —— 武器页跟音擎，当前选中项不会把自己筛掉
  const offSpec = resolvePresetPickerAutoFilters({
    agent: { profession: '异常', element: '物理' },
    wengine: { id: 'w-off', profession: '强攻', rarity: 'S' },
  })
  check('异装备：武器页跟音擎（强攻）而不是角色（异常）', () => assert.equal(offSpec.wengineRoleFilter, '强攻'))
  check('异装备：角色页仍跟角色（异常）', () => assert.equal(offSpec.agentRoleFilter, '异常'))
}

console.log('\n[2] 兜底：拿不到 / 不在筛选项里就不筛')
{
  const none = resolvePresetPickerAutoFilters({
    agent: { profession: '异常' },
    wengine: { id: 'none', profession: '异常', rarity: 'S' },
  })
  check('音擎「不佩戴」→ 武器页不筛', () => {
    assert.equal(none.wengineRoleFilter, '')
    assert.equal(none.wengineRarityFilter, '')
  })
  check('没有音擎 → 武器页不筛', () => {
    const r = resolvePresetPickerAutoFilters({ agent: { profession: '异常' } })
    assert.equal(r.wengineRoleFilter, '')
    assert.equal(r.wengineRarityFilter, '')
  })
  check('特性不在既有筛选项里 → 留空', () =>
    assert.equal(
      resolvePresetPickerAutoFilters({ wengine: { id: 'w-x', profession: '未知职业', rarity: 'S' } })
        .wengineRoleFilter,
      '',
    ))
  check('稀有度不在 S/A/B 里 → 留空', () =>
    assert.equal(
      resolvePresetPickerAutoFilters({ wengine: { id: 'w-x', profession: '异常', rarity: 'SSR' } })
        .wengineRarityFilter,
      '',
    ))
  check('没有角色 → 角色页不筛', () =>
    assert.equal(resolvePresetPickerAutoFilters({}).agentRoleFilter, ''))
  check('角色特性缺失 → 留空', () =>
    assert.equal(resolvePresetPickerAutoFilters({ agent: {} }).agentRoleFilter, ''))
  check('空字符串不算有效值', () => {
    const r = resolvePresetPickerAutoFilters({
      agent: { profession: '  ' },
      wengine: { id: 'w-y', profession: '', rarity: '' },
    })
    assert.equal(r.agentRoleFilter, '')
    assert.equal(r.wengineRoleFilter, '')
    assert.equal(r.wengineRarityFilter, '')
  })
}

console.log('\n[3] 组件接线：打开弹窗时按上面的结果赋给四个筛选')
{
  const file = fileURLToPath(
    new URL('../src/components/calculator/UnifiedPresetPicker.vue', import.meta.url),
  )
  const source = readFileSync(file, 'utf8')
  check('引入了 resolvePresetPickerAutoFilters', () => {
    assert.match(source, /import \{ resolvePresetPickerAutoFilters \} from '@\/utils\/presetPickerAutoFilter'/)
  })
  check('打开回调里按选中角色 / 音擎算筛选', () => {
    assert.match(source, /const autoFilters = resolvePresetPickerAutoFilters\(\{[\s\S]{0,400}?wengine: props\.wengines\.find/)
  })
  check('四个筛选都取自动算结果（不再无条件清空）', () => {
    for (const name of ['agentRoleFilter', 'agentElementFilter', 'wengineRoleFilter', 'wengineRarityFilter']) {
      assert.match(source, new RegExp(`${name}\\.value = autoFilters\\.${name}`), name)
      assert.ok(!source.includes(`${name}.value = ''`), `${name} 仍在别处被清空`)
    }
  })
  check('搜索词与页签仍是每次打开重置', () => {
    assert.match(source, /agentSearch\.value = ''/)
    assert.match(source, /wengineSearch\.value = ''/)
    assert.match(source, /discSearch\.value = ''/)
    assert.match(source, /activeTab\.value = 'agent'/)
  })
}

console.log(failed ? `\n❌ ${failed} failed, ${passed} passed` : `\n✅ all passed（${passed}）`)
if (failed) process.exitCode = 1
