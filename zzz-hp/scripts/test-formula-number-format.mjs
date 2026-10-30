/**
 * 流程详情「计算过程」数字格式（用户 2026-10-22）：
 * - 箭头右侧的**结果**（蓝色加粗）：取整 + 千分号，三行同一风格；
 * - 等号/箭头**左侧的乘区因子**：不加千分号、最多 3 位小数；
 * - 公式行不再重复「期望 / 不暴击 / 暴击」三档（下方明细已有），
 *   参数表汇总行改为与公式结果同色（不再金色）。
 *
 * 运行：npm run test:formula-number-format
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { makePanel } from './_effectPipelineHarness.mjs'
import { computeDamageResult } from '../src/utils/damageCalc.ts'
import { formatCalcPlain } from '../src/utils/calcNumberFormat.ts'
import { buildAlignedDirectFormulaGroup } from '../src/utils/directDamageDisplay.ts'
import { buildAlignedAnomalyFormulaGroups } from '../src/utils/anomalyFormulaDisplay.ts'

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

/** 与 `DamageResultDetail.vue` 内 `formatNumber` 同口径：取整 + 千分号 */
const resultFormat = (value) => Math.round(value).toLocaleString('en-US')

const enemy = {
  level: 60,
  defense: 953,
  resistanceType: 'normal',
  vulnerableMultiplier: 1,
  staggerMultiplier: 2.1,
  specialMultiplier: 1,
}
function run(panelExtra, subKind) {
  const panel = makePanel({
    atk: 2317,
    critRate: 51,
    critDmg: 174,
    dmgBonus: 103,
    mastery: 280,
    attributeAnomalyMult: 713,
    anomalyDuration: 10,
    radianceMult: 360,
    radianceCritRate: 35,
    radianceCritDmg: 80,
    ...panelExtra,
  })
  return computeDamageResult({
    finalPanel: panel,
    piercePower: 0,
    baseDamageSource: 'atk',
    isMbMainAgent: false,
    enemyInput: enemy,
    combatVulnerable: 0,
    combatStaggerVulnerable: 0,
    combatSpecial: 0,
    staggerPhase: 'stagger',
    ownerAgentLevel: 60,
    triggerFinalPanel: panel,
    triggerAgentLevel: 60,
    anomalyTriggerPanel: panel,
    anomalySubKind: subKind,
    mutationZone: 1.2242,
  })
}

const FACTOR = /^-?\d+(\.\d{1,3})?$/
const RESULT = /^-?\d{1,3}(,\d{3})*$/

console.log('\n[1] formatCalcPlain：无千分号、最多 3 位小数')
{
  check('大数默认保留 3 位且去掉千分号', () => assert.equal(formatCalcPlain(4203.1384), '4203.138'))
  check('超 3 位小数被截到 3 位', () => assert.equal(formatCalcPlain(1.2242), '1.224'))
  check('四位小数按四舍五入收到 3 位', () => assert.equal(formatCalcPlain(0.4617), '0.462'))
  check('两位小数原样保留', () => assert.equal(formatCalcPlain(4.69), '4.69'))
  check('千分位大数不带逗号', () => assert.equal(formatCalcPlain(5871.99), '5871.99'))
  check('整数不带小数点', () => {
    assert.equal(formatCalcPlain(2), '2')
    assert.equal(formatCalcPlain(67428), '67428')
  })
  check('可指定精度（基础伤害用 2 位）', () => assert.equal(formatCalcPlain(4203.138, 2), '4203.14'))
  check('非有限值原样返回', () => {
    assert.equal(formatCalcPlain(Number.NaN), 'NaN')
    assert.equal(formatCalcPlain(Number.POSITIVE_INFINITY), 'Infinity')
  })
  check('一律不含千分号', () => {
    for (const value of [1234.5, 987654.321, 1000000]) {
      assert.ok(!formatCalcPlain(value).includes(','), `${value} → ${formatCalcPlain(value)}`)
    }
  })
}

