/**
 * 事件增益投影回归（C2 / K1 / K2a / K2b / K10 的归属脚本）。
 *
 * 目的：证明「预览显示值 = 计算实际采用值」。
 * - K1：职业限制夹具（owner 强攻 / power 支援）。实际只有 power 吃到 25% 增伤，
 *   预览却因为「按 effect id 先到先得」写成 0。
 * - 断言分两组，互不替代：
 *   ① 统一断言：预览值 = 计算结果实际采用的贡献值；
 *   ② 计算断言：计算结果 = 规则对照表期望值（K1：伤害 4545，禁用后 3636）。
 *
 * 运行：npx vite-node scripts/test-event-buff-projection.mjs
 */
import { eventFixture } from './_eventElementHarness.mjs'
import { testAgent } from './_effectPipelineHarness.mjs'
import { createEmptyBuffEffect } from '../src/utils/buffEffect.ts'
import { computeFinalPanel } from '../src/utils/panelBuffCalc.ts'
import { resolveEventBuffPreviewInputs } from '../src/utils/optimalAffixAlloc.ts'
import { evaluateSkillFlowHit } from '../src/utils/skillFlowCalculation.ts'

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

function near(actual, expected, tolerance = 1e-6) {
  return typeof actual === 'number' && Math.abs(actual - expected) <= tolerance
}

/** K1 夹具：团队固定增伤 25%，仅支援职业受益；属性异常事件，触发者为 owner。 */
function k1Fixture(mode) {
  const effect = createEmptyBuffEffect({
    id: 'support-bonus',
    stat: 'dmgBonus',
    value: 25,
    kind: 'fixed',
    enabledDefault: true,
    applyTarget: 'team',
    applyProfession: '支援',
  })
  const fixture = eventFixture({
    mode,
    damageType: 'anomaly',
    effects: [effect],
    agents: [testAgent('owner', { profession: '强攻' }), testAgent('power', { profession: '支援' })],
  })
  const hit = fixture.hits[0]
  hit.multOverrides = { ...hit.multOverrides, anomalyMult: 100 }
  const effectId = fixture.items.find((item) => item.effect.id.endsWith('support-bonus')).effect.id
  return { fixture, hit, effectId }
}

for (const mode of ['ordinary', 'extra-team']) {
  console.log(`== K1 职业限制（${mode}） ==`)
  const { fixture, hit, effectId } = k1Fixture(mode)

  const numeric = evaluateSkillFlowHit(fixture.context, null, hit)
  const detailed = evaluateSkillFlowHit(fixture.context, null, hit, true)
  const disabled = evaluateSkillFlowHit(fixture.context, null, {
    ...hit,
    buffOverride: { disabledEffectIds: [effectId] },
  })
  const preview = resolveEventBuffPreviewInputs(fixture.context, null, hit, 0)
  const previewAmount = preview.effectAmounts[effectId]

  // ② 计算断言：规则对照表期望值
  check('持有者(强攻)不吃职业限定增伤 → 0', near(numeric.finalPanel.dmgBonus, 0), String(numeric.finalPanel.dmgBonus))
  check(
    '强度提供者(支援)吃到 → 25',
    near(numeric.producerFinalPanel.dmgBonus, 25),
    String(numeric.producerFinalPanel.dmgBonus),
  )
  check('数字口径总伤 4545', near(numeric.total, 4545), String(numeric.total))
  check('详情口径总伤 4545', near(detailed.total, 4545), String(detailed.total))
  check('行级禁用后总伤 3636', near(disabled.total, 3636), String(disabled.total))

  // ① 统一断言：预览 = 计算实际采用值（缺陷所在）
  check(
    `预览显示 25（当前实现先到先得，写成了 ${previewAmount}）`,
    near(previewAmount, 25),
    String(previewAmount),
  )
  check(
    '预览值 = 强度提供者实际贡献 25',
    near(previewAmount, numeric.producerFinalPanel.dmgBonus),
    `preview=${previewAmount} power=${numeric.producerFinalPanel.dmgBonus}`,
  )
}

console.log('')
console.log('== K3 全局与行级隔离（普通 / 额外各一次） ==')
for (const mode of ['ordinary', 'extra-team']) {
  const effect = createEmptyBuffEffect({
    id: 'global-atk',
    stat: 'atk',
    value: 50,
    kind: 'fixed',
    enabledDefault: true,
    applyTarget: 'team',
  })
  const fixture = eventFixture({
    mode,
    damageType: 'anomaly',
    effects: [effect],
    agents: [testAgent('owner', { profession: '强攻' }), testAgent('power', { profession: '支援' })],
  })
  const hit = fixture.hits[0]
  const effectId = fixture.items.find((item) => item.effect.id.endsWith('global-atk')).effect.id
  const external = fixture.panels.owner

  // 全局面板：行级例外恒为 null（Spec §2.1 第 5 项）
  const globalCtx = { ...fixture.panelContext, rowBuffOverride: null }
  const globalPanel = computeFinalPanel(external, globalCtx, { includeDetails: false }).finalPanel

  const eventA = evaluateSkillFlowHit(fixture.context, null, hit)
  const eventADisabled = evaluateSkillFlowHit(fixture.context, null, {
    ...hit,
    buffOverride: { disabledEffectIds: [effectId] },
  })
  // 行级禁用不反写全局：再算一次全局面板必须还是 1050
  const globalAfter = computeFinalPanel(external, globalCtx, { includeDetails: false }).finalPanel

  check(`${mode}｜局外 1000 + 全局攻击 50 → 全局 1050`, near(globalPanel.atk, 1050), String(globalPanel.atk))
  check(`${mode}｜事件 A 未禁用 → 1050`, near(eventA.finalPanel.atk, 1050), String(eventA.finalPanel.atk))
  check(`${mode}｜事件 A 禁用该效果 → 1000`, near(eventADisabled.finalPanel.atk, 1000), String(eventADisabled.finalPanel.atk))
  check(`${mode}｜行级禁用不反写全局 → 仍 1050`, near(globalAfter.atk, 1050), String(globalAfter.atk))
}

console.log('')
console.log(`结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
