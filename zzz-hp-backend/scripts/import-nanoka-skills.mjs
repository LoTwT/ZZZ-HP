/**
 * 从 nanoka 角色页静态 JSON 导入招式伤害倍率到 calculator_skills（策略 B）。
 *
 * 倍率换算（技能等级 L，默认 12）：
 *   baseMult = (damage_percentage + damage_percentage_growth * (L - 1)) / 100
 * 例：克拉蕾「锻星·一段」L12：
 *   (10770 + 980 * 11) / 100 = 215.5
 *
 * 只导入 param 名含「伤害倍率」的段；跳过「失衡倍率」。
 *
 * Usage:
 *   node scripts/import-nanoka-skills.mjs --agent claret
 *   node scripts/import-nanoka-skills.mjs --agent claret --write
 *   node scripts/import-nanoka-skills.mjs --agent claret --level 12 --write
 *
 * 默认 dry-run；显式 --write 才写入 MySQL。
 * 回滚：用 scripts/data/backups/ 下备份跑 import-calculator-buffs.mjs。
 */
import dotenv from 'dotenv'
import pool from '../src/config/db.js'
import {
  fetchCharacterDetail,
  fetchCharacterIndex,
  findCharacterIndexEntry,
  resolveNanokaCharacterBuildTag,
} from '../src/services/nanoka/nanokaCharacterClient.js'
import { listSkills, upsertSkill } from '../src/services/skillLibraryService.js'
import { listSkillSubcategories } from '../src/services/skillSubcategoryService.js'

dotenv.config()

/** 本库 agentId → nanoka 查找键（试点克拉蕾；后续可扩） */
const AGENT_NANOKA_LOOKUP = {
  claret: { code: 'Claret', zh: '克拉蕾', nanokaId: '1611' },
}

const NANOKA_CATEGORY_TO_SKILL_TYPES = {
  basic: ['basic'],
  dodge: ['dodge'],
  special: ['special'],
  chain: ['chain'],
  assist: ['assist'],
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

function normalizeSkillName(name) {
  return String(name ?? '')
    .normalize('NFKC')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[：:]/g, '：')
    .trim()
}

function stripSkillTitlePrefix(skillName) {
  return String(skillName ?? '').replace(
    /^(普通攻击|闪避|冲刺攻击|支援技|特殊技|强化特殊技|连携技|终结技)[:：]/,
    '',
  )
}

/**
 * 「一段伤害倍率」→「一段」；纯「伤害倍率」→ ''。
 */
function shortParamLabel(paramName) {
  const raw = String(paramName ?? '').trim()
  if (raw === '伤害倍率') return ''
  return raw.replace(/伤害倍率$/, '').trim()
}

function buildDisplayName(skillName, paramName) {
  const short = shortParamLabel(paramName)
  if (!short) return skillName
  return `${skillName}·${short}`
}

/**
 * 稳定 id，便于反复导入：sk-{agent}-nk-{nanokaSkillId}-{slug}
 */
function stableSkillId(agentId, nanokaSkillId, paramName) {
  const slug = shortParamLabel(paramName) || 'main'
  const safeSlug = slug
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  const id = `sk-${agentId}-nk-${nanokaSkillId}-${safeSlug || 'main'}`
  return id.slice(0, 64)
}

function mapSkillTypes(category, skillName) {
  const base = NANOKA_CATEGORY_TO_SKILL_TYPES[category] ?? ['basic']
  if (category === 'dodge' && /反击/.test(skillName)) return ['dodgeCounter']
  if (category === 'special' && /强化/.test(skillName)) return ['specialEnhanced']
  if (category === 'special' && /普通特殊|非强化/.test(skillName)) return ['specialBasic']
  return [...base]
}

/**
 * 技能等级 L 时的伤害倍率%（本库 baseMult）。
 * nanoka 存万分比整数：3120 → 31.20% at L1；每级 +growth。
 */
