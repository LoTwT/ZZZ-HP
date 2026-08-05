import pool from '../config/db.js'
import { getCrisisBaseHpByName } from '../utils/crisisHpCoeff.js'
import {
  DEFAULT_BOSS_STAGGER_MULTIPLIER,
  ensureBossStaggerSchema,
  normalizeStaggerMultiplier,
} from '../utils/bossSchema.js'

function normalizeBossInfo(payload) {
  const crisisBaseHpRaw = payload.crisis_base_hp
  let crisis_base_hp = null
  if (crisisBaseHpRaw != null && crisisBaseHpRaw !== '') {
    const n = Number(crisisBaseHpRaw)
    if (Number.isFinite(n) && n > 0) crisis_base_hp = n
  } else {
    const fromMap = getCrisisBaseHpByName(payload.boss_name)
    if (fromMap != null) crisis_base_hp = fromMap
  }

  return {
    boss_name: String(payload.boss_name ?? '').trim(),
    defense: Number(payload.defense ?? 0),
    level: Number(payload.level ?? 1),
    weakness: payload.weakness?.trim() || null,
    resistance: payload.resistance?.trim() || null,
    boss_image: payload.boss_image?.trim() || null,
    crisis_base_hp,
    stagger_multiplier: normalizeStaggerMultiplier(
      payload.stagger_multiplier,
      DEFAULT_BOSS_STAGGER_MULTIPLIER,
    ),
  }
}

function bossInfoDiffers(existing, incoming) {
  const existingBase =
    existing.crisis_base_hp == null ? null : Number(existing.crisis_base_hp)
  const incomingBase =
    incoming.crisis_base_hp == null ? null : Number(incoming.crisis_base_hp)
  return (
    Number(existing.defense) !== incoming.defense ||
    Number(existing.level) !== incoming.level ||
    (existing.weakness ?? '') !== (incoming.weakness ?? '') ||
    (existing.resistance ?? '') !== (incoming.resistance ?? '') ||
    (existing.boss_image ?? '') !== (incoming.boss_image ?? '') ||
    existingBase !== incomingBase ||
    normalizeStaggerMultiplier(existing.stagger_multiplier) !==
      normalizeStaggerMultiplier(incoming.stagger_multiplier)
  )
}

function mapBossInfoRow(row) {
  if (!row) return null
  return {
    ...row,
    stagger_multiplier: normalizeStaggerMultiplier(row.stagger_multiplier),
    crisis_base_hp:
      row.crisis_base_hp == null ? getCrisisBaseHpByName(row.boss_name) : Number(row.crisis_base_hp),
  }
}

export async function findBossInfoByName(bossName) {
  await ensureBossStaggerSchema()
  const name = String(bossName ?? '').trim()
  if (!name) return null

  const [rows] = await pool.execute(
    `SELECT id, boss_name, defense, level, boss_image, weakness, resistance, crisis_base_hp, stagger_multiplier
     FROM boss_info
     WHERE boss_name = ?
     LIMIT 1`,
    [name],
  )

  return mapBossInfoRow(rows[0])
}

export async function searchBossInfoNames(keyword, limit = 20) {
  await ensureBossStaggerSchema()
  const query = String(keyword ?? '').trim()
  if (!query) return []

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50)

  const [rows] = await pool.execute(
    `SELECT boss_name
     FROM boss_info
     WHERE boss_name LIKE ?
     ORDER BY boss_name
     LIMIT ${safeLimit}`,
    [`%${query}%`],
  )

  return rows.map((row) => row.boss_name)
}

