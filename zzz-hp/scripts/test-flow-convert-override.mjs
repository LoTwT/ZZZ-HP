/**
 * 转模基数的「全局 / 行级」两级 + 显示与结算一致性（2026-10-23 修 bug 的回归）。
 *
 * 背景（用户 2026-10-23 报）：
 * - 「选择局内 Buff」里手填的转模基数，结算用了，但流程增益表 / 本行例外弹窗仍按面板显示；
 * - 「本行例外」原来只给「自行设置」转模输入框，读局外/局内的转模在行级改不了基数。
 *
 * 断言（都走真实取值函数，不自己造公式）：
 * 1. 无手填：结算与表格文本都按面板值；
 * 2. 全局手填：结算 = 表格文本 = 手填值（`buildFlowBuffEffectTexts` 的 `convertInputFor`）；
 * 3. 行级手填覆盖全局：结算按行级（`rowBuffOverride.convertInputsByEffectId` > `buffSelection.convertInputs`）；
 * 4. 面板口径（不带行级例外）只反映全局值，不被行级影响。
 *
 * 用法：npx vite-node scripts/test-flow-convert-override.mjs
 */
import {
  buildBuffCatalog,
  collectAllBuffEffects,
  collectPanelBuffMods,
  invalidateBuffCatalogCache,
} from '../src/utils/panelBuffCalc.ts'
import { buildFlowBuffEffectTexts } from '../src/utils/flowBuffTable.ts'
import { convertEffect, dummyBangboo, makePanelCtx, testAgent, testSlot } from './_effectPipelineHarness.mjs'

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

const EFFECT_ID = 'conv-atk-10'

/** 收集产物里的实例 id（`sourceKey::blockId::effectId`）—— 勾选状态与转模输入都按它存 */
function instancedId(ctx, suffix = EFFECT_ID) {
  const item = collectAllBuffEffects(ctx).find((entry) => entry.effect.id.endsWith(suffix))
  return item ? item.effect.id : null
}

/** 一个「读局外」的转模：攻击 10% → 攻击 */
function buildAgent() {
  const agent = testAgent('a', { name: '甲' })
  const effect = convertEffect(EFFECT_ID, 'atk', {
    from: 'atk',
    panelSource: 'external',
    ratioPercent: 10,
    initialBase: 0,
    cap: null,
    defaultBase: null,
  })
  agent.mindscapeBuffs[0] = {
    effectBlocks: [{ id: 'blk', name: '测', effects: [effect] }],
    effects: [effect],
    selfMods: {},
    teamMods: {},
  }
  return agent
}

function buildCtx(extra = {}) {
  const agent = buildAgent()
  return makePanelCtx({
    teamSlots: [testSlot('a')],
    agents: [agent],
    bangboo: dummyBangboo(),
    mainSlotIndex: 0,
    extraGains: [],
    // 面板：攻击 2000 → 转模 10% = 200
    panelSourceValues: { external: { atk: 2000 }, final: { atk: 2000 } },
    ...extra,
  })
}

function textOf(ctx, id, convertInputFor) {
  const texts = buildFlowBuffEffectTexts(collectAllBuffEffects(ctx), {
    selection: null,
    slotIndex: 0,
    attrDefaults: { atk: 2000 },
    panelSourceValues: ctx.panelSourceValues,
    convertInputFor,
  })
  return texts[id] ?? ''
}

console.log('\n[1] 无手填：结算与表格文本都按面板值')
{
  invalidateBuffCatalogCache()
  const ctx = buildCtx()
  const id = instancedId(ctx)
  check('收集到转模条目', Boolean(id), String(id))
  const atk = collectPanelBuffMods(ctx).atk
  check('结算 atk=200', atk === 200, `实际 ${atk}`)
  const text = textOf(ctx, id, undefined)
  check('表格文本含 200', text.includes('200'), text)
}

console.log('\n[2] 全局手填 3000：结算与表格文本都按 3000')
{
  invalidateBuffCatalogCache()
  const probe = buildCtx()
  const id = instancedId(probe)
  const globalSelection = {
    enabledIds: {},
    stacksByEffectId: {},
    convertInputs: { [id]: 3000 },
    manualTouchedIds: {},
  }
  invalidateBuffCatalogCache()
  const ctx = buildCtx({ buffSelection: globalSelection })
  const atk = collectPanelBuffMods(ctx).atk
  check('结算 atk=300', atk === 300, `实际 ${atk}`)
  const text = textOf(ctx, id, (effect) => globalSelection.convertInputs[effect.id])
  check('表格文本含 300（修前恒按面板 200）', text.includes('300'), text)
}

console.log('\n[3] 行级手填 5000 覆盖全局 3000')
{
  invalidateBuffCatalogCache()
  const probe = buildCtx()
  const id = instancedId(probe)
  const globalSelection = {
    enabledIds: {},
    stacksByEffectId: {},
    convertInputs: { [id]: 3000 },
    manualTouchedIds: {},
  }
  invalidateBuffCatalogCache()
  const rowCtx = buildCtx({
    buffSelection: globalSelection,
    rowBuffOverride: { convertInputsByEffectId: { [id]: 5000 } },
  })
  const rowAtk = collectPanelBuffMods(rowCtx).atk
  check('行级结算 atk=500', rowAtk === 500, `实际 ${rowAtk}`)

  invalidateBuffCatalogCache()
  const panelCtx = buildCtx({ buffSelection: globalSelection })
  const panelAtk = collectPanelBuffMods(panelCtx).atk
  check('面板口径仍只反映全局（300），不被行级影响', panelAtk === 300, `实际 ${panelAtk}`)
}

console.log('\n[4] 技能等级来源：手填基数不生效（共享函数忽略）')
{
  invalidateBuffCatalogCache()
  const agent = testAgent('a', { name: '甲' })
  const effect = convertEffect('conv-level', 'dmgBonus', {
    from: 'skillLevelBasic',
    panelSource: 'external',
    ratioPercent: 10,
    initialBase: 0,
    cap: null,
    defaultBase: null,
  })
  agent.mindscapeBuffs[0] = {
    effectBlocks: [{ id: 'blk', name: '测', effects: [effect] }],
    effects: [effect],
    selfMods: {},
    teamMods: {},
  }
  const ctx = makePanelCtx({
    teamSlots: [testSlot('a')],
    agents: [agent],
    bangboo: dummyBangboo(),
    mainSlotIndex: 0,
    extraGains: [],
    skillTalentLevelsByAgent: { a: { basic: 12 } },
    buffSelection: {
      enabledIds: {},
      stacksByEffectId: {},
      convertInputs: { 'conv-level': 3000 },
      manualTouchedIds: {},
    },
  })
  const mods = collectPanelBuffMods(ctx)
  check('等级 12 × 10% = 1.2（不吃手填 3000）', Math.abs((mods.dmgBonus ?? 0) - 1.2) < 1e-6, `实际 ${mods.dmgBonus}`)
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
