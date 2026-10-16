/**
 * nanoka「增益」抽取（**纯函数：不联网、不读库、不写库**）。
 *
 * 规格：`dev-docs/nanoka-buff-extract-spec-2026-10-16.md`（用户口径）。
 * 目标：把浏览器抓来的 nanoka 详情 JSON 切句、抽数值/层数/条件，产出
 *   ① 「原文项」（按槽位分组，供界面显示原文 + 数值高亮）
 *   ② 「翻译条草稿」（对齐仓库既有 effect schema，供用户逐条勾选后再入库存）
 * 因为「语义只能靠推测」，这里**只产草稿**，绝不写库（写库见 nanokaBuffService.js）。
 *
 * 四类来源（规格 §一，都扫）：
 *   1. 招式文本   character.skill.{basic,dodge,special,chain,assist}.description[].desc
 *   2. 核心被动 + 额外能力 character.passive.level[*].desc[0] / desc[1]（取**满级**那条）
 *   3. 影画 1–6   character.talent[0..5].desc
 *   4. 音擎精炼 1–5 weapon.talents[1..5].desc（`talents[0]` 若存在则是基础说明）
 *
 * 落点（规格 §三）：角色 `mindscapeBuffs[i]`（i=0 核心被动+额外能力，i=1..6 影画）+ `mindscapeNotes[i]` 存原文；
 * 音擎 `refinementBuffs[j]`（j=0..4）+ `fixedBuffs`。招式文本在仓库里**没有落点**，因此只产
 * `containerIndex: null` 的「仅参考」条目（`apply` 会跳过并说明原因），与规格 §三 表格严格一致。
 *
 * 边界（规格 §七，v1 明确不做）：
 *   - 不判定 `convert`（转模：如「异常掌控 → 暴击率」的每点换算）与 `skillTargets`（按招式锚点）；
 *   - 不做条件枚举的完整建模、不做时长/冷却建模（「持续 N 秒」只进 note）；
 *   - 机制句（无敌 / 抗打断 / 状态与次数 / 段数衔接 / 资源回满）**不产**翻译条，只在界面显示原文。
 *   - `elementFilter` 一律留 `all`（元素条件写进 note，规格 §四）。
 */

import { BUFF_STAT_KEYS } from '../../utils/calculatorBuffFields.js'

/** 草稿里允许的 stat 取值（与仓库 `BUFF_STAT_KEYS` 同源，避免自创键） */
const STAT_KEY_SET = new Set(BUFF_STAT_KEYS)

/** 界面上给 stat 下拉用的中文标签（与前端 `BUFF_STAT_FIELDS` 口径一致，仅用于展示） */
export const STAT_LABELS = {
  hp: '生命值',
  inCombatHpPercent: '局内生命值',
  inCombatAtkPercent: '局内攻击力',
  inCombatDefPercent: '局内防御力',
  externalHpPercent: '局外生命值',
  externalAtkPercent: '局外攻击力',
  externalDefPercent: '局外防御力',
  atk: '攻击力（固定）',
  def: '防御力（固定）',
  dmgBonus: '增伤',
  skillDmgBonus: '招式增伤',
  skillMultiplierBonus: '招式倍率加成',
  critRate: '暴击率',
  critDmg: '暴击伤害',
  penRate: '穿透率',
  reduceDefense: '无视防御',
  resPen: '抗性穿透',
  mastery: '异常精通',
  anomalyControl: '异常掌控',
  anomalyControlPercent: '异常掌控%（局外）',
  energyRegen: '能量自动回复',
  energyRegenFlat: '能量回复（固定）',
  vulnerable: '失衡易伤',
  dmgReduction: '受到伤害降低',
  anomalyCritRate: '异常暴击率',
  anomalyCritDmg: '异常暴击伤害',
  anomalyDmgBonus: '异常增伤',
  anomalyReleaseDmgBonus: '异放增伤',
  disorderDmgBonus: '紊乱增伤',
  turbulenceDmgBonus: '乱流增伤',
  directVulnerable: '直伤易伤',
  anomalyVulnerable: '异常易伤',
  pierce: '穿透值',
  pierceDmgBonus: '穿透增伤',
  special: '特殊',
}