console.log('\n[2] 异常公式行：因子无千分号 ≤3 位，结果取整 + 千分号')
{
  const result = run({}, 'radiance')
  const groups = buildAlignedAnomalyFormulaGroups(
    result,
    'radiance',
    '耀变伤害',
    formatCalcPlain,
    resultFormat,
  )
  check('耀变链仍是「基础 + 耀变」两组', () => assert.equal(groups.length, 2))
  for (const group of groups) {
    check(`「${group.title}」结果取整 + 千分号`, () => assert.match(group.result, RESULT))
    check(`「${group.title}」因子无千分号且 ≤3 位小数`, () => {
      for (const term of group.terms) {
        assert.ok(!term.value.includes(','), `${term.label} = ${term.value}`)
        assert.match(term.value, FACTOR, `${term.label} = ${term.value}`)
      }
    })
  }
  check('异化系数区在 3 位内（1.224）', () => {
    const term = groups[0].terms.find((item) => item.tipsKey === 'mutationZone')
    assert.ok(term, '缺少异化系数区')
    assert.equal(term.value, '1.224')
  })
  check('异常基础期望因子不带千分号', () => {
    const term = groups[1].terms.find((item) => item.tipsKey === 'anomalyBaseExpected')
    assert.ok(term)
    assert.ok(!term.value.includes(','), term.value)
  })
  check('结果区不再带三档对照（dualResults 已删）', () => {
    for (const group of groups) assert.equal(group.dualResults, undefined)
  })
}

console.log('\n[3] 直伤公式行同样口径，结果与引擎一致')
{
  const result = run({}, 'direct')
  const group = buildAlignedDirectFormulaGroup(result, formatCalcPlain, resultFormat, undefined, 'expected')
  check('直伤结果取整 + 千分号', () => assert.match(group.result, RESULT))
  check('直伤因子无千分号且 ≤3 位小数', () => {
    for (const term of [...group.terms, ...(group.sumMultZones ?? [])]) {
      assert.ok(!term.value.includes(','), `${term.label} = ${term.value}`)
      assert.match(term.value, FACTOR, `${term.label} = ${term.value}`)
    }
  })
  check('通用乘区因子展示与取整结果同源', () => {
    const term = group.terms.find((item) => item.tipsKey === 'generalMultiplier')
    assert.ok(term)
    assert.equal(Number(term.value), Number(formatCalcPlain(result.generalMultiplier)))
  })
}

console.log('\n[4] 组件接线：结果走取整格式、因子走 formatCalcPlain、三档块已移除')
{
  const file = fileURLToPath(new URL('../src/components/calculator/DamageResultDetail.vue', import.meta.url))
  const source = readFileSync(file, 'utf8')
  check('公式结果用 formatNumber（取整 + 千分号）', () => {
    assert.match(source, /result: formatNumber\(p\.generalMultiplier\)/)
  })
  check('两个公式构造器都传入 formatCalcPlain', () => {
    assert.match(source, /buildAlignedDirectFormulaGroup\(props\.calcParts, formatCalcPlain, formatNumber/)
    assert.match(source, /buildAlignedAnomalyFormulaGroups\(\s*props\.calcParts,[\s\S]{0,200}?formatCalcPlain,\s*formatNumber,/)
  })
  check('模板里不再有「暴击口径对照」块', () => {
    assert.ok(!source.includes('暴击口径对照'))
    assert.ok(!source.includes('dualResults'))
  })
  check('参数表汇总行改用公式结果色（不再金色）', () => {
    const totals = source.match(/\.result-(?:total|subtotal) \{[\s\S]*?\}/g) ?? []
    assert.equal(totals.length, 2, `匹配到 ${totals.length} 段`)
    for (const block of totals) {
      assert.ok(block.includes('color: var(--calc-formula-result-color)'), block)
      assert.ok(!block.includes('--calc-accent'), block)
      assert.ok(block.includes('font-weight: 700'), block)
    }
  })
}

console.log(
  failed
    ? `\n❌ ${failed} failed, ${passed} passed`
    : `\n✅ all passed（${passed}）`,
)
if (failed) process.exitCode = 1
