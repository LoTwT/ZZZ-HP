/**
 * 运行时验证：异放倍率按产生角色属性筛选主 C 异放倍率增益
 * 运行：node --import tsx scripts/test-release-mult.mjs
 */
import { createDefaultExternalPanel } from '../src/types/calculatorPanel.ts'
import { createEmptySelfTeamBuffs } from '../src/utils/calculatorUi.ts'
import { resolveAnomalyReleaseMultFields, resolveAnomalyReleaseSkillConvertMods } from '../src/utils/panelBuffCalc.ts'

const mainAgentId = 'main-ether'
const external = createDefaultExternalPanel()
external.anomalyReleaseMult = 50

const fireBuff = {
  id: 'buff-fire',
  scope: 'anomalyRelease',
  applyTarget: 'self',
  elementFilter: ['火'],
  kind: 'fixed',
  stat: 'anomalyReleaseMult',
  value: 20,
}

const physBuff = {
  id: 'buff-phys',
  scope: 'anomalyRelease',
  applyTarget: 'self',
  elementFilter: ['物理'],
  kind: 'fixed',
  stat: 'anomalyReleaseMult',
  value: 30,
}

const agent = {
  id: mainAgentId,
  name: '测试主C',
  element: '以太',
  profession: '异常',
  avatar_image: null,
  basePanel: {},
  mindscapeBuffs: [
    {
      ...createEmptySelfTeamBuffs(),
      effects: [fireBuff, physBuff],
    },
  ],
}

const ctx = {
  teamSlots: [{ agentId: mainAgentId, rank: 0, wengineId: 'none', wengineRefine: 1, twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'none' }],
  agents: [agent],
  wengines: [],
  bangboo: { id: 'none', name: '无', effects: [], refinementEffects: [] },
  bangbooRefine: 1,
  mainSlotIndex: 0,
  driveDiscs: [],
  buffSelection: { enabledIds: {}, stacksByEffectId: {}, convertInputs: {} },
}

const fireResult = resolveAnomalyReleaseMultFields(external, ctx, '火')
const physResult = resolveAnomalyReleaseMultFields(external, ctx, '物理')

let failed = false
if (fireResult.anomalyReleaseMult !== 70) {
  console.error(`FAIL 火触发: 期望 70，实际 ${fireResult.anomalyReleaseMult}`)
  failed = true
} else {
  console.log(`PASS 火触发: 异放倍率% = ${fireResult.anomalyReleaseMult}`)
}

if (physResult.anomalyReleaseMult !== 80) {
  console.error(`FAIL 物理触发: 期望 80，实际 ${physResult.anomalyReleaseMult}`)
  failed = true
} else {
  console.log(`PASS 物理触发: 异放倍率% = ${physResult.anomalyReleaseMult}`)
}

// 等级转模：按「效果来源角色」取技能等级（自身 12 级普攻 ×2000% → +240；队友 8 级 ×1000% → +80）
const selfFixed = {
  id: 'buff-self-fixed',
  scope: ['skill', 'anomalyRelease'],
  applyTarget: 'self',
  kind: 'fixed',
  stat: 'anomalyReleaseMult',
  value: 205,
}
const selfConvert = {
  id: 'buff-self-convert',
  scope: ['skill', 'anomalyRelease'],
  applyTarget: 'self',
  kind: 'convert',
  stat: 'anomalyReleaseMult',
  value: 0,
  convert: {
    from: 'skillLevelBasic',
    panelSource: 'external',
    ratioPercent: 2000,
    defaultBase: null,
    initialBase: 0,
    cap: null,
  },
}
const teamConvert = {
  id: 'buff-team-convert',
  scope: ['skill', 'anomalyRelease'],
  applyTarget: 'team',
  kind: 'convert',
  stat: 'anomalyReleaseMult',
  value: 0,
  convert: {
    from: 'skillLevelBasic',
    panelSource: 'external',
    ratioPercent: 1000,
    defaultBase: null,
    initialBase: 0,
    cap: null,
  },
}
const mainWithConvert = {
  ...agent,
  id: 'main-convert',
  mindscapeBuffs: [{ ...createEmptySelfTeamBuffs(), effects: [selfFixed, selfConvert] }],
}
const mateWithConvert = {
  id: 'mate-convert',
  name: '测试队友',
  element: '以太',
  profession: '强攻',
  avatar_image: null,
  basePanel: {},
  mindscapeBuffs: [{ ...createEmptySelfTeamBuffs(), effects: [teamConvert] }],
}
const convertCtx = {
  ...ctx,
  teamSlots: [
    { agentId: 'main-convert', rank: 0, wengineId: 'none', wengineRefine: 1, twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'none' },
    { agentId: 'mate-convert', rank: 0, wengineId: 'none', wengineRefine: 1, twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'none' },
  ],
  agents: [mainWithConvert, mateWithConvert],
  skillTalentLevelsByAgent: {
    'main-convert': { basic: 12 },
    'mate-convert': { basic: 8 },
  },
}
const convertExternal = createDefaultExternalPanel()
const convertResult = resolveAnomalyReleaseMultFields(convertExternal, convertCtx, '以太')
const expectedConvert = 205 + 240 + 80
if (convertResult.anomalyReleaseMult !== expectedConvert) {
  console.error(
    `FAIL 等级转模: 期望 ${expectedConvert}，实际 ${convertResult.anomalyReleaseMult}`,
  )
  failed = true
} else {
  console.log(`PASS 等级转模: 异放倍率% = ${convertResult.anomalyReleaseMult}`)
}

