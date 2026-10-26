/**
 * K17 的第二份证据：**真实组件触发路径**。
 *
 * 前半段的证据是「从 SFC 抽出签名表达式 + 生产缓存 + 正式求值」三层（`test-hit-eval-cache.mjs`）；
 * 这里补的是把 `PanelCalcSection` 的真实 setup 挂起来、改响应式输入、看它自己重算签名并换缓存键。
 * 仍不是浏览器端到端（没有 DOM 交互与真实网络），按要求单独标明。
 *
 * 运行：npx vite-node scripts/test-panel-signature-interaction.mjs
 */
import { nextTick, reactive } from 'vue'
import { createPinia } from 'pinia'
import { mountVueSetup } from './_vueSetupHarness.mjs'
import { eventFixture } from './_eventElementHarness.mjs'
import { testAgent } from './_effectPipelineHarness.mjs'
import { createEmptyBuffEffect } from '../src/utils/buffEffect.ts'
import {
  buildHitEvalFingerprint,
  hitEvalCacheKey,
  internHitEvalContext,
} from '../src/utils/hitEvalCache.ts'

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

// 组件 setup 里用到的模块都要给真身（子组件 .vue 由挂载器自动置空）
const imports = {
  pinia: await import('pinia'),
  '@/types/extraBuff': await import('../src/types/extraBuff.ts'),
  '@/types/calculator': await import('../src/types/calculator.ts'),
  '@/types/calculatorPanel': await import('../src/types/calculatorPanel.ts'),
  '@/types/damageCalcHistory': await import('../src/types/damageCalcHistory.ts'),
  '@/types/effectSpec': await import('../src/types/effectSpec.ts'),
  '@/utils/agentPanelSources': await import('../src/utils/agentPanelSources.ts'),
  '@/utils/calculatorUi': await import('../src/utils/calculatorUi.ts'),
  '@/utils/panelBuffCalc': await import('../src/utils/panelBuffCalc.ts'),
  '@/utils/panelSourceResolution': await import('../src/utils/panelSourceResolution.ts'),
  '@/utils/skillFlowPanelSource': await import('../src/utils/skillFlowPanelSource.ts'),
  '@/utils/optimalAffixAlloc': await import('../src/utils/optimalAffixAlloc.ts'),
  '@/utils/skillFlowCalculation': await import('../src/utils/skillFlowCalculation.ts'),
  '@/utils/resolvedHit': await import('../src/utils/resolvedHit.ts'),
  '@/utils/damageCalc': await import('../src/utils/damageCalc.ts'),
  '@/utils/hitEvalCache': await import('../src/utils/hitEvalCache.ts'),
  '@/utils/skillTalentLevels': await import('../src/utils/skillTalentLevels.ts'),
  '@/utils/environmentBuffCalc': await import('../src/utils/environmentBuffCalc.ts'),
  '@/utils/flowBuffTable': await import('../src/utils/flowBuffTable.ts'),
  '@/utils/calcNumberFormat': await import('../src/utils/calcNumberFormat.ts'),
  '@/utils/extraBuffCalc': await import('../src/utils/extraBuffCalc.ts'),
  '@/utils/gameData': await import('../src/utils/gameData.ts'),
  '@/utils/enemyResistance': await import('../src/utils/enemyResistance.ts'),
  '@/utils/buffDamageTypes': await import('../src/utils/buffDamageTypes.ts'),
  '@/utils/multFactorPercent': await import('../src/utils/multFactorPercent.ts'),
  '@/utils/anomalyFormulaDisplay': await import('../src/utils/anomalyFormulaDisplay.ts'),
  '@/utils/skillSubcategoryMult': await import('../src/utils/skillSubcategoryMult.ts'),
  '@/utils/damageZoneSourcePolicy': await import('../src/utils/damageZoneSourcePolicy.ts'),
  '@/utils/panelViewPolicy': await import('../src/utils/panelViewPolicy.ts'),
  '@/utils/remielSelfRadiancePanel': await import('../src/utils/remielSelfRadiancePanel.ts'),
  '@/utils/remielUtils': await import('../src/utils/remielUtils.ts'),
  '@/utils/effectCompiler': await import('../src/utils/effectCompiler.ts'),
  '@/utils/effectAdapters': await import('../src/utils/effectAdapters.ts'),
  '@/utils/damageEvent': await import('../src/utils/damageEvent.ts'),
  '@/stores/calculatorBuffs': await import('../src/stores/calculatorBuffs.ts'),
  '@/composables/useMaskClose': await import('../src/composables/useMaskClose.ts'),
}

