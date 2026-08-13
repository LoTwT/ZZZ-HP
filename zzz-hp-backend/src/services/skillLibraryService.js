import pool from '../config/db.js'

const TABLE = '`calculator_skills`'

let ensured = false

async function ensureTable() {
  if (ensured) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS calculator_skills (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      agent_id VARCHAR(64) NOT NULL DEFAULT '',
      name VARCHAR(128) NOT NULL,
      damage_type VARCHAR(32) NOT NULL DEFAULT 'direct',
      skill_types TEXT NULL,
      buff_anchor_id VARCHAR(64) NULL,
      base_mult DOUBLE NOT NULL DEFAULT 0,
      base_mult_factor DOUBLE NOT NULL DEFAULT 100,
      settlement_mult DOUBLE NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  ensured = true
}

function readNumber(value, fallback) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function parseSkillTypes(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : []
  } catch {
    return []
  }
}

function rowToDoc(row) {
  return {
    id: String(row.id),
    agentId: String(row.agent_id ?? ''),
    name: String(row.name ?? ''),
    source: 'preset',
    damageType: String(row.damage_type ?? 'direct'),
    skillTypes: parseSkillTypes(row.skill_types),
    buffAnchorId:
      row.buff_anchor_id == null || row.buff_anchor_id === ''
        ? null
        : String(row.buff_anchor_id),
    baseMult: readNumber(row.base_mult, 0),
    baseMultFactor: readNumber(row.base_mult_factor, 100),
    settlementMult: readNumber(row.settlement_mult, 0),
  }
}

export async function listSkills() {
  await ensureTable()
  const [rows] = await pool.query(
    `SELECT * FROM ${TABLE} ORDER BY agent_id ASC, damage_type ASC, sort_order ASC, name ASC, id ASC`,
  )
  return rows.map(rowToDoc)
}

export async function upsertSkill(doc) {
  await ensureTable()
  let id = String(doc.id ?? '').trim()
  const agentId = String(doc.agentId ?? '').trim()
  const name = String(doc.name ?? '').trim()
  const damageType = String(doc.damageType ?? 'direct').trim()
  const skillTypes = Array.isArray(doc.skillTypes) ? doc.skillTypes.map((i) => String(i)) : []
  const buffAnchorId =
    doc.buffAnchorId == null || doc.buffAnchorId === '' ? null : String(doc.buffAnchorId).trim()
  const baseMult = readNumber(doc.baseMult, 0)
  const baseMultFactor = readNumber(doc.baseMultFactor, 100)
  const settlementMult = readNumber(doc.settlementMult, 0)

  if (!name) throw new Error('招式名称为必填项')
  if (!damageType) throw new Error('伤害类型为必填项')
  if (!id) {
    const stamp = Date.now().toString(36)
    const prefix = agentId || 'all'
    id = `sk-${prefix}-${damageType}-${stamp}`.slice(0, 64)
  }

  await pool.query(
    `INSERT INTO calculator_skills
      (id, agent_id, name, damage_type, skill_types, buff_anchor_id,
       base_mult, base_mult_factor, settlement_mult, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE
       agent_id = VALUES(agent_id),
       name = VALUES(name),
       damage_type = VALUES(damage_type),
       skill_types = VALUES(skill_types),
       buff_anchor_id = VALUES(buff_anchor_id),
       base_mult = VALUES(base_mult),
       base_mult_factor = VALUES(base_mult_factor),
       settlement_mult = VALUES(settlement_mult)`,
    [
      id,
      agentId,
      name,
      damageType,
      JSON.stringify(skillTypes),
      buffAnchorId,
      baseMult,
      baseMultFactor,
      settlementMult,
    ],
  )

  const [rows] = await pool.query(`SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`, [id])
  return rowToDoc(rows[0])
}

export async function deleteSkill(id) {
  await ensureTable()
  const safeId = String(id ?? '').trim()
  if (!safeId) throw new Error('缺少招式 ID')
  await pool.query(`DELETE FROM ${TABLE} WHERE id = ?`, [safeId])
  return { id: safeId }
}
