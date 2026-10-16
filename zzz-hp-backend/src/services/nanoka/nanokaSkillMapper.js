/**
 * nanoka 招式（技能倍率）映射（**纯函数，不联网、不读库、不写库**）。
 *
 * 本文件把命令行参照实现 `scripts/import-nanoka-skills.mjs` 的口径**原样搬进仓库**，
 * 供管理端「③ 招式」一键录入复用（浏览器抓详情 → 后端算 plan → 按 plan 写库）。
 * 数值口径**不许另行发挥**：改动公式前先回去核对那份 CLI。
 *
 * 倍率换算（技能等级 L，默认 12）：
 *   baseMult = (damage_percentage + damage_percentage_growth * (L - 1)) / 100
 * 例：克拉蕾「锻星·一段」L12：
 *   (10770 + 980 * 11) / 100 = 215.5
 *
 * 策略 B（现行）：匹配则只更新倍率相关（multSource / damagePercentage / growth / L12 baseMult）；
 * 保留已有 skillTypes / element / buffAnchorId / note / settlementMult / baseMultFactor 等。
 * 缺失则新建（含 types / element / anchor）。只取「伤害倍率」段（跳过失衡）。同名段去重（保留首条）。
 *
 * 与 CLI 的差别（有意为之，见任务口径）：
 *   - 不搬 CLI 里那张硬编码 `AGENT_NANOKA_LOOKUP`（只钉了 claret）；`nanokaId` 由调用方传入；
 *   - 不创建招式小类（小类由人工按需建）；`resolveBuffAnchorId` 只在既有小类里找锚点。
 */

const NANOKA_CATEGORY_TO_SKILL_TYPES = {
  basic: ['basic'],
  dodge: ['dodge'],
  special: ['special'],
  chain: ['chain'],
  assist: ['assist'],
}

/** 名字归一化：NFKC、去空白、全角括号/冒号统一（匹配既有招式用） */
export function normalizeSkillName(name) {
  return String(name ?? '')
    .normalize('NFKC')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[：:]/g, '：')
    .trim()
}

/** 去掉「普通攻击：」这类技能标题前缀（锚点候选用） */
export function stripSkillTitlePrefix(skillName) {
  return String(skillName ?? '').replace(
    /^(普通攻击|闪避|冲刺攻击|支援技|特殊技|强化特殊技|连携技|终结技)[:：]/,
    '',
  )
}

/** 「一段伤害倍率」→「一段」；纯「伤害倍率」→ '' */
export function shortParamLabel(paramName) {
  const raw = String(paramName ?? '').trim()
  if (raw === '伤害倍率') return ''
  return raw.replace(/伤害倍率$/, '').trim()
}

export function buildDisplayName(skillName, paramName) {
  const short = shortParamLabel(paramName)
  if (!short) return skillName
  return `${skillName}·${short}`
}

/** 稳定 id，便于反复导入：sk-{agent}-nk-{nanokaSkillId}-{slug} */
export function stableSkillId(agentId, nanokaSkillId, paramName) {
  const slug = shortParamLabel(paramName) || 'main'
  const safeSlug = slug
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  const id = `sk-${agentId}-nk-${nanokaSkillId}-${safeSlug || 'main'}`
  return id.slice(0, 64)
}

/**
 * 大类 + 小类一并写入（管理端勾选要看得见）。
 * nanoka 把终结技挂在 chain 下，按名称纠正为 ultimate。
 */