// 行级增量（方案 A）：只补「限定到本招式」的 convert，固定值不计，两块异放互不串味
const basicSub = 'sub-basic'
const ultSub = 'sub-ultimate'
const rowFixed = {
  id: 'row-fixed',
  scope: ['skill', 'anomalyRelease'],
  applyTarget: 'self',
  kind: 'fixed',
  stat: 'anomalyReleaseMult',
  value: 205,
  skillCategory: 'basic',
  skillSubcategoryId: basicSub,
  appliesToAnomaly: true,
}
const rowBasicConvert = {
  id: 'row-basic-convert',
  scope: ['skill', 'anomalyRelease'],
  applyTarget: 'self',
  kind: 'convert',
  stat: 'anomalyReleaseMult',
  value: 0,
  skillCategory: 'basic',
  skillSubcategoryId: basicSub,
  appliesToAnomaly: true,
  convert: {
    from: 'skillLevelBasic',
    panelSource: 'external',
    ratioPercent: 2000,
    defaultBase: null,
    initialBase: 0,
    cap: null,
  },
}
const rowUltConvert = {
  ...rowBasicConvert,
  id: 'row-ult-convert',
  skillCategory: 'ultimate',
  skillSubcategoryId: ultSub,
  convert: {
    from: 'skillLevelChainUltimate',
    panelSource: 'external',
    ratioPercent: 2700,
    defaultBase: null,
    initialBase: 0,
    cap: null,
  },
}
const rowAgent = {
  ...agent,
  id: 'row-agent',
  mindscapeBuffs: [
    { ...createEmptySelfTeamBuffs(), effects: [rowFixed, rowBasicConvert, rowUltConvert] },
  ],
}
const rowCtx = {
  ...ctx,
  teamSlots: [
    { agentId: 'row-agent', rank: 0, wengineId: 'none', wengineRefine: 1, twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'none' },
  ],
  agents: [rowAgent],
  skillTalentLevelsByAgent: { 'row-agent': { basic: 12, chainUltimate: 12 } },
}
const basicCoords = {
  damageKind: 'anomaly',
  anomalySubKind: 'anomalyRelease',
  element: '以太',
  categoryId: 'basic',
  subcategoryId: basicSub,
  coords: [{ category: 'basic', subcategoryId: basicSub }],
}
const ultCoords = {
  ...basicCoords,
  categoryId: 'ultimate',
  subcategoryId: ultSub,
  coords: [{ category: 'ultimate', subcategoryId: ultSub }],
}
const basicOnly = resolveAnomalyReleaseSkillConvertMods(
  { ...rowCtx, skillContext: basicCoords },
  '以太',
).anomalyReleaseMult
const ultOnly = resolveAnomalyReleaseSkillConvertMods(
  { ...rowCtx, skillContext: ultCoords },
  '以太',
).anomalyReleaseMult
if (basicOnly !== 240 || ultOnly !== 324) {
  console.error(`FAIL 行级等级转模: 期望 240 / 324，实际 ${basicOnly} / ${ultOnly}`)
  failed = true
} else {
  console.log(`PASS 行级等级转模: 焚罪 +${basicOnly} / 烬火 +${ultOnly}`)
}

{
  const { r3Fixture } = await import('./_eventElementHarness.mjs')
  for (const mode of ['ordinary', 'extra-slot', 'extra-team']) {
    const f = r3Fixture(mode)
    const actual = resolveAnomalyReleaseSkillConvertMods(f.panelContext, '电').anomalyReleaseMult
    if (actual !== 1.2) { failed = true; console.error(`FAIL R3 ${mode} cross-element ${actual}`) }
    else console.log(`PASS R3 ${mode} cross-element 1.2`)
  }
}

process.exit(failed ? 1 : 0)
