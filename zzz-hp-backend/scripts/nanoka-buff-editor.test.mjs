import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildLocalDoc,
  nanokaRulesTable,
  planBuffApply,
  sanitizeEffect,
  smartMergeParse,
} from '../src/services/nanokaBuffService.js'

const effect = (patch = {}) => ({ id: 'effect', stat: 'dmgBonus', kind: 'fixed', value: 20, applyTarget: 'self', ...patch })
const block = (id, name) => ({ id, name, note: `${name}备注`, enabledDefault: true })
const row = (key, patch = {}) => ({ key, source: 'passive.core', slot: 'core', slotLabel: '核心', containerIndex: 0, rawText: '原文', effect: effect({ id: key }), ...patch })
const plan = (rows, local = {}) => planBuffApply({ kind: 'agent', local, rows })

test('新版效果块按 id 入库，保留旧块，名称备注与分组条件完整往返', () => {
  const local = { mindscapeBuffs: [{ effectBlocks: [{ id: 'existing', name: '已有', note: '', effects: [effect({ id: 'old' })] }] }] }
  const rows = [row('a', { block: block('core', '核心被动'), effect: effect({ id: 'a', groupId: 'group', conditions: { damageTypes: ['normal', 'pierce'] } }) }), row('b', { block: block('extra', '额外能力') })]
  const first = plan(rows, local)
  assert.equal(first.updated, 2)
  const doc = buildLocalDoc({ kind: 'agent', local, groups: first.groups })
  const blocks = doc.mindscapeBuffs[0].effectBlocks
  assert.deepEqual(blocks.map((item) => item.name), ['已有', '核心被动', '额外能力'])
  assert.equal(blocks[1].note, '核心被动备注')
  assert.equal(blocks[1].effects[0].groupId, 'group')
  assert.deepEqual(blocks[1].effects[0].conditions, { damageTypes: ['normal', 'pierce'] })
  assert.equal(plan(rows, doc).updated, 0)
  assert.equal(plan(rows, doc).skipped, 2)
  assert.equal(local.mindscapeBuffs[0].effectBlocks.length, 1)
})

test('转模基础值、初始值、上限和异常开关不同不能误判为重复', () => {
  const base = effect({ kind: 'convert', value: 0, convert: { from: 'mastery', panelSource: 'external', ratioPercent: 10, cap: 100, defaultBase: 0, initialBase: 0 } })
  const patches = [{}, { cap: 200 }, { defaultBase: 100 }, { initialBase: 50 }]
  const rows = patches.map((patch, index) => row(`c${index}`, { effect: { ...base, id: `c${index}`, convert: { ...base.convert, ...patch } } }))
  assert.equal(plan(rows).updated, 4)
  assert.equal(plan([row('a'), row('b', { effect: effect({ appliesToAnomaly: true }) })]).updated, 2)
  assert.equal(plan([row('a'), row('b', { effect: effect({ enabledDefault: false }) })]).updated, 2)
})

test('同一招式多条关键字累积到一个描述计划，避免最后一条覆盖前面的追加', () => {
  const slots = { stat: '增伤', elements: ['无'], action: '提升', value: 20, unit: '%', target: '自身', conditions: ['无'], scope: '无', stacks: '无', duration: '无', object: '无' }
  const skills = [{ id: 'skill', agentId: 'agent', name: '普通攻击', note: '已有说明' }]
  const rows = [20, 30].map((value) => row(String(value), { rawText: '同一段原文', keywordSlots: { ...slots, value }, skillDesc: { agentId: 'agent', skillName: '普通攻击', category: 'basic' } }))
  const result = planBuffApply({ kind: 'agent', local: {}, rows, skills })
  assert.equal(result.skills.length, 1)
  assert.match(result.skills[0].note, /20/)
  assert.match(result.skills[0].note, /30/)
  assert.match(result.skills[0].note, /已有说明/)
  assert.equal(result.skills[0].note.split('同一段原文').length - 1, 1)
})

test('智能解析使用新版条件字段，人工条件不会被静默覆盖', () => {
  const slots = { stat: '增伤', elements: ['无'], action: '提升', value: 20, unit: '%', target: '自身', conditions: ['无'], scope: '无', stacks: '无', duration: '无', object: '无' }
  const current = effect({ conditions: { damageTypes: ['pierce'] } })
  const result = smartMergeParse({ rows: [{ key: 'a', effect: current, dirty: { conditions: true } }], keywords: [{ key: 'a', slots }] })
  assert.deepEqual(result.rows[0].effect.conditions, current.conditions)
  assert.ok(result.rows[0].conflicts.some((conflict) => conflict.field === 'conditions'))
  assert.equal(sanitizeEffect({ ...current, scope: 'general' }).conditions.damageTypes[0], 'pierce')
  assert.ok(nanokaRulesTable().groups.length > 0)
})