export function computeBaseMultPercent(damagePercentage, growth, level = 12) {
  const base = Number(damagePercentage) || 0
  const g = Number(growth) || 0
  const lv = Math.max(1, Number(level) || 12)
  const raw = (base + g * (lv - 1)) / 100
  return Math.round(raw * 1000) / 1000
}

/**
 * 从角色详情拆出伤害倍率候选段。
 */
export function extractDamageSegments(detail, { level = 12 } = {}) {
  const skillRoot = detail?.skill ?? {}
  const segments = []
  for (const [category, block] of Object.entries(skillRoot)) {
    const descriptions = Array.isArray(block?.description) ? block.description : []
    for (const entry of descriptions) {
      const skillName = String(entry?.name ?? '').trim()
      if (!skillName) continue
      const params = Array.isArray(entry?.param) ? entry.param : []
      for (const p of params) {
        const paramName = String(p?.name ?? '').trim()
        if (!paramName.includes('伤害倍率')) continue
        if (paramName.includes('失衡')) continue

        const paramMap = p?.param && typeof p.param === 'object' ? p.param : {}
        const nanokaSkillId = Object.keys(paramMap)[0]
        if (!nanokaSkillId) continue
        const stats = paramMap[nanokaSkillId] ?? {}
        const baseMult = computeBaseMultPercent(
          stats.damage_percentage ?? stats.main,
          stats.damage_percentage_growth ?? stats.growth,
          level,
        )
        const displayName = buildDisplayName(skillName, paramName)
        segments.push({
          category,
          skillName,
          paramName,
          nanokaSkillId: String(nanokaSkillId),
          displayName,
          baseMult,
          skillTypes: mapSkillTypes(category, skillName),
          titleCore: stripSkillTitlePrefix(skillName),
        })
      }
    }
  }
  return segments
}

function resolveBuffAnchorId(subcategories, agentId, segment) {
  const forAgent = subcategories.filter((s) => String(s.agentId ?? '') === agentId)
  const candidates = [segment.titleCore, segment.skillName, segment.displayName]
    .map(normalizeSkillName)
    .filter(Boolean)
  for (const sub of forAgent) {
    const n = normalizeSkillName(sub.name)
    if (candidates.includes(n)) return sub.id
  }
  return null
}

async function resolveNanokaId(agentId, buildTag) {
  const lookup = AGENT_NANOKA_LOOKUP[agentId]
  if (lookup?.nanokaId) return { nanokaId: lookup.nanokaId, via: 'hardcoded' }
  const index = await fetchCharacterIndex(buildTag)
  const hit = findCharacterIndexEntry(index, lookup ?? { code: agentId })
  if (!hit) throw new Error(`nanoka 索引中找不到角色：${agentId}`)
  return { nanokaId: hit.id, via: 'index', meta: hit }
}