/** 元素关键词（只用于往 note 里补元素线索；`elementFilter` 仍留 `all`） */
const ELEMENTS = ['物理', '火', '冰', '电', '以太', '风', '流明']

/**
 * stat 词典（规格 §五.3）。**顺序即优先级**：越具体的规则越靠前。
 * `percent` / `flat` 两列按「取到的数值有没有 `%`」二选一（固定值用「点」）。
 */
const STAT_RULES = [
  // —— 收到伤害降低 / 无视防御 / 抗性穿透：必须排在「防御力」「属性伤害」之前
  { re: /受到(的)?伤害(降低|减少|下降)|伤害减免|减伤/, percent: 'dmgReduction', flat: 'dmgReduction' },
  { re: /无视(目标|敌人|其)?(的)?[^，。；]{0,6}?防御/, percent: 'reduceDefense', flat: 'reduceDefense' },
  { re: /无视(目标|敌人|其)?(的)?[^，。；]{0,8}?抗性|抗性(穿透|降低|减少)|(伤害)?抗性提升/, percent: 'resPen', flat: 'resPen' },
  // —— 招式/技能伤害：必须排在「造成的伤害」之前
  {
    re: /招式(造成的)?伤害|招式伤害|技能(造成的)?伤害|技能伤害/,
    percent: 'skillDmgBonus',
    flat: 'skillDmgBonus',
  },
  // —— 异常类（异常暴击必须排在「暴击率/暴击伤害」之前）
  {
    re: /异常(伤害|状态)[^，。；]{0,4}?的?暴击(伤害|率)|属性异常伤害的暴击(伤害|率)/,
    percent: 'anomalyCritDmg',
    flat: 'anomalyCritDmg',
  },
  { re: /异常精通/, percent: 'mastery', flat: 'mastery' },
  { re: /异常掌控/, percent: 'anomalyControlPercent', flat: 'anomalyControl' },
  {
    re: /(属性)?异常伤害(提升|增加|提高)|异常伤害(提升|增加|提高)/,
    percent: 'anomalyDmgBonus',
    flat: 'anomalyDmgBonus',
  },
  // —— 暴击
  { re: /暴击率/, percent: 'critRate', flat: 'critRate' },
  { re: /暴击伤害/, percent: 'critDmg', flat: 'critDmg' },
  // —— 能量
  { re: /能量(自动)?(回复|恢复|回能)/, percent: 'energyRegen', flat: 'energyRegenFlat' },
  // —— 攻 / 生 / 防
  { re: /攻击力|基础攻击力/, percent: 'externalAtkPercent', flat: 'atk' },
  { re: /生命值|生命上限|最大生命/, percent: 'externalHpPercent', flat: 'hp' },
  { re: /防御力/, percent: 'externalDefPercent', flat: 'def' },
  // —— 穿透 / 易伤
  { re: /穿透率/, percent: 'penRate', flat: 'penRate' },
  { re: /失衡易伤|失衡值(提升|增加)|失衡(时间|持续)/, percent: 'vulnerable', flat: 'vulnerable' },
  // —— 通用增伤：放最后（「造成的伤害」等最泛）
  { re: /造成的伤害|伤害(提升|增加|提高|加成)|增伤/, percent: 'dmgBonus', flat: 'dmgBonus' },
]

/** 结构句：只描述层数/时长/刷新，本身不产草稿（由 unit 级后处理消费） */
const STRUCTURAL_PATTERNS = [
  /^(最多)?(叠加)?\d+层(效果)?$/,
  /^最多(叠加)?\d+层/,
  /^\d+层(效果)?/,
  /每层(效果)?(单独)?(结算)?(持续)?/,
  /持续\d+(\.\d+)?秒/,
  /(重复触发)?刷新(该效果的)?持续时间/,
  /^上限\d+层/,
  /^\d+秒内最多触发/,
]

/**
 * 机制句（规格 §五.7）：无敌 / 抗打断 / 状态与次数 / 段数衔接 / 资源（能量·燔焰·充能）增耗。
 * 命中即「只显示原文、不产翻译条」。
 */
