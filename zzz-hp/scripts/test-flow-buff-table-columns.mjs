/**
 * 流程增益表：**列构建规则**（纯逻辑）
 *
 * 钉住四件事（2026-09-23 用户口径）：
 * 1. **列名用短名**：去掉「核心被动：/额外能力：」这类内容分类前缀，全名进悬停卡片
 * 2. **分组 = 提供者**：角色1/2/3（按队伍顺序）→ 其它 → 额外 Buff
 * 3. **同名只在同组内编号**（角色A 的「X」与角色B 的「X」不算重名）
 * 4. **生效者**：`team` → 全队；否则 = 这条增益所属槽位的角色
 *
 * 用法：npx vite-node scripts/test-flow-buff-table-columns.mjs
 */
import { buildFlowBuffTableColumns } from '../src/utils/flowBuffTable.ts'

let passed = 0
let failed = 0
function check(label, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ` —— ${detail}` : ''}`)
  }
}

function item({ id, stat = 'dmgBonus', value = 0, applyTarget = 'team', sourceKey, blockName, sourceLabel = '', providerName = '' }) {
  return {
    effect: { id, stat, value, applyTarget },
    sourceKey,
    blockId: id,
    blockName,
    sourceLabel,
    providerName,
  }
}

const columns = buildFlowBuffTableColumns({
  items: [
    item({ id: 'e1', value: 25, sourceKey: 'agent-0-0', blockName: '核心被动：风华盈袖', sourceLabel: '自身 · 维琳娜', providerName: '维琳娜' }),
    item({ id: 'e2', sourceKey: 'wengine-0-refine', blockName: '精5', sourceLabel: '自身 · 维琳娜 · 音擎 · 某音擎（精5）', providerName: '某音擎' }),
    item({ id: 'e2b', sourceKey: 'drive-disc-0-2set', blockName: '2件套', sourceLabel: '自身 · 维琳娜 · 驱动盘 · 某套装（2件）', providerName: '某套装' }),
    item({ id: 'e3', applyTarget: 'self', sourceKey: 'agent-1-0', blockName: '额外能力：芳菲之邀', sourceLabel: '队友 · 蕾米埃尔', providerName: '蕾米埃尔' }),
    // 与 e1 同组同名（用来验「同组才编号」）
    item({ id: 'e4', value: 10, sourceKey: 'agent-0-1', blockName: '核心被动：风华盈袖', sourceLabel: '自身 · 维琳娜 · 1影', providerName: '维琳娜' }),
    // 另一个角色组里的同名（跨组不算重名）
    item({ id: 'e5', value: 8, sourceKey: 'agent-1-1', blockName: '核心被动：风华盈袖', sourceLabel: '队友 · 蕾米埃尔 · 1影', providerName: '蕾米埃尔' }),
    item({ id: 'e6', sourceKey: 'bangboo', blockName: '邦布技能', sourceLabel: '邦布', providerName: '邦布' }),
    item({ id: 'e7', value: 12, sourceKey: 'extra-abc', blockName: '我的额外Buff', sourceLabel: '额外 Buff', providerName: '我的额外Buff' }),
  ],
  slotLabels: ['维琳娜', '蕾米埃尔', '派派'],
})

console.log('=== 1. 短名（去掉内容分类前缀）===')
const byLabel = (label, group) => columns.filter((c) => c.label === label && (!group || c.groupLabel === group))
check('能力块的类别前缀被去掉', byLabel('风华盈袖').length > 0, JSON.stringify(columns.map((c) => c.label)))
check('音擎带上名字（精5 单独不可理解）', byLabel('某音擎 精5').length === 1, JSON.stringify(columns.map((c) => c.label)))
check('驱动盘维持现状（2件套 不加套装名）', byLabel('2件套').length === 1, JSON.stringify(columns.map((c) => c.label)))
check('「额外能力：芳菲之邀」→ 芳菲之邀', byLabel('芳菲之邀').length === 1)
const first = columns.find((c) => c.key === 'e1')
check('卡片标题用全名（不是简写）', first?.tipTitle === '核心被动：风华盈袖', first?.tipTitle)
check('正文三行：数值 / 生效者 / 提供者', (first?.details ?? []).length === 3, JSON.stringify(first?.details))

console.log('\n=== 2. 分组 = 提供者（顺序：角色1 → 角色2 → 其它 → 额外 Buff）===')
const groupOrder = [...new Set(columns.map((c) => c.groupKey))]
check(
  '分组顺序正确',
  JSON.stringify(groupOrder) === JSON.stringify(['slot-0', 'slot-1', 'other', 'extra']),
  JSON.stringify(groupOrder),
)

console.log('\n=== 3. 同名只在同组内编号 ===')
const v = byLabel('风华盈袖', '维琳娜')
const r = byLabel('风华盈袖', '蕾米埃尔')
check('维琳娜组同名 → 1、2', v.map((c) => c.badge).join(',') === '1,2', JSON.stringify(v.map((c) => c.badge)))
check('蕾米埃尔组只有一个 → 不给编号', r.length === 1 && !r[0].badge, JSON.stringify(r.map((c) => c.badge)))
check('不同组同名不互算', byLabel('风华盈袖').length === 3)

console.log('\n=== 4. 生效者 ===')
check('team → 全队', first?.beneficiaryLabel === '全队', first?.beneficiaryLabel)
const selfCol = columns.find((c) => c.key === 'e3')
check('self → 该增益所属槽位的角色', selfCol?.beneficiaryLabel === '蕾米埃尔', selfCol?.beneficiaryLabel)

console.log('')
console.log(`=== 结果：passed = ${passed}, failed = ${failed} ===`)
if (failed > 0) process.exit(1)
