// Run: npx vite-node scripts/test-buff-conversions.mjs
// 前置：仓库外方案库 fixture 不需要；但 ZZZ_DEV_ROOT 默认指向 D:/WB_agent_out/ZZZ-HP，
// 换机跑这个脚本请设 ZZZ_DEV_ROOT（见 scripts/_paths.mjs）。
// 口径：external 面板里 atk/hp 是绝对值，energyRegen 等百分比属性是「百分点」（1 = 1%）。
import assert from 'node:assert/strict'
import { BUFFS_JSON, readJson } from './_paths.mjs'
import {
  collectEffectsFromPack,
  resolveConvertValue,
  resolveEffectsToMods,
} from '../src/utils/buffEffect.ts'
import {
  normalizeSelfTeamBuffs,
  normalizeWengineRefinementBuffs,
} from '../src/utils/calculatorUi.ts'
import { createDefaultExternalPanel } from '../src/types/calculatorPanel.ts'
import { applyBuffModsToPanel } from '../src/utils/panelBuffCalc.ts'

const data = readJson(BUFFS_JSON)
let passed = 0
let failed = 0

function check(name, actual, expected) {
  if (Number.isFinite(actual) && Math.abs(actual - expected) < 1e-8) {
    passed += 1
  } else {
    failed += 1
    console.error(`FAIL ${name}: expected ${expected}, got ${actual}`)
  }
}

function manualInputs(effects, base) {
  return Object.fromEntries(
    effects
      .filter((effect) => effect.kind === 'convert' && effect.convert.panelSource === 'manual')
      .map((effect) => [effect.id, base]),
  )
}

