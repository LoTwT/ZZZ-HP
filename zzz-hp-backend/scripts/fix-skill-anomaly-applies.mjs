import mysql from 'mysql2/promise'
import dotenv from 'dotenv'

dotenv.config()

/** 天然属于异常/耀变乘区的 stat：skill 限定时默认应可作用于异常伤害 */
const INHERENT_ANOMALY_STATS = new Set([
  'anomalyMult',
  'anomalyMultFactor',
  'anomalyReleaseMult',
  'anomalyReleaseMultFactor',
  'disorderBaseMult',
  'disorderBaseMultFactor',
  'disorderCompMult',
  'disorderDmgBonus',
  'turbulenceBaseMult',
  'turbulenceBaseMultFactor',
  'turbulenceCompMult',
  'turbulenceDmgBonus',
  'radianceMult',
  'radianceMultFactor',
  'radianceDmgBonus',
  'radianceResPen',
  'anomalyDmgBonus',
  'anomalyCritRate',
  'anomalyCritDmg',
  'anomalyDuration',
  'mutationZone',
])

function fixNode(node) {
  let changed = 0
  if (Array.isArray(node)) {
    for (const item of node) changed += fixNode(item)
    return changed
  }
  if (!node || typeof node !== 'object') return 0

  if (
    node.scope === 'skill' &&
    INHERENT_ANOMALY_STATS.has(node.stat) &&
    node.appliesToAnomaly !== true
  ) {
    node.appliesToAnomaly = true
    changed += 1
  }

  for (const value of Object.values(node)) changed += fixNode(value)
  return changed
}

const c = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'zzz',
  charset: 'utf8mb4',
})

const [rows] = await c.query(
  'SELECT id, name, mindscape_buffs, raw_json FROM `character`',
)
let totalEffects = 0
const touched = []

for (const row of rows) {
  let changed = 0
  let mindscape = row.mindscape_buffs
    ? typeof row.mindscape_buffs === 'string'
      ? JSON.parse(row.mindscape_buffs)
      : structuredClone(row.mindscape_buffs)
    : null
  let raw = row.raw_json
    ? typeof row.raw_json === 'string'
      ? JSON.parse(row.raw_json)
      : structuredClone(row.raw_json)
    : null

  if (mindscape) changed += fixNode(mindscape)
  if (raw) changed += fixNode(raw)

  if (!changed) continue
  totalEffects += changed
  touched.push({ id: row.id, name: row.name, fixed: changed })
  await c.query(
    'UPDATE `character` SET mindscape_buffs = ?, raw_json = ? WHERE id = ?',
    [
      mindscape ? JSON.stringify(mindscape) : row.mindscape_buffs,
      raw ? JSON.stringify(raw) : row.raw_json,
      row.id,
    ],
  )
}

console.log(JSON.stringify({ touched, totalEffects }, null, 2))
await c.end()
