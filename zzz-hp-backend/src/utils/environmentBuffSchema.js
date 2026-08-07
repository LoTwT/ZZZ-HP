import pool from '../config/db.js'

let schemaEnsured = false

async function columnExists(table, column) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [table, column],
  )
  return Number(rows[0]?.c) > 0
}

/** 危局/防卫 Buff 结构化效果 + Boss 场地 Buff（挂 boss_info） */
export async function ensureEnvironmentBuffSchema() {
  if (schemaEnsured) return

  if (!(await columnExists('buff', 'effect_blocks'))) {
    await pool.query(
      `ALTER TABLE buff
       ADD COLUMN effect_blocks JSON NULL COMMENT '计算器结构化效果块（BuffEffectBlock[]）'`,
    )
  }

  if (!(await columnExists('boss_info', 'field_buff_name'))) {
    await pool.query(
      `ALTER TABLE boss_info
       ADD COLUMN field_buff_name VARCHAR(100) NULL COMMENT 'Boss 场地 Buff 名称'`,
    )
  }
  if (!(await columnExists('boss_info', 'field_buff_text'))) {
    await pool.query(
      `ALTER TABLE boss_info
       ADD COLUMN field_buff_text TEXT NULL COMMENT 'Boss 场地 Buff 文本说明'`,
    )
  }
  if (!(await columnExists('boss_info', 'field_buff_image'))) {
    await pool.query(
      `ALTER TABLE boss_info
       ADD COLUMN field_buff_image VARCHAR(500) NULL COMMENT 'Boss 场地 Buff 图片'`,
    )
  }
  if (!(await columnExists('boss_info', 'field_buff_effect_blocks'))) {
    await pool.query(
      `ALTER TABLE boss_info
       ADD COLUMN field_buff_effect_blocks JSON NULL COMMENT 'Boss 场地 Buff 结构化效果块'`,
    )
  }

  schemaEnsured = true
}

export function parseEffectBlocksJson(value) {
  if (value == null || value === '') return null
  if (Array.isArray(value)) return value
  if (typeof value === 'object') return value
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function serializeEffectBlocks(value) {
  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    try {
      const parsed = JSON.parse(trimmed)
      return Array.isArray(parsed) && parsed.length ? JSON.stringify(parsed) : null
    } catch {
      return null
    }
  }
  if (Array.isArray(value)) {
    if (!value.length) return null
    try {
      // 去掉 undefined / 不可序列化字段，避免写入 JSON 列失败
      return JSON.stringify(JSON.parse(JSON.stringify(value)))
    } catch {
      return null
    }
  }
  return null
}