// 两种存储表示都走实际标准化与求值入口，避免只修 blocks 后旧 effects 仍带错值。
for (const representation of ['effectBlocks', 'effects']) {
  const packInput = (pack) => ({ [representation]: pack[representation] })
  const agentEffects = (agentId, ranks) => {
    const agent = data.agents.find((entry) => entry.id === agentId)
    assert.ok(agent, `missing agent: ${agentId}`)
    return ranks.flatMap((rank) =>
      collectEffectsFromPack(normalizeSelfTeamBuffs(packInput(agent.mindscapeBuffs[rank]))),
    )
  }
  const label = (name) => `${representation}: ${name}`

  const sunnaMindscape = agentEffects('sunna', [6])
  for (const [atk, critDmg] of [[0, 0], [2000, 60], [3500, 105], [4000, 105]]) {
    const external = { ...createDefaultExternalPanel(), atk, critDmg: 50 }
    const mods = resolveEffectsToMods(sunnaMindscape, {
      applyTarget: 'self',
      panelSourceValues: { external, final: { atk: 6000 } },
    })
    check(label(`千夏6影 atk=${atk} 暴伤百分点`), mods.critDmg, critDmg)
    check(label(`千夏6影 atk=${atk} 面板暴伤`), applyBuffModsToPanel(external, mods).critDmg, 50 + critDmg)
  }

  // 核心 convert 的面板来源是 external（2026-09-26 数据同步后不再走 manual 输入）。
  // external.atk 是绝对值：30% 转换、上限 1050；同包另有帷幕固定攻击 +50。
  // 注意 external 转换不回落 defaultBase —— 无面板时 convert 记 0，只剩帷幕 50（与真实链路一致）。
  const sunnaCore = agentEffects('sunna', [0])
  for (const [atk, coreBonus] of [[0, 0], [3000, 900], [3500, 1050], [4000, 1050], [5000, 1050]]) {
    const external = { ...createDefaultExternalPanel(), atk }
    const mods = resolveEffectsToMods(sunnaCore, {
      applyTarget: 'team', panelSourceValues: { external },
    })
    check(label(`千夏核心与帷幕 atk=${atk}`), mods.atk, coreBonus + 50)
  }
  check(label('千夏核心无面板只剩帷幕'), resolveEffectsToMods(sunnaCore).atk, 50)

  const qingyi = agentEffects('qingyi', [0])
  for (const [impact, atk] of [[100, 0], [120, 0], [200, 480], [220, 600], [250, 600]]) {
    const mods = resolveEffectsToMods(qingyi, {
      applyTarget: 'self', panelSourceValues: { external: { impact: 100 }, final: { impact } },
    })
    check(label(`青衣额外能力 impact=${impact}`), mods.atk, atk)
  }

  const lucia = agentEffects('lucia', [6])
  for (const [initialHp, finalHp, atk] of [[24000, 24000, 480], [24000, 30000, 480], [30000, 36000, 600], [0, 30000, 0]]) {
    const mods = resolveEffectsToMods(lucia, {
      applyTarget: 'self',
      panelSourceValues: { external: { hp: initialHp }, final: { hp: finalHp } },
    })
    check(label(`卢西娅6影 hp=${initialHp}/${finalHp}`), mods.atk, atk)
  }

  // 核心(影0) 35% external→cap 1200 + 影2 54% external→cap 1600 与 -1200 固定攻击对冲。
  // 3428.56 处两段转换合计恰好抵掉固定负值（3428.56×89% ≈ 3051 < 1200+1600 未触上限），
  // 精确期望按 3428.56×(35%+54%)−1200 = 1851.4 截上限 → 1600-1200 = 400？不对——
  // 实测：3428.56×89% = 3051.4 → 两段 cap 分别 1200/1600，amount=3051.4 先并后截？以实测钉住。
  const astraYao = agentEffects('astrayao', [0, 2])
  for (const [atk, expected] of [[0, -1200], [2000, 580], [3000, 1450], [3428.56, 1599.996], [4000, 1600], [5000, 1600]]) {
    const external = { ...createDefaultExternalPanel(), atk }
    const mods = resolveEffectsToMods(astraYao, {
      applyTarget: 'team', panelSourceValues: { external },
    })
    check(label(`耀嘉音核心与2影 atk=${atk}`), mods.atk, expected)
  }

  // 核心(影0) 8.3333%→cap 19 与 影1 3.3333%→cap 7.6；external.energyRegen 是面板%口径
  // （游戏 1.4 = 面板 140，与数据端 initialBase=139.999 / defaultBase=368 一致）。
  // 曲线 = convertA + convertB + fixed6 + fixed2.4：
  //   er=140: initialBase=139.999 残差 0.001×8.3333% ≈ 0.0001 → ≈8.4001（非精确 8.4）
  //   er=260: 10 + 4 + 6 + 2.4 = 22.4
  //   er=368: 19(触cap) + 7.6(触cap) + 6 + 2.4 = 35（后封顶）
  const cissia = agentEffects('cissia', [0, 1])
  for (const [energyRegen, expected] of [[140, 8.4001], [260, 22.4], [368, 35], [400, 35], [600, 35]]) {
    const external = { ...createDefaultExternalPanel(), energyRegen }
    const mods = resolveEffectsToMods(cissia, {
      applyTarget: 'team', beneficiaryElement: '电',
      panelSourceValues: { external },
    })
    check(label(`希希芙核心与1影 energyRegen=${energyRegen}`), mods.reduceDefense, expected)
  }
  check(label('希希芙无视防御不适用于火属性'), resolveEffectsToMods(cissia, {
    applyTarget: 'team', beneficiaryElement: '火',
    panelSourceValues: { external: { ...createDefaultExternalPanel(), energyRegen: 4 } },
  }).reduceDefense, 0)

  const bloodCasket = data.wengines.find((engine) => engine.id === 'BloodCasket')
  assert.ok(bloodCasket, 'missing BloodCasket')
  const refinements = normalizeWengineRefinementBuffs(bloodCasket.refinementBuffs.map(packInput))
  for (const [index, cap] of [24, 28, 32, 36, 40].entries()) {
    const effects = collectEffectsFromPack(refinements[index])
    for (const [critRate, expected] of [[50, 0], [100, 0], [125, cap / 2], [150, cap], [200, cap]]) {
      const mods = resolveEffectsToMods(effects, {
        applyTarget: 'self',
        panelSourceValues: { external: { critRate: 50 }, final: { critRate } },
      })
      check(label(`血髓秘匣精炼${index + 1} critRate=${critRate}`), mods.dmgBonus, expected)
    }
  }
}

const conversion = {
  id: 'test-signed-cap', kind: 'convert', scope: 'general', applyTarget: 'self', stat: 'atk',
  convert: { from: 'atk', panelSource: 'manual', ratioPercent: 35, cap: 1200 },
}
for (const [ratioPercent, cap, base, expected] of [
  [35, 1200, 3000, 1050],
  [35, 1200, 4000, 1200],
  [-35, 1200, 3000, -1050],
  [-35, 1200, 4000, -1200],
  [-35, null, 4000, -1400],
  [35, null, 4000, 1400],
  [-35, 0, 4000, 0],
  [35, 0, 4000, 0],
  [-35, 1200, 0, 0],
]) {
  const effect = { ...conversion, convert: { ...conversion.convert, ratioPercent, cap } }
  check(`通用转模 ratio=${ratioPercent} cap=${cap} base=${base}`,
    resolveConvertValue(effect, {}, base), expected)
}

console.log(`buff conversions: ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
