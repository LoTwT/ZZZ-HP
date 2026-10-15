/**
 * 异常条系数内置默认表与解析（boss_info 覆盖 > 内置默认 > null）
 * 运行：node --test scripts/anomaly-bar-coefficient.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ANOMALY_BAR_COEFFICIENT_BY_NAME,
  resolveAnomalyBarCoefficient,
} from '../src/utils/anomalyBarCoefficient.js'
import { normalizeAnomalyBarCoefficient } from '../src/utils/bossSchema.js'

test('默认表共 18 条，且均为有限正数', () => {
  const entries = Object.entries(ANOMALY_BAR_COEFFICIENT_BY_NAME)
  assert.equal(entries.length, 18)
  for (const [name, coefficient] of entries) {
    assert.ok(name.length > 0)
    assert.ok(Number.isFinite(coefficient) && coefficient > 0, `${name} 系数非法`)
  }
})

test('内置默认：带括号与不带括号两种写法都能命中「亵渎者」', () => {
  assert.equal(resolveAnomalyBarCoefficient('亵渎者', null), 1.32)
  assert.equal(resolveAnomalyBarCoefficient('「亵渎者」', null), 1.32)
})

test('内嵌括号名：自律强袭单位·提丰·破坏者型 ⇒ 1.1', () => {
  assert.equal(resolveAnomalyBarCoefficient('自律强袭单位·提丰·破坏者型', null), 1.1)
  assert.equal(resolveAnomalyBarCoefficient('自律强袭单位·「提丰·破坏者型」', null), 1.1)
})

test('默认表：猎血清道夫 ⇒ 1.0625', () => {
  assert.equal(resolveAnomalyBarCoefficient('猎血清道夫', null), 1.0625)
})

test('未知名称 ⇒ null（不按 1 兜底，由调用方决定）', () => {
  assert.equal(resolveAnomalyBarCoefficient('不存在的怪物', null), null)
  assert.equal(resolveAnomalyBarCoefficient('猎血清道夫·改', undefined), null)
})

test('空 / 空白名称 ⇒ null', () => {
  assert.equal(resolveAnomalyBarCoefficient(null, null), null)
  assert.equal(resolveAnomalyBarCoefficient(undefined, null), null)
  assert.equal(resolveAnomalyBarCoefficient('', null), null)
  assert.equal(resolveAnomalyBarCoefficient('　  ', null), null)
})

test('显式覆盖值优先于内置默认表', () => {
  assert.equal(resolveAnomalyBarCoefficient('亵渎者', 1.5), 1.5)
  assert.equal(resolveAnomalyBarCoefficient('不存在的怪物', 2.5), 2.5)
  assert.equal(resolveAnomalyBarCoefficient('死路屠夫', 1.75), 1.75)
})

test('非法显式值回退内置默认表', () => {
  for (const invalid of [0, -1, NaN, Infinity, -Infinity, '']) {
    assert.equal(
      resolveAnomalyBarCoefficient('亵渎者', invalid),
      1.32,
      `显式值 ${String(invalid)} 应回退默认表`,
    )
  }
  assert.equal(resolveAnomalyBarCoefficient('不存在的怪物', 0), null)
})

// DECIMAL 列经 mysql2 返回字符串，读路径先归一化再当显式覆盖值传入（bossInfoService / crisisAssaultService 同口径）
test('mysql2 字符串覆盖值：归一化后优先生效', () => {
  assert.equal(
    resolveAnomalyBarCoefficient('亵渎者', normalizeAnomalyBarCoefficient('1.5000')),
    1.5,
  )
  assert.equal(
    resolveAnomalyBarCoefficient('不存在的怪物', normalizeAnomalyBarCoefficient('1.2500')),
    1.25,
  )
  assert.equal(resolveAnomalyBarCoefficient('亵渎者', normalizeAnomalyBarCoefficient(null)), 1.32)
})
