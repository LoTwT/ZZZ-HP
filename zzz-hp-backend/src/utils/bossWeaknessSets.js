/**
 * 危局 Boss 多套弱点 / 抗性（monster library → boss_info.weakness_sets）。
 *
 * 形状：[{ id, label, weakness, resistance, resistanceHigh }]
 * - weakness / resistance：元素名以空格连接，与 boss 表同口径（如「冰 以太」）
 * - resistanceHigh：resistance 的子集（40% 高抗性）
 * 只保留至少有一项内容的套；id 稳定，空 id 用序号兜底。
 */

const MAX_SETS = 8

function asText(value) {
  if (value == null) return null
  const text = String(value).trim()
  return text || null
}

export function normalizeWeaknessSet(raw, fallbackId) {
  if (!raw || typeof raw !== 'object') return null
  const weakness = asText(raw.weakness)
  const resistance = asText(raw.resistance)
  const resistanceHigh = asText(raw.resistanceHigh ?? raw.resistance_high)
  if (!weakness && !resistance && !resistanceHigh) return null
  return {
    id: asText(raw.id) ?? fallbackId,
    label: asText(raw.label),
    weakness,
    resistance,
    resistanceHigh,
  }
}

function normalizeList(list) {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  list.forEach((item, index) => {
    const set = normalizeWeaknessSet(item, `set-${index + 1}`)
    if (!set) return
    let id = set.id
    let suffix = 1
    while (seen.has(id)) id = `${set.id}-${++suffix}`
    seen.add(id)
    out.push({ ...set, id })
  })
  return out.slice(0, MAX_SETS)
}

export function parseWeaknessSetsJson(value) {
  if (Array.isArray(value)) return normalizeList(value)
  if (typeof value === 'string' && value.trim()) {
    try {
      return normalizeList(JSON.parse(value))
    } catch {
      return []
    }
  }
  return []
}

export function serializeWeaknessSets(sets) {
  const normalized = parseWeaknessSetsJson(sets)
  return normalized.length ? JSON.stringify(normalized) : null
}

/** 第一套镜像到 boss_info 的基础三列（旧字段继续作为兼容口径） */
export function mirrorWeaknessLegacyColumns(sets) {
  const first = parseWeaknessSetsJson(sets)[0] ?? null
  return {
    weakness: first?.weakness ?? null,
    resistance: first?.resistance ?? null,
    resistance_high: first?.resistanceHigh ?? null,
  }
}

/** 旧单套三列 → 一套（id 固定 legacy），供没有多套的怪物继续沿用之前的格式 */
export function weaknessSetsFromLegacy(row) {
  if (!row || typeof row !== 'object') return []
  const set = normalizeWeaknessSet(
    {
      id: 'legacy',
      weakness: row.weakness,
      resistance: row.resistance,
      resistanceHigh: row.resistanceHigh ?? row.resistance_high,
    },
    'legacy',
  )
  return set ? [set] : []
}
