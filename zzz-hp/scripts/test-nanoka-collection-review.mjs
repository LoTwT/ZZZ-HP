import assert from 'node:assert/strict'
import { createNanokaSkillReview, selectedNanokaSkills } from '../src/utils/nanokaCollectionReview.ts'

const expect = { baseMult: 100, damagePercentage: 20, damagePercentageGrowth: 5, multSource: 'nanoka' }
const plan = {
  create: [{ id: 'new-1', name: '新增招式', baseMult: 120 }],
  overwrite: [{ id: 'old-1', name: '已有招式', from: 100, to: 130, expect }],
  skipSame: [{ id: 'same-1', name: '已一致', baseMult: 200 }],
  existingManual: [], unmatchedLocal: [],
}
const entries = createNanokaSkillReview(plan)
assert.equal(entries.length, 2, '已一致招式不再占据审核列表')
assert.deepEqual(selectedNanokaSkills(entries), [{ id: 'new-1', action: 'create' }], '默认只勾选新增')
entries[1].checked = true
assert.deepEqual(selectedNanokaSkills(entries)[1], { id: 'old-1', action: 'overwrite', expect }, '明确选择覆盖时携带预览旧值')
entries[0].written = true
assert.deepEqual(selectedNanokaSkills(entries), [{ id: 'old-1', action: 'overwrite', expect }], '已处理项不会再次提交')
entries[1].checked = false
assert.deepEqual(selectedNanokaSkills(entries), [], '撤销勾选后不提交')
assert.equal(plan.create[0].baseMult, 120)
console.log('nanoka 采集审核：新增默认、覆盖确认、旧值快照、已处理排除和撤销勾选通过')