export function mapSkillTypes(category, skillName) {
  const name = String(skillName ?? '')
  if (/终结技/.test(name)) return ['ultimate']
  if (/连携技/.test(name)) return ['chain']
  if (/强化特殊技/.test(name) || (category === 'special' && /强化/.test(name))) {
    return ['special', 'specialEnhanced']
  }
  if (category === 'special' || /^特殊技/.test(name)) {
    return ['special', 'specialBasic']
  }
  if (/闪避反击/.test(name) || (category === 'dodge' && /反击/.test(name))) {
    return ['dodge', 'dodgeCounter']
  }
  if (/冲刺攻击/.test(name)) return ['dodge', 'dash']
  if (category === 'basic' || /普通攻击/.test(name)) return ['basic']
  if (category === 'assist') return ['assist']
  if (category === 'dodge') return ['dodge']
  if (category === 'chain') return ['chain']
  return [...(NANOKA_CATEGORY_TO_SKILL_TYPES[category] ?? ['basic'])]
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
 * 从角色详情拆出伤害倍率候选段（同 displayName 去重，保留首条）。
 *
 * @param {Record<string, any>} detail `zh/character/<id>.json` 原文
 * @param {{ level?: number }} [options] 技能等级，默认 12
 */
export function extractDamageSegments(detail, { level = 12 } = {}) {
  const skillRoot = detail?.skill ?? {}
  const segments = []
  const seenNorm = new Set()
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
        const damagePercentage = Number(stats.damage_percentage ?? stats.main) || 0
        const damagePercentageGrowth = Number(stats.damage_percentage_growth ?? stats.growth) || 0
        const baseMult = computeBaseMultPercent(damagePercentage, damagePercentageGrowth, level)
        const displayName = buildDisplayName(skillName, paramName)
        const norm = normalizeSkillName(displayName)
        if (seenNorm.has(norm)) continue
        seenNorm.add(norm)
        segments.push({
          category,
          skillName,
          paramName,
          nanokaSkillId: String(nanokaSkillId),
          displayName,
          baseMult,
          damagePercentage,
          damagePercentageGrowth,
          skillTypes: mapSkillTypes(category, skillName),
          titleCore: stripSkillTitlePrefix(skillName),
        })
      }
    }
  }
  return segments
}