const MECHANISM_PATTERNS = [
  /无敌/,
  /抗打断|霸体|韧性/,
  /不会战败|免于退场|致命伤害时不会/,
  /获得\d+(\.\d+)?点/,
  /获得\d+(\.\d+)?次/,
  /触发\d+(\.\d+)?次/,
  /上限为?\d+(\.\d+)?(次|层|点)/,
  /获得\d+层|上限\d+层|\d+层充能/,
  /消耗\d+(\.\d+)?(点|层)/,
  /回复至\d+(\.\d+)?点|回复\d+(\.\d+)?点/,
  /最多拥有\d+(\.\d+)?点/,
  /最多触发(一次|\d+次)/,
  /第[一二三四五六七八九十\d]+段/,
  /衔接|后撤动作|跳过|换入|换出/,
  /勘域模式/,
  /视为\[?[^\]]*\]?伤害$/,
  /命中次数|段数/,
  /获取效率/, // 「[燔焰]的获取效率提升 15%」这类资源效率
]

/** 其它「不产草稿」的句子：倍率归招式线、周期伤害、回血、阈值型最大值… */
const SKIP_PATTERNS = [
  /倍率/, // 招式倍率 / 倍率修正由招式线负责（规格 §七）
  /每\s*\d+(\.\d+)?\s*秒(受到|造成)/, // 周期伤害（如「每8秒受到…50%攻击力的火属性伤害」）
  /回复[^，。；]{0,12}生命值|生命值(回复|恢复)/, // 回血（含「回复自身 10% 生命值上限」这类）
  /消耗[^，。；]{0,8}生命值/,
  /(达到|为)最大值|(达到|为)最小值/,
  /技能等级/, // 「技能等级+2」属技能等级线，不由增益条表达
  /持续时间(提升|增加|延长|缩短)/, // 时长建模 v1 不做（规格 §七）
  /冷却/, // 冷却不做建模
]

/** 条件句尾巴：`…时` / `…后` / `…期间` / `…触发：`（无数字时并入下一条） */
const CONDITION_TAIL_RE =
  /(时|后|期间|情况下|状态下|触发|前|时触发)[：:]?$|^(若|如果)[^，。；]*$/

/** 阈值句（`…大于 155 点` / `达到 255 点`）：**永远**当条件，不产草稿 */
const THRESHOLD_RE = /(大于|小于|超过|不足|达到|至少|高于|低于)\s*\d/