async function main() {
  const agentId = (readArg('--agent') || 'claret').trim()
  const level = Number(readArg('--level') || 12)
  const doWrite = hasFlag('--write')
  const dryRun = !doWrite

  if (!AGENT_NANOKA_LOOKUP[agentId] && !hasFlag('--allow-unknown-agent')) {
    console.error(
      `未知 agent「${agentId}」。试点仅注册：${Object.keys(AGENT_NANOKA_LOOKUP).join(', ')}。` +
        `若确认可加 --allow-unknown-agent。`,
    )
    process.exit(1)
  }

  console.log(`agent=${agentId} level=${level} mode=${dryRun ? 'dry-run' : 'WRITE'}`)

  const buildTag = await resolveNanokaCharacterBuildTag()
  console.log(`nanoka build=${buildTag}`)

  const { nanokaId, via } = await resolveNanokaId(agentId, buildTag)
  console.log(`nanokaId=${nanokaId} (via ${via})`)

  const detail = await fetchCharacterDetail(buildTag, nanokaId, 'zh')
  console.log(`detail name=${detail?.name} code=${detail?.code_name}`)

  const segments = extractDamageSegments(detail, { level })
  console.log(`伤害倍率段 ${segments.length} 条`)

  const [existingSkills, subcategories] = await Promise.all([
    listSkills(),
    listSkillSubcategories(),
  ])
  const agentSkills = existingSkills.filter((s) => String(s.agentId ?? '') === agentId)
  const byNormName = new Map()
  for (const skill of agentSkills) {
    byNormName.set(normalizeSkillName(skill.name), skill)
  }

  const report = {
    create: [],
    overwrite: [],
    skipSame: [],
    unmatchedLocal: [],
  }

  const planned = []
  for (const seg of segments) {
    const norm = normalizeSkillName(seg.displayName)
    const existing = byNormName.get(norm)
    const buffAnchorId = existing?.buffAnchorId ?? resolveBuffAnchorId(subcategories, agentId, seg)
    const id = existing?.id ?? stableSkillId(agentId, seg.nanokaSkillId, seg.paramName)

    if (existing) {
      const same =
        Math.abs(Number(existing.baseMult) - seg.baseMult) < 1e-6
      if (same) {
        report.skipSame.push({ id, name: existing.name, baseMult: existing.baseMult })
      } else {
        report.overwrite.push({
          id,
          name: existing.name,
          from: existing.baseMult,
          to: seg.baseMult,
        })
        planned.push({
          action: 'overwrite',
          doc: {
            ...existing,
            baseMult: seg.baseMult,
            // 策略 B：覆盖只改 baseMult；其余字段保持 existing
          },
        })
      }
    } else {
      report.create.push({
        id,
        name: seg.displayName,
        baseMult: seg.baseMult,
        skillTypes: seg.skillTypes,
        buffAnchorId,
      })
      planned.push({
        action: 'create',
        doc: {
          id,
          agentId,
          name: seg.displayName,
          damageType: 'direct',
          skillTypes: seg.skillTypes,
          buffAnchorId,
          baseMult: seg.baseMult,
          baseMultFactor: 100,
          settlementMult: 0,
          element: '',
        },
      })
    }
  }

  const matchedNorms = new Set(segments.map((s) => normalizeSkillName(s.displayName)))
  for (const skill of agentSkills) {
    if (!matchedNorms.has(normalizeSkillName(skill.name))) {
      report.unmatchedLocal.push({
        id: skill.id,
        name: skill.name,
        baseMult: skill.baseMult,
      })
    }
  }

  const printRows = (title, rows, fmt) => {
    console.log(`\n=== ${title} (${rows.length}) ===`)
    for (const row of rows.slice(0, 40)) console.log(fmt(row))
    if (rows.length > 40) console.log(`  … 另有 ${rows.length - 40} 条`)
  }

  printRows('新建', report.create, (r) => `  + ${r.name}  baseMult=${r.baseMult}  id=${r.id}`)
  printRows(
    '覆盖',
    report.overwrite,
    (r) => `  ~ ${r.name}  ${r.from} → ${r.to}  id=${r.id}`,
  )
  printRows('跳过(同值)', report.skipSame, (r) => `  = ${r.name}  ${r.baseMult}`)
  printRows(
    '本库未匹配残留(不删)',
    report.unmatchedLocal,
    (r) => `  ! ${r.name}  baseMult=${r.baseMult}  id=${r.id}`,
  )

  // 手算核对锚点
  const forge = segments.find(
    (s) => s.skillName.includes('锻星') && s.paramName === '一段伤害倍率',
  )
  if (forge) {
    console.log(
      `\n核对：锻星一段 L${level} baseMult=${forge.baseMult}（期望 L12=215.5）`,
    )
  }

  if (dryRun) {
    console.log('\n[dry-run] 未写入。加 --write 才落库。')
    return
  }

  let written = 0
  for (const item of planned) {
    await upsertSkill(item.doc)
    written += 1
  }
  console.log(`\n已写入 ${written} 条（新建 ${report.create.length} · 覆盖 ${report.overwrite.length}）`)
}

const isDirectRun = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('import-nanoka-skills.mjs')

if (isDirectRun) {
  try {
    await main()
  } catch (err) {
    console.error(err)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}