const effect = createEmptyBuffEffect({
  id: 'interaction-convert',
  kind: 'convert',
  stat: 'dmgBonus',
  enabledDefault: true,
  applyTarget: 'team',
  convert: { from: 'skillLevelBasic', panelSource: 'external', ratioPercent: 100, initialBase: 0, cap: null },
})
const fixture = eventFixture({ mode: 'ordinary', damageType: 'direct', sourceSlot: 1, effects: [effect] })
const hit = fixture.hits[0]
/**
 * 响应式承载「按角色的技能等级」：生产里它来自 pinia/父组件的响应式状态，改动一定走代理。
 * 注意必须**通过代理**写：Vue 只在代理的 set 里 trigger，直接改裸对象（`raw.power.basic = 12`）
 * 不会通知任何人，签名当然不动 —— 那是测试写法问题，不是组件没重算。
 */
const levels = reactive({ power: { basic: 8 } })

let mounted = null
try {
  mounted = mountVueSetup(new URL('../src/components/calculator/PanelCalcSection.vue', import.meta.url), {
    imports,
    plugins: [createPinia()],
    expose: ['hitCalcGlobalSignature'],
    props: {
      agents: fixture.agents,
      teamSlots: fixture.teamSlots,
      wengines: [],
      driveDiscs: [],
      slotPanels: fixture.panels,
      convertSlotPanels: {},
      slotBuffSelections: null,
      skillTalentLevelsByAgent: levels,
      editedSlotIndex: 0,
      staggerPhase: 'stagger',
      damageKind: 'direct',
      calcMode: 'panel',
      hits: fixture.hits,
      environmentBuffs: [],
      bangboos: [],
      enemyInput: fixture.context.enemyInput,
      selectedBangbooId: 'none',
      bangbooRefine: 1,
      skillCategoryId: 'basic',
      skillSubcategoryId: null,
      affixCounts: {},
      affixDriveDiscMainStats: {},
    },
  })
} catch (error) {
  check('能挂载 PanelCalcSection 的真实 setup', false, String(error?.message ?? error).slice(0, 300))
}

if (mounted) {
  console.log('== K17 真实组件触发：改技能等级 → 组件自己重算签名 ==')
  const vm = mounted.vm
  const signatureBefore = vm.hitCalcGlobalSignature
  check(
    '签名 computed 已暴露且是字符串',
    typeof signatureBefore === 'string' && signatureBefore.length > 0,
    typeof signatureBefore,
  )
  const fingerprintBefore = buildHitEvalFingerprint(hit)
  const keyBefore = hitEvalCacheKey(
    fingerprintBefore,
    internHitEvalContext(signatureBefore),
    fixture.panels.owner,
    false,
  )

  // 真实响应式输入：只改来源角色的普攻等级
  levels.power.basic = 12
  await nextTick()

  const signatureAfter = vm.hitCalcGlobalSignature
  check('改来源角色技能等级 → 组件签名重算', signatureAfter !== signatureBefore,
    signatureAfter === signatureBefore ? '签名未变' : undefined)
  const levelsSegment = (signature) => String(signature).match(/levels=\{[^|]*/)?.[0]
  check(
    '签名字段里确实带着来源角色技能等级（8 → 12）',
    String(signatureBefore).includes('levels={"power":{"basic":8}}')
      && String(signatureAfter).includes('levels={"power":{"basic":12}}'),
    `${levelsSegment(signatureBefore)} → ${levelsSegment(signatureAfter)}`,
  )
  check('同时 hit 指纹不变（隔离其他键轴）', buildHitEvalFingerprint(hit) === fingerprintBefore)
  const keyAfter = hitEvalCacheKey(
    buildHitEvalFingerprint(hit),
    internHitEvalContext(signatureAfter),
    fixture.panels.owner,
    false,
  )
  check('生产缓存键随之变化（不会读到旧结果）', keyAfter !== keyBefore,
    `${keyBefore.slice(0, 14)}… vs ${keyAfter.slice(0, 14)}…`)

  // 反向验证：同一份 computed、同一实例，输入改回去签名就回到原值（不是「每次读都换」的假变化）
  levels.power.basic = 8
  await nextTick()
  check('等级改回 8 → 签名回到原值（同一 computed，无隐藏状态）',
    vm.hitCalcGlobalSignature === signatureBefore,
    `回到 ${levelsSegment(vm.hitCalcGlobalSignature)}`)
  mounted.unmount()
}

console.log('')
console.log(`结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