export async function listBossInfoRecords({ keyword = '', limit = 100, offset = 0 } = {}) {
  await ensureBossStaggerSchema()
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500)
  const safeOffset = Math.max(Number(offset) || 0, 0)
  const conditions = []
  const params = []

  if (String(keyword ?? '').trim()) {
    conditions.push('boss_name LIKE ?')
    params.push(`%${String(keyword).trim()}%`)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const [rows] = await pool.execute(
    `SELECT id, boss_name, defense, level, boss_image, weakness, resistance, crisis_base_hp, stagger_multiplier
     FROM boss_info
     ${where}
     ORDER BY boss_name
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params,
  )

  const [countRows] = await pool.execute(
    `SELECT COUNT(*) AS total FROM boss_info ${where}`,
    params,
  )

  return {
    items: rows.map((row) => mapBossInfoRow(row)),
    total: Number(countRows[0]?.total ?? 0),
    limit: safeLimit,
    offset: safeOffset,
  }
}

export async function updateBossInfoById(id, payload) {
  await ensureBossStaggerSchema()
  const bossId = Number(id)
  if (!Number.isInteger(bossId) || bossId <= 0) {
    throw new Error('无效的 boss_info ID')
  }

  const info = normalizeBossInfo({ ...payload, boss_name: payload.boss_name })
  if (!info.boss_name) {
    throw new Error('boss_name 不能为空')
  }

  const [existingRows] = await pool.execute(
    `SELECT id, boss_name, defense, level, boss_image, weakness, resistance, crisis_base_hp, stagger_multiplier
     FROM boss_info WHERE id = ? LIMIT 1`,
    [bossId],
  )
  const existing = mapBossInfoRow(existingRows[0])
  if (!existing) {
    throw new Error('boss_info 不存在')
  }

  if (info.boss_name !== existing.boss_name) {
    const duplicate = await findBossInfoByName(info.boss_name)
    if (duplicate && duplicate.id !== bossId) {
      throw new Error('怪物名称已被其他基础库记录占用')
    }
  }

  if (info.crisis_base_hp == null && existing.crisis_base_hp != null) {
    info.crisis_base_hp = Number(existing.crisis_base_hp)
  }

  await pool.execute(
    `UPDATE boss_info
     SET boss_name = ?, defense = ?, level = ?, boss_image = ?, weakness = ?, resistance = ?, crisis_base_hp = ?, stagger_multiplier = ?
     WHERE id = ?`,
    [
      info.boss_name,
      info.defense,
      info.level,
      info.boss_image,
      info.weakness,
      info.resistance,
      info.crisis_base_hp,
      info.stagger_multiplier,
      bossId,
    ],
  )

  return {
    action: 'updated',
    id: bossId,
    ...info,
  }
}

export async function upsertBossInfo(payload) {
  await ensureBossStaggerSchema()
  const info = normalizeBossInfo(payload)
  if (!info.boss_name) {
    throw new Error('boss_name 不能为空')
  }

  const existing = await findBossInfoByName(info.boss_name)

  if (!existing) {
    const [result] = await pool.execute(
      `INSERT INTO boss_info (boss_name, defense, level, boss_image, weakness, resistance, crisis_base_hp, stagger_multiplier)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        info.boss_name,
        info.defense,
        info.level,
        info.boss_image,
        info.weakness,
        info.resistance,
        info.crisis_base_hp,
        info.stagger_multiplier,
      ],
    )

    return {
      action: 'created',
      id: result.insertId,
      ...info,
    }
  }

  // Keep existing base HP if incoming didn't provide one
  if (info.crisis_base_hp == null && existing.crisis_base_hp != null) {
    info.crisis_base_hp = Number(existing.crisis_base_hp)
  }

  if (!bossInfoDiffers(existing, info)) {
    return {
      action: 'unchanged',
      id: existing.id,
      ...info,
    }
  }

  await pool.execute(
    `UPDATE boss_info
     SET defense = ?, level = ?, boss_image = ?, weakness = ?, resistance = ?, crisis_base_hp = ?, stagger_multiplier = ?
     WHERE id = ?`,
    [
      info.defense,
      info.level,
      info.boss_image,
      info.weakness,
      info.resistance,
      info.crisis_base_hp,
      info.stagger_multiplier,
      existing.id,
    ],
  )

  return {
    action: 'updated',
    id: existing.id,
    ...info,
  }
}