/** 队伍 / 自身 指代（`applyTarget` 判定，规格 §四） */
const TEAM_RE = /全队|队伍中任意|队伍中所有|队伍全体|我方全体|我方所有|队友/
const SELF_RE = /自身|自己|装备者|本角色/

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 去富文本标签 + 去运行时模板（`{CAL:...}`），行首行尾留纯文本；`rawText`/`note` 都用它 */
export function cleanNanokaText(raw) {
  return String(raw ?? '')
    .replace(/\{[^{}]*\}/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\r/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/** 抽一个片段里的全部数值：`{ value, unit, percent }`（`12%` → 12） */
export function extractNumbers(text) {
  const out = []
  const re = /\d+(?:\.\d+)?%?/g
  let match
  while ((match = re.exec(String(text ?? ''))) !== null) {
    const raw = match[0]
    const percent = raw.endsWith('%')
    const value = Number(percent ? raw.slice(0, -1) : raw)
    if (!Number.isFinite(value)) continue
    out.push({ value, unit: percent ? '%' : '点', percent })
  }
  return out
}

/** 主数值：优先取最后一个「带 %」的数，否则取最后一个数（中文里「…提升 70%」数值在后） */
function pickPrimaryNumber(numbers) {
  const percents = numbers.filter((item) => item.percent)
  if (percents.length) return percents[percents.length - 1]
  return numbers.length ? numbers[numbers.length - 1] : null
}

function matchStatRule(text) {
  for (const rule of STAT_RULES) {
    if (rule.re.test(text)) return rule
  }
  return null
}

function detectElement(text) {
  return ELEMENTS.find((element) => text.includes(`${element}属性`)) ?? ''
}

function decideApplyTarget(valueText, pendingText, selfNames) {
  if (SELF_RE.test(valueText)) return 'self'
  for (const name of selfNames) {
    if (name && valueText.includes(name)) return 'self'
  }
  if (TEAM_RE.test(valueText) || TEAM_RE.test(pendingText)) return 'team'
  return 'self'
}

function decideApplySituation(text) {
  if (/非失衡/.test(text)) return 'non_stagger'
  if (/失衡/.test(text)) return 'stagger'
  return 'global'
}

function joinNote(parts) {
  let out = ''
  for (const part of parts) {
    if (!part) continue
    if (!out) {
      out = part
      continue
    }
    // 前一段以「：」结尾（触发条件抬头）时不加逗号，读起来更接近原文
    out = /[：:]$/.test(out) ? `${out}${part}` : `${out}，${part}`
  }
  return out.trim()
}

/**
 * 判定用的文本：去掉角色/音擎自身名与 `N号` 这类名字里的数字
 * （「11号」的 11 不是增益数值，否则条件句会被误判成数值句）。
 */
function numberSafeText(text, selfNames = []) {
  let out = String(text ?? '')
  for (const name of selfNames) {
    if (!name) continue
    out = out.split(name).join('')
  }
  return out.replace(/[「」]?\d+号[「」]?/g, '')
}

function isStructural(text) {
  if (/最多(叠加)?\d+层|每层/.test(text)) return true
  return STRUCTURAL_PATTERNS.some((re) => re.test(text))
}

function isMechanism(text) {
  return MECHANISM_PATTERNS.some((re) => re.test(text))
}

function isSkipped(text) {
  return SKIP_PATTERNS.some((re) => re.test(text))
}

/** 条件句判定：阈值句恒为条件；`…时/后/期间` 且（去掉自身名后）无数字时也是条件 */
function isConditionOnly(text, selfNames = []) {
  if (THRESHOLD_RE.test(text)) return true
  if (!CONDITION_TAIL_RE.test(text)) return false
  return extractNumbers(numberSafeText(text, selfNames)).length === 0
}

/** 一条草稿的公共字段（对齐仓库 effect schema，规格 §四） */
function createDraft(base) {
  const stat = STAT_KEY_SET.has(base.stat) ? base.stat : 'dmgBonus'
  const kind = base.kind === 'stacked' ? 'stacked' : 'fixed'
  return {
    id: base.id,
    origin: base.origin,
    scope: 'general',
    applyTarget: base.applyTarget,
    applySituation: base.applySituation,
    elementFilter: 'all',
    kind,
    stat,
    statLabel: STAT_LABELS[stat] ?? stat,
    value: Number(base.value ?? 0),
    stackable: false,
    maxStacks: Math.max(1, Number(base.maxStacks ?? 1) || 1),
    valuePerStack: kind === 'stacked' ? Number(base.value ?? 0) : 0,
    defaultStacks: 1,
    enabledDefault: base.confidence !== 'low',
    note: base.note,
    confidence: base.confidence,
    confidenceReason: base.confidenceReason ?? '',
    sourceText: base.sourceText,
  }
}

/**
 * 切句：先按 `。；\n` 切「句（unit）」，再按 `，,` 切「子句」。
 * 返回 `[{ text, clauses }]`。
 */
export function splitUnits(text) {
  const cleaned = cleanNanokaText(text)
  if (!cleaned) return []
  return cleaned
    .split(/[。；\n]/)
    .map((unit) => unit.trim())
    .filter(Boolean)
    .map((unit) => ({
      text: unit,
      clauses: unit
        .split(/[，,]/)
        .map((clause) => clause.trim())
        .filter(Boolean),
    }))
}

/** unit 里的叠层信息：「每层 X%」/「最多(叠加) N 层」 */
export function readStackInfo(unitText) {
  const perStack = /每层(?:效果)?\s*(?:提升|增加|提高|获得|提供|为)?\s*(\d+(?:\.\d+)?)\s*%/.exec(
    unitText,
  )
  const maxStacks = /最多(?:叠加)?\s*(\d+)\s*层/.exec(unitText)
  return {
    perStack: perStack ? Number(perStack[1]) : null,
    maxStacks: maxStacks ? Number(maxStacks[1]) : null,
  }
}

/**
 * 从一段原文里抽出草稿列表（规格 §五 的 v1 翻译规则。
 * `origin` 形如 `nanoka:1041:talent:2`，`selfNames` 用于判定「自身」指代。
 */
export function extractDraftsFromText({ text, origin, selfNames = [] } = {}) {
  const drafts = []
  const units = splitUnits(text)
  /** 段落级前缀（以「：」结尾的触发条件，作用于整段） */
  let prefix = ''
  /** 子句级条件（作用于紧随其后的那一条数值句，用掉即清） */
  let pending = ''
  let lastDraft = null

  for (const unit of units) {
    const unitDrafts = []
    pending = ''
    for (const clause of unit.clauses) {
      if (isStructural(clause)) continue
      if (isMechanism(clause)) continue
      if (isSkipped(clause)) continue
      if (/[：:]$/.test(clause) && !extractNumbers(numberSafeText(clause, selfNames)).length) {
        prefix = clause
        continue
      }
      if (isConditionOnly(clause, selfNames)) {
        pending = clause
        continue
      }

      const numbers = extractNumbers(clause)
      const statRule = matchStatRule(clause)
      const note = joinNote([prefix, pending, clause])
      const merged = joinNote([prefix, pending, clause])
      const applySituation = decideApplySituation(merged)
      const applyTarget = decideApplyTarget(clause, joinNote([prefix, pending]), selfNames)
      const element = detectElement(clause)

      let stat = statRule ? statRule.percent : ''
      let value = 0
      let confidence = 'high'
      let confidenceReason = ''

      if (statRule && numbers.length) {
        const primary = pickPrimaryNumber(numbers)
        value = primary.value
        stat = primary.percent ? statRule.percent : statRule.flat
      } else if (statRule && !numbers.length) {
        // 「只有 stat 无数值」 → low（规格 §五.6）
        value = 0
        stat = statRule.percent
        confidence = 'low'
        confidenceReason = '命中 stat 词典但没抓到数值，请手填'
      } else if (!statRule && numbers.length && lastDraft && /该|此|其|上述|同样|额外/.test(clause)) {
        // 「该增益效果额外提升 22.5%」这类指代上一条的句子 → 沿用上一条 stat，仍算 low
        const primary = pickPrimaryNumber(numbers)
        stat = lastDraft.stat
        value = primary.value
        confidence = 'low'
        confidenceReason = '指代上一条（「该增益/此效果」），stat 沿用了上一条，请核对'
      } else if (!statRule && numbers.length) {
        // 「只有数值无 stat」 → low（规格 §五.6）
        const primary = pickPrimaryNumber(numbers)
        stat = 'dmgBonus'
        value = primary.value
        confidence = 'low'
        confidenceReason = '只抓到数值，没命中 stat 词典，stat 默认增伤，请核对'
      } else {
        // 无 stat 也无数值：机制残余，不产草稿
        continue
      }

      if (/每(点|1点|%1点)/.test(clause)) {
        confidence = 'low'
        confidenceReason = confidenceReason || '「每点…」类转模（convert），v1 不做，请手填'
      }
      if (element && !note.includes(`${element}属性`)) {
        // elementFilter 留 all，元素线索补进 note（规格 §四）
        confidenceReason = confidenceReason || `元素限定「${element}属性」写进备注，elementFilter 仍为 all`
      }

      const draft = createDraft({
        id: `${origin}#${drafts.length}`,
        origin,
        stat,
        value,
        kind: 'fixed',
        applyTarget,
        applySituation,
        note,
        confidence,
        confidenceReason,
        sourceText: clause,
      })
      drafts.push(draft)
      unitDrafts.push(draft)
      lastDraft = draft
      pending = ''
    }

    // unit 级叠层后处理：「每层 X%」/「最多叠加 N 层」
    const stack = readStackInfo(unit.text)
    if (stack.perStack != null || stack.maxStacks != null) {
      const target = unitDrafts[unitDrafts.length - 1]
      if (target) {
        const per = stack.perStack != null ? stack.perStack : target.value
        target.kind = 'stacked'
        target.stackable = false
        target.value = per
        target.valuePerStack = per
        target.maxStacks = stack.maxStacks != null ? stack.maxStacks : target.maxStacks
        target.defaultStacks = 1
        if (target.confidence === 'high' && stack.perStack != null && stack.perStack !== target.value) {
          target.confidence = 'low'
          target.confidenceReason = '「每层」数值与基础数值不一致，已按每层值写入，请核对'
        }
      }
    }
  }

  return drafts
}

/** 组装一个「原文项」：槽位 + 原文 + 数值 + 草稿 */
function buildItem({ slot, slotLabel, containerIndex, source, title, text, origin, selfNames }) {
  const rawText = cleanNanokaText(text)
  if (!rawText) return null
  const numbers = extractNumbers(rawText).map((item) => item.value)
  return {
    slot,
    slotLabel,
    containerIndex,
    source,
    title: title ? cleanNanokaText(title) : '',
    rawText,
    numbers,
    drafts: extractDraftsFromText({ text: rawText, origin, selfNames }),
  }
}

/** 取满级那条核心被动 / 额外能力（规格 §一：数值随被动等级爬，取满级那条） */
function pickMaxPassiveLevel(passive) {
  const level = passive?.level
  const list = Array.isArray(level) ? level : Object.values(level ?? {})
  const entries = list.filter(isPlainObject)
  if (!entries.length) return null
  return entries.reduce((best, item) =>
    Number(item.level ?? 0) >= Number(best.level ?? 0) ? item : best,
  )
}

const SKILL_SLOT_LABELS = {
  basic: '普通攻击',
  dodge: '闪避',
  special: '特殊技',
  chain: '连携技',
  assist: '支援技',
}

/**
 * 角色详情 → 原文项 + 翻译条草稿（**纯函数，不联网**）。
 *
 * @param {{ detail?: object, nanokaId?: string|number }} options
 *   `detail` 是浏览器抓来的 `zh/character/<nanokaId>.json` 原文。
 * @returns {{ kind:'agent', nanokaId:string, name:string, items:Array }}
 */
export function extractAgentBuffItems({ detail, nanokaId } = {}) {
  if (!isPlainObject(detail)) throw new Error('缺少角色详情 JSON')
  const id = nanokaId === null || nanokaId === undefined ? '' : String(nanokaId)
  const name = cleanNanokaText(detail.name)
  const selfNames = [name, cleanNanokaText(detail.code_name)].filter(Boolean)
  const items = []

  // 来源 2：核心被动 + 额外能力（取满级）
  const passive = pickMaxPassiveLevel(detail.passive)
  if (passive) {
    const names = Array.isArray(passive.name) ? passive.name : []
    const descs = Array.isArray(passive.desc) ? passive.desc : []
    const core = buildItem({
      slot: 'core',
      slotLabel: '核心被动',
      containerIndex: 0,
      source: 'passive.core',
      title: names[0] ?? '核心被动',
      text: descs[0] ?? '',
      origin: `nanoka:${id}:passive:core`,
      selfNames,
    })
    if (core) items.push(core)
    const extra = buildItem({
      slot: 'extra',
      slotLabel: '额外能力',
      containerIndex: 0,
      source: 'passive.extra',
      title: names[1] ?? '额外能力',
      text: descs[1] ?? '',
      origin: `nanoka:${id}:passive:extra`,
      selfNames,
    })
    if (extra) items.push(extra)
  }

  // 来源 3：影画 1–6（nanoka 里 `talent` 是 `{1:…,6:…}` 对象；也兼容数组写法）
  const talents = Array.isArray(detail.talent)
    ? detail.talent
    : Object.keys(isPlainObject(detail.talent) ? detail.talent : {})
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => detail.talent[key])
  talents.forEach((talent, index) => {
    if (!isPlainObject(talent)) return
    const rank = index + 1
    const item = buildItem({
      slot: `talent-${rank}`,
      slotLabel: `影画 ${rank}`,
      containerIndex: rank,
      source: `talent.${rank}`,
      title: talent.name ?? '',
      text: talent.desc ?? '',
      origin: `nanoka:${id}:talent:${rank}`,
      selfNames,
    })
    if (item) items.push(item)
  })

  // 来源 1：招式文本（仓库无落点 → 仅参考，`containerIndex: null`）
  const skill = isPlainObject(detail.skill) ? detail.skill : {}
  for (const [key, label] of Object.entries(SKILL_SLOT_LABELS)) {
    const block = skill[key]
    if (!isPlainObject(block)) continue
    const descriptions = Array.isArray(block.description) ? block.description : []
    descriptions.forEach((entry, index) => {
      if (!isPlainObject(entry)) return
      const text = entry.desc ?? entry.description ?? ''
      const item = buildItem({
        slot: 'skill',
        slotLabel: `招式文本（${label}）`,
        containerIndex: null,
        source: `skill.${key}.${index}`,
        title: entry.name ?? label,
        text,
        origin: `nanoka:${id}:skill:${key}.${index}`,
        selfNames,
      })
      // 招式文本里没抽出任何草稿的条目一律不返回（避免界面被机制段淹没）
      if (item && item.drafts.length) items.push(item)
    })
  }

  return { kind: 'agent', nanokaId: id, name, items }
}

/**
 * 音擎详情 → 原文项 + 翻译条草稿（**纯函数，不联网**）。
 *
 * @param {{ detail?: object, nanokaId?: string|number }} options
 *   `detail` 是浏览器抓来的 `zh/weapon/<nanokaId>.json` 原文。
 * @returns {{ kind:'wengine', nanokaId:string, name:string, items:Array }}
 */
export function extractWengineBuffItems({ detail, nanokaId } = {}) {
  if (!isPlainObject(detail)) throw new Error('缺少音擎详情 JSON')
  const id = nanokaId === null || nanokaId === undefined ? '' : String(nanokaId)
  const name = cleanNanokaText(detail.name)
  const selfNames = ['装备者', name].filter(Boolean)
  const talents = isPlainObject(detail.talents) ? detail.talents : {}
  const items = []

  // 基础说明（不随精炼变）：nanoka 里是 `talents[0]`；本批 104 把音擎都没有该键，
  // 这时退回顶层 `desc2`（只是「装备后可提升[异常]代理人的战斗能力」这类分类说明，
  // 没有数值时就不产条目，避免界面上多一行空槽）。
  const baseText = talents['0']?.desc ?? detail.desc2 ?? ''
  const baseItem = buildItem({
    slot: 'fixed',
    slotLabel: '基础效果',
    containerIndex: null,
    source: 'fixed',
    title: talents['0']?.name ?? '基础效果',
    text: baseText,
    origin: `nanoka:${id}:fixed`,
    selfNames,
  })
  if (baseItem && (baseItem.drafts.length || talents['0']?.desc)) items.push(baseItem)

  // 精炼 1–5
  for (let level = 1; level <= 5; level += 1) {
    const talent = talents[String(level)]
    if (!isPlainObject(talent)) continue
    const item = buildItem({
      slot: `refinement-${level}`,
      slotLabel: `精炼 ${level}`,
      containerIndex: level - 1,
      source: `talents.${level}`,
      title: talent.name ?? '',
      text: talent.desc ?? '',
      origin: `nanoka:${id}:refinement:${level}`,
      selfNames,
    })
    if (item) items.push(item)
  }

  return { kind: 'wengine', nanokaId: id, name, items }
}

/** 槽位 → 写库落点（`containerIndex` 是容器下标；`null` = 仓库无此落点，仅参考） */
export const SLOT_LANDINGS = {
  agent: {
    core: { container: 'mindscapeBuffs', index: 0, label: '核心被动' },
    extra: { container: 'mindscapeBuffs', index: 0, label: '额外能力' },
  },
  wengine: {
    fixed: { container: 'fixedBuffs', index: null, label: '基础效果' },
  },
}