/** 去掉本库备注括号，便于对 nanoka 中文名（本地角色匹配用） */
export function stripAgentNameNoise(name) {
  return String(name ?? '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .trim()
}

/**
 * 段 → 既有招式小类 id（锚点）。
 * 优先短参名（如「毁伤伤害倍率」→「毁伤」），再回落到技能标题核心；找不到返回 null。
 * **只匹配既有小类**，不新建小类。
 */
export function resolveBuffAnchorId(subcategories, agentId, segment) {
  const forAgent = (Array.isArray(subcategories) ? subcategories : []).filter(
    (s) => String(s.agentId ?? '') === String(agentId ?? ''),
  )
  const candidates = [
    shortParamLabel(segment?.paramName),
    segment?.titleCore,
    stripSkillTitlePrefix(segment?.displayName),
    segment?.skillName,
    segment?.displayName,
  ]
    .map(normalizeSkillName)
    .filter(Boolean)
  for (const sub of forAgent) {
    const n = normalizeSkillName(sub.name)
    if (candidates.includes(n)) return sub.id
  }
  return null
}

export function sameSkillTypes(a, b) {
  const left = [...(a ?? [])].map(String).sort()
  const right = [...(b ?? [])].map(String).sort()
  if (left.length !== right.length) return false
  return left.every((v, i) => v === right[i])
}

export function sameOptionalNumber(a, b, eps = 1e-6) {
  const left = a == null || a === '' ? null : Number(a)
  const right = b == null || b === '' ? null : Number(b)
  if (left == null && right == null) return true
  if (left == null || right == null) return false
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false
  return Math.abs(left - right) < eps
}

/**
 * 生成一个角色的招式录入计划（**不写库**）。
 *
 * @param {object} params
 * @param {{ id: string, name?: string, element?: string }} params.agent 本地角色
 * @param {Record<string, any>} params.detail nanoka 角色详情原文
 * @param {Array<Record<string, any>>} [params.existingSkills] 本库全部招式（`listSkills()`）
 * @param {Array<Record<string, any>>} [params.subcategories] 本库招式小类（人工按需建的）
 * @param {number} [params.level] 技能等级，默认 12
 * @returns {{ create: object[], overwrite: object[], skipSame: object[], unmatchedLocal: object[] }}
 *   - `create`：可直接交给 `upsertSkill` 的完整招式文档
 *   - `overwrite`：只改倍率字段；`doc` 是「保留其余字段」的写库载荷（策略 B：`{...existing, ...multFields}`），
 *     条目本身**不带** `element` / `skillTypes` / `buffAnchorId`，避免手工修正的元素被 nanoka 值冲掉
 *   - `skipSame`：倍率与来源都一致，无需动作
 *   - `unmatchedLocal`：本库有、nanoka 没有的招式（只提示，不删）
 */
export function planAgentSkillImport({
  agent,
  detail,
  existingSkills = [],
  subcategories = [],
  level = 12,
} = {}) {
  const agentId = String(agent?.id ?? '').trim()
  if (!agentId) throw new Error('缺少角色 id，无法生成招式录入计划')
  const agentElement = String(agent?.element ?? '').trim()
  const segments = extractDamageSegments(detail, { level })

  const agentSkills = (Array.isArray(existingSkills) ? existingSkills : []).filter(
    (s) => String(s.agentId ?? '') === agentId,
  )
  const byNormName = new Map()
  for (const skill of agentSkills) {
    byNormName.set(normalizeSkillName(skill.name), skill)
  }

  const create = []
  const overwrite = []
  const skipSame = []

  for (const seg of segments) {
    const norm = normalizeSkillName(seg.displayName)
    const existing = byNormName.get(norm)
    const resolvedAnchor = resolveBuffAnchorId(subcategories, agentId, seg)
    const buffAnchorId = resolvedAnchor ?? existing?.buffAnchorId ?? null
    const id = existing?.id ?? stableSkillId(agentId, seg.nanokaSkillId, seg.paramName)
    const skillTypes = seg.skillTypes
    const multFields = {
      multSource: 'nanoka',
      damagePercentage: seg.damagePercentage,
      damagePercentageGrowth: seg.damagePercentageGrowth,
      baseMult: seg.baseMult,
    }

    if (existing) {
      const sameMult = sameOptionalNumber(existing.baseMult, seg.baseMult)
      const samePercentage = sameOptionalNumber(existing.damagePercentage, seg.damagePercentage)
      const sameGrowth = sameOptionalNumber(
        existing.damagePercentageGrowth,
        seg.damagePercentageGrowth,
      )
      const sameSource = String(existing.multSource ?? '') === 'nanoka'
      if (sameMult && samePercentage && sameGrowth && sameSource) {
        skipSame.push({ id, name: existing.name, baseMult: existing.baseMult })
      } else {
        overwrite.push({
          id,
          name: existing.name,
          from: existing.baseMult,
          to: seg.baseMult,
          changed: {
            baseMult: !sameMult,
            damagePercentage: !samePercentage,
            damagePercentageGrowth: !sameGrowth,
            multSource: !sameSource,
          },
          // 策略 B：重导入只更新倍率相关，保留 element / skillTypes / buffAnchorId / note / settlementMult 等
          doc: { ...existing, ...multFields },
        })
      }
    } else {
      create.push({
        id,
        agentId,
        name: seg.displayName,
        damageType: 'direct',
        skillTypes,
        buffAnchorId,
        baseMult: seg.baseMult,
        baseMultFactor: 100,
        settlementMult: 0,
        multSource: 'nanoka',
        element: agentElement,
        ownerGroupId: null,
        note: '',
        damagePercentage: seg.damagePercentage,
        damagePercentageGrowth: seg.damagePercentageGrowth,
      })
    }
  }

  const matchedNorms = new Set(segments.map((s) => normalizeSkillName(s.displayName)))
  const unmatchedLocal = []
  for (const skill of agentSkills) {
    if (matchedNorms.has(normalizeSkillName(skill.name))) continue
    unmatchedLocal.push({ id: skill.id, name: skill.name, baseMult: skill.baseMult })
  }

  return { create, overwrite, skipSame, unmatchedLocal }
}
