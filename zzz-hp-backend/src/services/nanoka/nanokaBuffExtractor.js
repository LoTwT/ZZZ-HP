/**
 * nanoka「增益」抽取 —— **v3「关键字槽位」模型（纯函数：不联网、不读库、不写库）**。
 *
 * 规格：`dev-docs/nanoka-buff-extract-spec-v2-2026-10-16.md`（v2 仍然有效的部分 + 文末「v3 变更」）。
 *
 * 两阶段、三层：
 * ```
 * 层A 原文（nanoka 原文，只读，**无条件入库**）
 *   │  阶段1（本文件 extractKeywordEffects）：切句 → 抽 9 槽位 → 指代/省略/修饰词归一
 * 层B 关键字（9 槽位，可编辑；**人的主战场**，**也入库**，带 `[关键字]` 前缀便于检索）
 *   │  阶段2（本文件 mapKeywordsToEffect）：**纯查表**，确定性映射，规则各自单测
 * 层C 增益效果（= 「增益块」全字段）
 * ```
 *
 * v3 关键口径（与 v2 的差异都写在本文件里，规格文件另有一节）：
 *   1. **删掉「不解析（仅存原文）」开关**：原文无条件入库、关键字也入库，没有"选不选进"的开关。
 *   2. **招式限定 = 条件**（不是来源 / 落点）：文本限定某招式时，条件槽位记 `限定招式：X`，
 *      并复用技能库既有锚点机制（`skillSubcategoryId` / `skillTargets`）关联到该招式；
 *      **锚点关联不上 → 这条不录**（不新建挂载点、不动任何 schema）。
 *   3. 招式文本抽出的效果与其他效果一样进**角色增益块**（槽位 0 / 影画 i），只是带「限定招式」条件；
 *      原文 + 关键字写进该技能的「描述」字段（技能库 = `calculator_skills.note`）。
 *   4. 槽位显示规则（`无` 默认隐藏 / `无法提取` 用 ⚠X + [补]）是**界面**的事，本文件只保证
 *      9 槽位**不许缺格**，且 `无` 与 `无法提取` 严格区分。
 *
 * 四类来源（都扫）：核心被动 / 额外能力 / 影画 1–6 / 招式文本 / 音擎精炼 1–5。
 */
import { normalizeSkillName, stripSkillTitlePrefix } from './nanokaSkillMapper.js'

// ================================================================== 槽位定义

/**
 * 槽位 id（顺序即界面 / 文本里的顺序）。
 *
 * 常规 9 槽位 + **元素**：用户 2026-10-16 二次确认「元素不拆条」——
 * `elementFilter` 本来就是数组（编辑器「属性限定（可多选）」），所以关键字的 `元素` 槽位
 * **允许复数**，一条关键字可以直接带多个元素 → 落成 `elementFilter: ['火','冰']`。
 * **复数白名单 = 条件、元素**（其他槽位仍单值，多值即拆条）。
 */
export const SLOT_IDS = [
  'stat',
  'elements',
  'action',
  'value',
  'unit',
  'target',
  'conditions',
  'stacks',
  'duration',
  'object',
]

/** 允许复数的槽位（白名单） */
export const MULTI_SLOT_IDS = ['conditions', 'elements']

/** 槽位中文名（`关键字：属性=… 动作=…` 的标签） */
export const SLOT_LABELS = {
  stat: '属性',
  elements: '元素',
  action: '动作',
  value: '数值',
  unit: '单位',
  target: '目标',
  conditions: '条件',
  stacks: '层数',
  duration: '时长',
  object: '对象',
}

/** 该维度「这句话里没出现」 */
export const NONE = '无'
/** 该维度「出现了但归不了类」——**绝不能拿 `无` 糊过去** */
export const UNABLE = '无法提取'

/** 关键字入库前缀（v3 变更 2：关键字入库，带前缀/索引便于检索） */
export const KEYWORD_PREFIX = '[关键字]'

/** 阶段2 词表里的 stat 键（与仓库 `BUFF_STAT_KEYS` 同源）对应的中文标签 */
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

/** 属性槽位里的 `<元素>属性伤害`（旧字样，**仍然识别**；输出统一走「增伤 + 元素槽」） */
const ELEMENT_STAT_RE = /^(物理|火|冰|电|以太|风)属性伤害$/

/** 元素（属性槽位里的 `<元素>属性伤害` 用它拆 elementFilter） */
export const ELEMENTS = ['物理', '火', '冰', '电', '以太', '风']

/**
 * 属性槽位下拉的选项集（界面用控件而非打字；`无` / `无法提取` 是显式选项）。
 *
 * **结构性原则（用户 2026-10-16）**：阶段1 的 `属性` 槽位写的是**工具语义**（工具字段的中文语义名），
 * **不是游戏字面**——游戏描述不合理的措辞在阶段1 就改写成工具语义（见 `GAME_LITERAL_REWRITES`），
 * 阶段2 因此只是「属性 → 字段键」的一张表。
 */
export const STAT_OPTIONS = [
  '增伤',
  '招式增伤',
  '异常增伤',
  '异常暴击率',
  '异常暴击伤害',
  '异常精通',
  '异常掌控',
  '暴击率',
  '暴击伤害',
  '攻击力（局外）',
  '攻击力（局内）',
  '攻击力（固定）',
  '生命值',
  '防御力',
  '减防',
  '抗性穿透',
  '穿透率',
  '穿透',
  '冲击力',
  '易伤',
  '失衡易伤',
  '失衡易伤（全局）',
  '直伤易伤',
  '异常易伤',
  '受到伤害降低',
  '能量自动回复',
  '持续时间',
  '技能等级',
]

/**
 * 动作槽位：**必须有**（缺即 `无法提取`，规格 §二）；`为/是/达到` 这类系词按 `提升` 归一。
 *
 * 用户 2026-10-16 二次确认（最终口径）：**动作表固定 4 个**：
 *   - `提升` / `降低` —— 作用于**目标**：易伤 `vulnerable` / `reduceDefense` / `resPen`；
 *   - `无视`           —— 无视防御 / 抗性 → `reduceDefense` / `resPen`；
 *   - `转化`           —— **转模，走专用槽位**（见 `CONVERT_SLOT_IDS`）：`kind='convert'`、`effect.value≡0`。
 * **「回复」已去掉**：`生命回复` / `立即回复 N 点能量` 这类既没有动作、阶段2 也查不到字段 →
 * 在阶段1 结束时按「可映射性预检」整条进**废原文**（见 `checkKeywordMappable`）。
 * 不进动作表的动词（`获得` / `视为` / `替代` / `进入…状态`）同样当条件用，或进废原文。
 * 除「转化」外，其余动作共用**常规 9 槽位**。
 */
export const ACTION_OPTIONS = ['提升', '降低', '无视', '转化']

/**
 * 转模（动作=`转化`）专用槽位（用户 2026-10-16 二次确认，字段对齐
 * `calculatorBuffService.normalizeConvert`）。`目标属性` 就是常规 `属性` 槽位（= `effect.stat`）；
 * 下面这 5 个是转模独有的，阶段二的字段区用它们**取代** 数值 / 单位。
 */
export const CONVERT_SLOT_IDS = [
  'convertFrom',
  'convertPanelSource',
  'convertRatio',
  'convertBase',
  'convertCap',
]

/** 转模专用槽位中文名（文案定稿，用户 2026-10-16；括号里是它对应的 `normalizeConvert` 字段） */
export const CONVERT_SLOT_LABELS = {
  convertFrom: '读取属性', // convert.from
  convertPanelSource: '取哪一层', // convert.panelSource
  convertRatio: '折算比例', // convert.ratioPercent
  convertBase: '基础值', // convert.defaultBase
  convertCap: '上限', // convert.cap
}

/** 转模槽位的悬浮提示（界面直接显示，字典唯一来源在这里） */
export const CONVERT_SLOT_HINTS = {
  convertFrom: '读取属性：它的值 × 折算比例 = 本条增益（如 特殊技等级 ×150% → 增伤）',
  convertPanelSource: '取哪一层：进战外面板 / 最终面板 / 手动值',
  convertRatio: '折算比例：百分数填法（150 = 150%）',
  convertBase: '基础值：只有超出它的部分参与折算（defaultBase）',
  convertCap: '上限：折算结果的绝对值上限（cap）',
}

/**
 * `convert.from` 取值（与 `normalizeConvert` 的 ATTRS 同源）。
 * **顺序即界面下拉顺序**（用户 2026-10-16）：常用属性在前 → `角色等级(level)`、`技能等级（特殊技）`
 * 在后（库里真有数据：蕾米埃尔 特殊技等级×150% → 增伤；希格莉德 等级×1200% → 攻击上限 720）→
 * 其余 4 个技能类别来源垫底保留。
 */
export const CONVERT_FROM_OPTIONS = [
  'hp',
  'atk',
  'def',
  'critRate',
  'critDmg',
  'mastery',
  'anomalyControl',
  'energyRegen',
  'penRate',
  'impact',
  'pierce',
  'level',
  'skillLevelSpecial',
  'skillLevelBasic',
  'skillLevelDodge',
  'skillLevelAssist',
  'skillLevelChainUltimate',
]

/** 读取属性中文名（阶段1 认词 + 界面下拉） */
export const CONVERT_FROM_LABELS = {
  hp: '生命值',
  atk: '攻击力',
  def: '防御力',
  critRate: '暴击率',
  critDmg: '暴击伤害',
  mastery: '异常精通',
  anomalyControl: '异常掌控',
  energyRegen: '能量自动回复',
  penRate: '穿透率',
  impact: '冲击力',
  pierce: '穿透值',
  level: '角色等级',
  skillLevelSpecial: '技能等级（特殊技）',
  skillLevelBasic: '技能等级（普通攻击）',
  skillLevelDodge: '技能等级（闪避）',
  skillLevelAssist: '技能等级（支援技）',
  skillLevelChainUltimate: '技能等级（连携技/终结技）',
}

/** 取哪一层（`convert.panelSource`） */
export const CONVERT_PANEL_SOURCE_OPTIONS = ['external', 'final', 'manual']

/** 取哪一层中文名 */
export const CONVERT_PANEL_SOURCE_LABELS = {
  external: '进战外面板',
  final: '最终面板',
  manual: '手动值',
}

/** 目标槽位：`无` = 默认自身（规格 §二） */
export const TARGET_OPTIONS = ['自身', '全队', '指定职业', '指定阵营']

/** 对象槽位（增益作用在谁 / 什么上） */
export const OBJECT_OPTIONS = ['当前招式', '装备者', '敌人', '能量']

/** 单位槽位：**只与数值成对**（`%` / `点`；纯数写 `无`） */
export const UNIT_OPTIONS = ['%', '点']

/** 层数槽位下拉（数值部分用 `stackMax` 数字输入，界面拼成 `最多 12 层`） */
export const STACK_OPTIONS = [NONE, UNABLE]

/** 时长槽位下拉（数值部分用 `durationSeconds` 数字输入，界面拼成 `15 秒`） */
export const DURATION_OPTIONS = [NONE, UNABLE]

/**
 * 条件槽位下拉候选（**唯一允许复数**的槽位）。`无` = 无条件（全局）。
 * 界面允许下拉到这里没有的句式 → `无法提取`（不许写 `无` 糊过去）。
 */
export const CONDITION_OPTIONS = [
  NONE,
  '攻击失衡敌人时',
  '攻击非失衡敌人时',
  '发动强化特殊技时',
  '发动连携技或终结技时',
  '敌人处于属性异常状态时',
  '队伍中存在与自身属性或阵营相同的角色时',
  '队伍中存在其他异常角色或同阵营角色时',
  UNABLE,
]

/**
 * 给界面用的下拉选项集（含 `无` / `无法提取` 这些显式选项）——**唯一来源**，随接口下发。
 * `元素` 是**多选**（`ELEMENTS`），`条件` 也是多值；其余槽位单值。
 */
export const SLOT_OPTIONS = {
  stat: [...STAT_OPTIONS, NONE, UNABLE],
  elements: [...ELEMENTS, NONE],
  action: [...ACTION_OPTIONS, UNABLE],
  value: 'number',
  unit: [...UNIT_OPTIONS, NONE],
  target: [...TARGET_OPTIONS, NONE, UNABLE],
  conditions: CONDITION_OPTIONS,
  stacks: STACK_OPTIONS,
  duration: DURATION_OPTIONS,
  object: [...OBJECT_OPTIONS, NONE, UNABLE],
  // —— 转模（动作=转化）专用槽位
  convertFrom: [...CONVERT_FROM_OPTIONS, UNABLE],
  convertPanelSource: CONVERT_PANEL_SOURCE_OPTIONS,
  convertRatio: 'number',
  convertBase: 'number',
  convertCap: 'number',
}

/** 槽位取值是否「阻断」（`无法提取`） */
export function isUnable(value) {
  if (value === UNABLE) return true
  if (Array.isArray(value)) return value.includes(UNABLE)
  return false
}

/** 该条有哪些槽位标了 `无法提取` → 阻断自动映射（规格 §二硬规则 7） */
export function unableSlotsOf(effect) {
  const slots = effect?.slots ?? {}
  return SLOT_IDS.filter((id) => isUnable(slots[id]))
}

/** 该槽位是不是「无值」（`无` / 空）——**界面默认隐藏**的判据（v3 变更 1） */
export function isEmptySlot(value) {
  if (value === null || value === undefined) return true
  if (Array.isArray(value)) return value.every((item) => isEmptySlot(item))
  const text = String(value).trim()
  return !text || text === NONE
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// ================================================================== 文本工具

/** 去富文本标签 + 去运行时模板（`{CAL:...}`）、去图标占位；`rawText` / `note` 都用它 */
export function cleanNanokaText(raw) {
  return String(raw ?? '')
    .replace(/<IconMap:[^>]*>/g, '')
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

/** 判定用的文本：去掉角色 / 音擎自身名与 `N号` 这类名字里的数字（「11号」的 11 不是增益数值） */
export function numberSafeText(text, selfNames = []) {
  let out = String(text ?? '')
  for (const name of selfNames) {
    if (!name) continue
    out = out.split(name).join('')
  }
  return out.replace(/[「」]?\d+号[「」]?/g, '')
}

/**
 * 抽「增益数值」token：与 `extractNumbers` 同口径，但**剔掉自身名里的数字**
 * （「11号」的 11 不是增益数值；判定靠数字后面紧跟 `号`）。
 */
function gainNumbers(text) {
  const source = String(text ?? '')
  const out = []
  const re = /\d+(?:\.\d+)?%?/g
  let match
  while ((match = re.exec(source)) !== null) {
    const raw = match[0]
    if (source[match.index + raw.length] === '号') continue
    const percent = raw.endsWith('%')
    const value = Number(percent ? raw.slice(0, -1) : raw)
    if (!Number.isFinite(value)) continue
    out.push({ value, unit: percent ? '%' : '点', percent, index: match.index })
  }
  return out
}

/**
 * 层数：**`层` 不是单位**（规格 §二硬规则 1）。
 * 只认「叠层」语义（`最多(叠加) N 层` / `每层`）；`充能 / 资源层数` 不算（走「不产条」）。
 */
export function readStackInfo(text) {
  const source = String(text ?? '')
  if (/充能|资源/.test(source)) {
    return { maxStacks: null, perStack: false, mentioned: false }
  }
  let maxStacks = null
  let perStack = false
  const maxMatch = /(?:最多|至多|上限)(?:叠加)?\s*(\d+)\s*层/.exec(source)
  if (maxMatch) maxStacks = Number(maxMatch[1])
  if (maxStacks === null) {
    const plain = /叠加\s*(\d+)\s*层/.exec(source)
    if (plain) maxStacks = Number(plain[1])
  }
  if (/每层/.test(source)) perStack = true
  return { maxStacks, perStack, mentioned: maxStacks !== null || perStack }
}

/**
 * 时长：`持续 15 秒` → 15（`时长` 独立槽位：不进数值、阶段2 不转化，规格 §二硬规则 4）。
 * 「N 秒内最多触发一次」是**触发上限**（条件），不是时长，先剔掉再判。
 * 「该效果的**持续时间**提升 2 秒」里 `持续时间` 是**属性**（不是时长槽位）→ 不标 `无法提取`。
 */
export function readDurationInfo(text) {
  const source = String(text ?? '').replace(/\d+\s*秒内最多触发[^，。；]*/g, '')
  const match = /持续(?:时间)?\s*(\d+(?:\.\d+)?)\s*秒/.exec(source)
  const durationAsStat = /持续时间(?:提升|增加|延长|缩短|降低|减少)/.test(source)
  const vague = /持续(?:时间)?\s*(?:一段|数|若干)?\s*(?:秒|时间)/.test(source)
  const mentioned =
    match !== null || /时限|持续时间限制|限制时间/.test(source) || (vague && !durationAsStat)
  return {
    seconds: match ? Number(match[1]) : null,
    mentioned,
  }
}

/**
 * 来源属性词典（`convert.from`）：**顺序即优先级**（`攻击力` 之类长的先认）。
 * 只认 `normalizeConvert` 的 ATTRS 里的键，不自创。
 */
const CONVERT_FROM_RULES = [
  { from: 'critRate', re: /暴击率/ },
  { from: 'critDmg', re: /暴击伤害/ },
  { from: 'mastery', re: /异常精通/ },
  { from: 'anomalyControl', re: /异常掌控/ },
  { from: 'energyRegen', re: /能量(?:自动)?回复|回能/ },
  { from: 'penRate', re: /穿透率/ },
  { from: 'pierce', re: /穿透值/ },
  { from: 'impact', re: /冲击力/ },
  { from: 'atk', re: /攻击力/ },
  { from: 'hp', re: /生命值|生命上限/ },
  { from: 'def', re: /防御力/ },
  { from: 'level', re: /等级/ },
]

/**
 * 「转化」句判定（动作=`转化` = 转模）：
 *   1. 显式转化动词；2. 「每点 X 使得/提升 Y」这类**按点转模**（句子动词可能是「提升」，语义是转模）。
 */
const CONVERT_VERB_RE = /转化|转换为|换算为|转为/
const CONVERT_PER_POINT_RE =
  /每\s*(?:1|一)?\s*点[^，。；]{0,20}?(?:会?使得|转化为|换算为|提升|增加|提高)/

/** 按点转模的起手（`每点` / `每1点`） */
const CONVERT_PER_POINT_HEAD_RE = /每\s*(?:1|一)?\s*点/

/** 这条子句是不是转模（动作=`转化`） */
export function isConvertClause(text) {
  const source = String(text ?? '')
  return CONVERT_VERB_RE.test(source) || CONVERT_PER_POINT_RE.test(source)
}

/**
 * 读「转模」（动作=`转化`）的专用槽位：来源属性 / 取值层 / 比例% / 基础值 / 上限。
 * 读不出的槽位一律 `无法提取`（**不许拿 `无` 糊过去**；那条进阶段二等用户补）。
 *
 * 两种句式都认：
 *   1. 显式转化动词：`每1点攻击力转化为1.5点生命值`
 *   2. 按点转模：`每点超过的异常掌控会使得该效果的暴击率额外提升0.7%`
 *
 * @param {string} text 该条关键字所在的完整文本（本子句 + 条件前缀）
 * @returns {{ convertFrom:string, convertPanelSource:string, convertRatio:number|string,
 *   convertBase:number|null, convertCap:number|null, fromLabel:string, targetText:string, reason:string }}
 */
export function readConvertParts(text) {
  const source = String(text ?? '')
  // 显式转化动词优先；没有时按「每点 X（使得/提升）Y」的起手切
  const verbMatch = CONVERT_VERB_RE.exec(source)
  const marker = verbMatch ?? CONVERT_PER_POINT_HEAD_RE.exec(source)
  const before = marker ? source.slice(0, marker.index) : source
  const after = marker ? source.slice(marker.index + marker[0].length) : source
  // 「…会使得/使/令 X 提升 Y」：转模的目标属性在「使得」之后
  const pivot = /(?:会?使得|令|使)/.exec(after)
  const targetText = pivot ? after.slice(pivot.index + pivot[0].length) : after

  const fromHit = CONVERT_FROM_RULES.find((rule) => rule.re.test(before))
  const convertFrom = fromHit?.from ?? UNABLE

  let convertPanelSource = 'external'
  if (/手动|自行设置/.test(source)) convertPanelSource = 'manual'
  else if (/最终面板|局内面板|最终值/.test(source)) convertPanelSource = 'final'
  else if (/局外|战外面板|局外面板|面板/.test(source)) convertPanelSource = 'external'

  // 比例：取「转化」后面**第一个**数值（`1点攻击力转化为1.5点生命值` → 1.5）；
  // 「上限 / 基础值」那两个数字不算比例，先剔掉。
  const ratioSource = after
    .replace(/上限\s*(?:为)?\s*[:：]?\s*\d+(?:\.\d+)?\s*%?/g, '')
    .replace(/(?:基础值|初始值)\s*[:：]?\s*\d+(?:\.\d+)?\s*%?/g, '')
  const ratioTokens = gainNumbers(ratioSource)
  const convertRatio = ratioTokens.length ? ratioTokens[0].value : UNABLE

  const baseMatch = /(?:基础值|初始值)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%?/.exec(source)
  const capMatch = /上限\s*(?:为)?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%?/.exec(source)

  return {
    convertFrom,
    convertPanelSource,
    convertRatio,
    convertBase: baseMatch ? Number(baseMatch[1]) : null,
    convertCap: capMatch ? Number(capMatch[1]) : null,
    fromLabel: CONVERT_FROM_LABELS[convertFrom] ?? '',
    targetText,
    reason: convertFrom === UNABLE && convertRatio === UNABLE ? '转模的来源属性与比例都读不出' : '',
  }
}

/** 层数槽位文本（`最多 12 层` / `无` / `无法提取`） */
export function formatStacks(maxStacks, value) {
  if (value === UNABLE || value === NONE) return value
  if (Number.isFinite(Number(maxStacks)) && Number(maxStacks) > 0) return `最多 ${maxStacks} 层`
  return UNABLE
}

/** 时长槽位文本（`15 秒` / `无` / `无法提取`） */
export function formatDuration(seconds, value) {
  if (value === UNABLE || value === NONE) return value
  if (Number.isFinite(Number(seconds)) && Number(seconds) > 0) return `${seconds} 秒`
  return UNABLE
}

/**
 * 关键字 → 一行人类可读文本：`属性=… 动作=… 数值=… 单位=… 目标=… 条件=… 层数=… 时长=… 对象=…`
 * 动作=`转化` 时，后面再补**转模专用槽位**（来源属性 / 取值层 / 比例% / 基础值 / 上限）。
 */
export function formatKeywordSlots(slots, convert = null) {
  const show = (value) => {
    if (Array.isArray(value)) return value.join(' + ')
    if (value === null || value === undefined || value === '') return NONE
    return String(value)
  }
  const parts = SLOT_IDS.map((id) => `${SLOT_LABELS[id]}=${show(slots?.[id])}`)
  if (convert) {
    for (const id of CONVERT_SLOT_IDS) {
      parts.push(`${CONVERT_SLOT_LABELS[id]}=${show(convert?.[id])}`)
    }
  }
  return parts.join(' ')
}

/**
 * 关键字入库行（v3 变更 2）：`[关键字] 属性=…`；一条原文有 N 条关键字时带**序号索引**便于检索。
 * 只有一条时写 `[关键字]`，多条时写 `[关键字 1]`、`[关键字 2]`…
 */
export function formatKeywordLine(slots, index = 0, total = 1, convert = null) {
  const prefix = total > 1 ? `[关键字 ${index + 1}]` : KEYWORD_PREFIX
  return `${prefix} ${formatKeywordSlots(slots, convert)}`
}
/**
 * 一段原文的入库文本：`原文：…` + N 行 `[关键字] …`（**追加不覆盖**，规格 §四）。
 * v3：原文与关键字**都**入库，没有"选不选进"的开关；**废原文不入库**（只管传本条的关键字）。
 */
export function formatSourceBlock({ rawText, effects } = {}) {
  const list = Array.isArray(effects) ? effects : []
  const lines = [`原文：${String(rawText ?? '').trim()}`]
  list.forEach((effect, index) => {
    const slots = effect?.slots ?? effect
    const convert =
      slots?.action === '转化' || effect?.convert ? (effect?.convert ?? null) : null
    lines.push(formatKeywordLine(slots, index, list.length, convert))
  })
  return lines.join('\n')
}

// ================================================================== 招式锚点（v3 变更 5 / 6）

/**
 * 招式名 → 招式大类（复用仓库 `SkillCategoryId` 口径）。
 * **顺序即优先级**：越具体的越靠前（`强化特殊技` 必须先于 `特殊技`）。
 */
export const SKILL_LIMIT_RULES = [
  { name: '强化特殊技', category: 'special' },
  { name: '特殊技', category: 'special' },
  { name: '普通攻击', category: 'basic' },
  { name: '冲刺攻击', category: 'dodge' },
  { name: '闪避反击', category: 'dodge' },
  { name: '闪避', category: 'dodge' },
  { name: '招架支援', category: 'assist' },
  { name: '快速支援', category: 'assist' },
  { name: '支援突击', category: 'assist' },
  { name: '支援技', category: 'assist' },
  { name: '连携技', category: 'chain' },
  { name: '终结技', category: 'ultimate' },
  { name: '追加攻击', category: 'follow_up' },
]

/** 招式限定句里容易出现、但不是招式名的词（防误判） */
const SKILL_LIMIT_STOPWORDS = ['招式', '技能', '伤害', '增益']

/**
 * 从一段文本里找出「被限定的招式」。
 * 判据：命中 `SKILL_LIMIT_RULES` 里的招式名（`[普通攻击]` / `强化特殊技` 都算）。
 * `招式` / `技能` 这类泛称**不算**限定（否则任何增益句都会被判成"限定招式"）。
 */
export function detectSkillLimits(text) {
  const source = String(text ?? '')
  if (!source) return []
  const found = []
  for (const rule of SKILL_LIMIT_RULES) {
    if (!source.includes(rule.name)) continue
    if (SKILL_LIMIT_STOPWORDS.includes(rule.name)) continue
    if (found.some((item) => item.name === rule.name)) continue
    found.push({ name: rule.name, category: rule.category })
  }
  // 更具体的招式名命中时，吃掉被它包含的泛称（同一个招式，不该算两条限定）
  const suppress = [
    ['强化特殊技', '特殊技'],
    ['闪避反击', '闪避'],
    ['招架支援', '支援技'],
    ['快速支援', '支援技'],
    ['支援突击', '支援技'],
  ]
  let out = found
  for (const [specific, generic] of suppress) {
    if (out.some((item) => item.name === specific)) {
      out = out.filter((item) => item.name !== generic)
    }
  }
  return out
}

/** 锚点候选名（小类名 / 去标题前缀 / 去「技」尾） */
function anchorNameCandidates(name) {
  const raw = String(name ?? '').replace(/[[\]]/g, '').trim()
  const out = new Set()
  const push = (value) => {
    const norm = normalizeSkillName(value)
    if (norm) out.add(norm)
  }
  push(raw)
  push(stripSkillTitlePrefix(raw))
  if (raw.endsWith('技')) push(raw.slice(0, -1))
  else push(`${raw}技`)
  return [...out]
}

/**
 * 招式限定 → 既有锚点（**只认技能库已有小类 / 大类，不新建挂载点**）。
 *
 * @param {object} params
 * @param {Array<{name:string, category:string}>} params.limits `detectSkillLimits` 的结果
 * @param {Array<object>|null} params.anchors 技能库小类（`listCalculatorBuffs().skillSubcategories`）；
 *   `null` = 调用方没给（**不猜** → 判为关联不上）
 * @param {string} params.agentId 角色 id（小类按角色过滤，空 = 只看通用小类）
 * @returns {{ ok:boolean, resolved:Array, skillTargets:Array, skillCategory:string,
 *   skillSubcategoryId:string|null, reason:string, labels:string[] }}
 */
export function resolveSkillAnchors({ limits = [], anchors = null, agentId = '' } = {}) {
  const list = Array.isArray(limits) ? limits : []
  const labels = list.map((item) => item.name)
  if (!list.length) {
    return {
      ok: true,
      resolved: [],
      skillTargets: [],
      skillCategory: '',
      skillSubcategoryId: null,
      reason: '',
      labels,
    }
  }
  if (!Array.isArray(anchors)) {
    return {
      ok: false,
      resolved: [],
      skillTargets: [],
      skillCategory: '',
      skillSubcategoryId: null,
      reason: '技能库小类未加载，锚点关联不上 → 按 v3 规则这条不录',
      labels,
    }
  }

  const id = String(agentId ?? '')
  const forAgent = anchors.filter((sub) => {
    const subAgent = String(sub?.agentId ?? '')
    return !subAgent || !id || subAgent === id
  })

  const resolved = []
  const pendingCreates = []
  for (const limit of list) {
    const candidates = anchorNameCandidates(limit.name)
    const hit = forAgent.find((sub) => candidates.includes(normalizeSkillName(sub?.name)))
    if (hit) {
      resolved.push({
        name: limit.name,
        category: String(hit.categoryId ?? limit.category),
        subcategoryId: String(hit.id ?? '') || null,
        level: 'subcategory',
        needsCreate: false,
      })
      continue
    }
    // 用户 2026-10-16：关键字里的招式名不一定和技能名完全一致 →
    // **匹配不上就按该技能名建立锚点**再关联（建不出锚点才不录）。
    resolved.push({
      name: limit.name,
      category: limit.category,
      subcategoryId: null,
      level: 'category',
      needsCreate: true,
    })
    pendingCreates.push({
      name: limit.name,
      categoryId: limit.category,
      agentId: id,
    })
  }

  const skillTargets = []
  for (const item of resolved) {
    const key = `${item.category}|${item.subcategoryId ?? ''}`
    if (skillTargets.some((t) => `${t.category}|${t.subcategoryId ?? ''}` === key)) continue
    skillTargets.push({ category: item.category, subcategoryId: item.subcategoryId })
  }
  // 同一大类里既有「整大类」又有具体小类时，丢掉整大类那条（小类更精确，且已被覆盖）
  const scoped = skillTargets.filter(
    (t) =>
      t.subcategoryId != null ||
      !skillTargets.some((other) => other.category === t.category && other.subcategoryId != null),
  )
  const first = scoped[0] ?? null
  const allSameCategory = scoped.length === 1
  return {
    ok: true,
    resolved,
    skillTargets: scoped,
    skillCategory: allSameCategory ? String(first?.category ?? '') : '',
    skillSubcategoryId: allSameCategory ? (first?.subcategoryId ?? null) : null,
    pendingCreates,
    reason: '',
    labels,
  }
}

// ================================================================== 阶段1：槽位抽取

/**
 * 强负信号（**有数值也不产增益条**）：这些句子看起来像增益，但仓库里没有对应字段
 * （或属于别的线：招式倍率 / 生命值回复 / 资源点数）。
 *
 * v3：这类句子统一进「**废原文**」区（带丢弃原因，**不入库**，确认写入后丢弃）。
 * 与我方减伤一起是「整条丢弃」；`无法提取` 只是**槽位级**标记，那条仍然进阶段二等用户补。
 */
const HARD_SKIP_RULES = [
  { re: /获取效率|充能效率/, reason: '资源获取效率（仓库无对应字段）' },
  { re: /获得\d+(?:\.\d+)?层充能|消耗\d+(?:\.\d+)?层充能/, reason: '充能资源（不是增益叠层）' },
  {
    re: /(?:回复|恢复|补充)[^，。；]{0,10}生命值|生命值(?:回复|恢复)/,
    reason: '生命值回复（仓库无对应字段）',
  },
  {
    re: /每\s*\d+(?:\.\d+)?\s*秒(?:受到|造成)|每\s*\d+(?:\.\d+)?\s*秒[^，。；]{0,6}伤害/,
    reason: '周期伤害（归招式 / 异常线）',
  },
  { re: /(?:达到|为)最(?:大|小)值/, reason: '阈值说明（无新增数值）' },
  { re: /倍率/, reason: '倍率（归招式线）' },
  { re: /获得\d+(?:\.\d+)?点|消耗\d+(?:\.\d+)?点|最多拥有\d+(?:\.\d+)?点/, reason: '资源点数（仓库无对应字段）' },
  { re: /(?:获得|消耗|上限(?:为)?)\s*\d+(?:\.\d+)?\s*次/,
    reason: '状态 / 次数（仓库无对应字段）' },
  // 「使某个既有机制的易伤上限提升至 X%」：工具没有「改上限」字段 → 废原文
  {
    re: /(?:易伤|增伤|加成|减伤|穿透)[^，。；]{0,12}上限\s*(?:提升|增加|提高|至|为)/,
    reason: '改既有机制的上限（工具无「改上限」字段）',
  },
]

/** 结构句：只描述层数 / 时长 / 刷新，本身不产效果（由 unit 级后处理消费） */
const STRUCTURAL_RE =
  /^(?:最多|至多|上限)?(?:叠加)?\d+层(?:效果)?$|^每层(?:效果)?|^持续\d+(?:\.\d+)?秒$|^(?:重复触发)?刷新|^\d+秒内最多触发/

/** 触发上限 / 冷却尾巴（跟在增益句后面 → 补进该条的「条件」槽位） */
const TRAILING_LIMIT_RE = /\d+\s*秒内最多触发|最多触发(?:一次|\d+次)|冷却时间|内置冷却|刷新持续时间/

/** 阈值句（`大于 155 点` / `达到 255 点` / `不足 40 点`）：**永远**当条件，不产数值 */
const THRESHOLD_RE =
  /(?:大于|小于|超过|不足|达到|至少|高于|低于|不小于|不少于|等于|至多|最多拥有)\s*(?:等于|超过)?\s*\d+(?:\.\d+)?\s*(?:点|%|层)?/

/** 条件句尾巴：`…时` / `…后` / `…期间` / `…触发` */
const CONDITION_TAIL_RE = /(?:时|后|期间|情况下|状态下|触发)[：:]?$|^(?:若|如果|当|在)[^，。；]*$/

/** 指代 / 修饰词（`该增益效果` / `额外提升` / `再次提升`）：阶段1 归一 */
const REFERENCE_RE =
  /该(?:增益)?效果|上述效果|该增益|此效果|该效果|同样|额外提升|额外增加|再次提升|继续提升|额外获得/

/** 队伍 / 自身 指代 */
const TEAM_RE = /全队|队伍全体|我方全体|我方所有|队伍中所有|队伍中全体/
const SELF_RE = /自身|自己|装备者|本角色|当前操作角色/

/**
 * **游戏字面 → 工具语义** 的改写表（用户 2026-10-16 的结构性原则，只作说明 + 单测锚点）。
 *
 * 阶段1 输出的关键字必须是**工具语义**，不是游戏字面：游戏描述不合理的措辞在这里就改写掉
 * （把改写结果直接写进关键字的 `属性` 槽位），阶段2 才能保持"纯查表"。
 * 实际改写逻辑就在下面的 `STAT_RULES_INTERNAL`（顺序即优先级）；这张表是它的**可读清单**，
 * 单测按这张表逐条钉住。
 */
export const GAME_LITERAL_REWRITES = [
  {
    literal: '（目标/敌人）受到的伤害提升 X%',
    stat: '增伤',
    note: '⚠ 游戏描述不合理：实为**增伤**（`dmgBonus`），**不是**易伤 `vulnerable`',
  },
  {
    literal: '（目标/敌人）受到的伤害降低 X%',
    stat: '增伤',
    note: '同上；动作=降低 → 阶段2 取负号',
  },
  {
    literal: '失衡状态下受到的伤害提升 X%',
    stat: '失衡易伤',
    note: '→ `staggerVulnerable`（仅失衡期计入），条件槽位同时记失衡',
  },
  {
    literal: '失衡期与非失衡期均…',
    stat: '失衡易伤（全局）',
    note: '→ `globalStaggerVulnerable`（扳机式）',
  },
  {
    literal: '无视目标 X% 防御力',
    stat: '减防',
    note: '→ `reduceDefense`（动作=无视）',
  },
  {
    literal: '目标防御力降低 X%',
    stat: '减防',
    note: '→ `reduceDefense`（动作=降低）',
  },
  {
    literal: '无视目标 X% 抗性',
    stat: '抗性穿透',
    note: '→ `resPen`',
  },
]

/** 属性词典（**顺序即优先级**；取值与 `STAT_OPTIONS` 一一对应，写**工具语义**） */
const STAT_RULES_INTERNAL = [
  // ① 失衡易伤家族（「失衡状态下受到的伤害提升」）：全局/均生效的版本在阶段1 由作用域文本判定
  {
    keyword: '失衡易伤',
    re: /(?:失衡(?:状态|期|阶段)?)[^，。；]{0,14}(?:受到的伤害|受到伤害)(?:提升|增加|提高|降低|减少|下降)|失衡易伤/,
  },
  // ② 限定过主语（直伤 / 异常）的易伤仍是各自字段
  {
    keyword: '直伤易伤',
    re: /(?:敌人|敌方|目标|对方)[^，。；]{0,10}受到的直(?:伤|击)伤害(?:提升|增加|提高|降低|减少|下降)|直伤易伤/,
  },
  {
    keyword: '异常易伤',
    re: /(?:敌人|敌方|目标|对方)[^，。；]{0,12}受到的(?:属性)?异常伤害(?:提升|增加|提高|降低|减少|下降)|异常易伤/,
  },
  // ③ ⚠ 游戏描述坑：「（目标/敌人）受到的伤害提升 / 降低 X%」= **增伤**（不是易伤）
  {
    keyword: '增伤',
    re: /(?:敌人|敌方|目标|对方)[^，。；]{0,10}(?:受到的伤害|受到伤害)(?:提升|增加|提高|降低|减少|下降)/,
  },
  // ④ 减防 / 抗性穿透（无视 / 降低 的落法）
  { keyword: '减防', re: /(?:无视|降低|减少)[^，。；]{0,8}防御力|防御力(?:降低|减少|下降)/ },
  { keyword: '抗性穿透', test: (t) => /抗性/.test(t) && /无视|降低|减少|穿透/.test(t) },
  { keyword: '招式增伤', re: /招式(?:造成的)?伤害|招式增伤|技能(?:造成的)?伤害|技能伤害/ },
  { keyword: '异常暴击伤害', re: /属性异常伤害(?:的)?暴击伤害|异常伤害(?:的)?暴击伤害|异常暴击伤害/ },
  { keyword: '异常暴击率', re: /属性异常伤害(?:的)?暴击率|异常伤害(?:的)?暴击率|异常暴击率/ },
  { keyword: '异常精通', re: /异常精通/ },
  { keyword: '异常掌控', re: /异常掌控/ },
  { keyword: '异常增伤', re: /属性异常伤害|异常伤害/ },
  { keyword: '暴击率', re: /暴击率/ },
  { keyword: '暴击伤害', re: /暴击伤害/ },
  {
    keyword: '',
    test: (t) => /(?:物理|火|冰|电|以太|风)属性伤害/.test(t),
    keywordOf: (t) => `${/(物理|火|冰|电|以太|风)属性伤害/.exec(t)?.[1] ?? ''}属性伤害`,
  },
  { keyword: '全属性伤害', re: /全属性伤害/ },
  { keyword: '能量自动回复', re: /能量(?:自动)?(?:回复|恢复|回能)|回能(?:效率|速度)|能量(?:效率|速度)/ },
  // 「能量」本身没有工具字段（瞬时回能 = 废原文，见 v3.12/v3.13）
  { keyword: '攻击力', re: /攻击力|基础攻击力/ },
  { keyword: '生命值', re: /生命值|生命上限/ },
  { keyword: '防御力', re: /防御力/ },
  { keyword: '穿透率', re: /穿透率/ },
  { keyword: '穿透', re: /穿透值|穿透(?!率)/ },
  { keyword: '冲击力', re: /冲击力/ },
  { keyword: '持续时间', re: /持续时间(?:提升|增加|延长|缩短|降低|减少)/ },
  { keyword: '技能等级', re: /技能等级/ },
  // ⑤ 兜底增伤（最泛的「造成的伤害提升 / 增伤」）
  { keyword: '增伤', re: /造成的伤害|伤害(?:提升|增加|提高|加成)|增伤/ },
]

/**
 * 把「属性」再按上下文细化成工具语义：攻击力按局内 / 局外 / 固定拆开（用户点名的语义名）。
 * 返回新的属性取值。
 */
export function refineStatKeyword(keyword, { text = '', unit = '' } = {}) {
  const stat = String(keyword ?? '')
  if (stat !== '攻击力') return stat
  if (unit === '点') return '攻击力（固定）'
  if (/局内|最终面板|最终值/.test(String(text ?? ''))) return '攻击力（局内）'
  return '攻击力（局外）'
}

/**
 * 动作词典（**动作必须有**；`为/是/达到` 这类系词按 `提升` 归一）。
 * `回复` **不在表里**（用户 2026-10-16 最终口径）：回复类句子走可映射性预检 → 废原文。
 */
const ACTION_RULES_INTERNAL = [
  { keyword: '无视', re: /无视/ },
  { keyword: '降低', re: /降低|减少|下降|衰减|削减/ },
  { keyword: '转化', re: /转化|转换为|换算为|转为/ },
  { keyword: '提升', re: /提升|增加|提高|提供|加成|强化|增长/ },
]

const IMPLICIT_ACTION_RE = /(?:为|是|达到|达)\s*\d|[+＋]\s*\d/

/**
 * 我方减伤**不存在**（用户 2026-10-16 二次确认）：仓库里的 `dmgReduction` 等字段是
 * 「**目标**的减伤」语义（从输出里扣），不是角色自身减伤 → 这类句子进**废原文**。
 * 注意区分：**「敌方受到的伤害提升」= 易伤 `vulnerable`，是增益，要留**。
 */
const SELF_DAMAGE_REDUCTION_RE =
  /(?:受到(?:的)?伤害(?:降低|减少|下降)|伤害减免|减伤|受伤(?:降低|减少))/

/** 不进动作表的动词（`获得` / `视为` / `替代` / `进入…状态`）：当条件用，或进废原文 */
const NON_ACTION_VERB_RE = /获得|视为|替代|进入[^，。；]{0,8}状态/

/** 伤害描述句（`造成火属性伤害` 这类纯描述，不是增益） */
const DAMAGE_STATEMENT_RE = /造成[^，。；]{0,12}伤害|视为[^，。；]{0,12}伤害/

/** 增益动词（判定「这句是不是在说增益」用） */
const BUFF_VERB_RE = /提升|增加|提高|降低|减少|无视|回复|恢复|获得|提供|加成|强化|增长|转化/

/** 属性槽位：命中即返回具体 keyword（未命中返回 ''） */
function detectStatKeyword(text) {
  for (const rule of STAT_RULES_INTERNAL) {
    if (rule.test ? rule.test(text) : rule.re.test(text)) {
      return rule.keywordOf ? rule.keywordOf(text) : rule.keyword
    }
  }
  return ''
}

/** 动作槽位：`{ value, source }`（未命中 → `无法提取`） */
function detectAction(text) {
  for (const rule of ACTION_RULES_INTERNAL) {
    if (rule.re.test(text)) return { value: rule.keyword, source: 'literal' }
  }
  if (IMPLICIT_ACTION_RE.test(text)) return { value: '提升', source: 'implicit' }
  return { value: UNABLE, source: 'unable' }
}

/** 阈值短语（永远当条件，数值不进「数值」槽位） */
function extractThresholds(text) {
  const found = []
  const re = new RegExp(THRESHOLD_RE.source, 'g')
  let match
  while ((match = re.exec(String(text ?? ''))) !== null) found.push(match[0].trim())
  return found
}

/** 条件句判定：阈值句恒为条件；`…时/后/期间` 且（去掉自身名后）无数字时也是条件 */
function isConditionOnly(text, selfNames = []) {
  if (extractThresholds(text).length) return true
  if (!CONDITION_TAIL_RE.test(text)) return false
  return gainNumbers(numberSafeText(text, selfNames)).length === 0
}

/** `无` 条件（无条件 = 全局） */
function noCondition() {
  return [NONE]
}

function conditionList(parts) {
  const list = []
  for (const part of parts) {
    const text = String(part ?? '').trim()
    if (!text || text === NONE) continue
    if (!list.includes(text)) list.push(text)
  }
  return list.length ? list : noCondition()
}

/** 目标槽位判定（`无` = 默认自身；队伍条件是「条件」不是「目标」） */
function detectTarget(clauseText, selfNames, inherited) {
  const text = String(clauseText ?? '')
  if (TEAM_RE.test(text)) return { value: '全队', source: 'literal' }
  for (const name of selfNames) {
    if (name && text.includes(name)) return { value: '自身', source: 'literal' }
  }
  if (SELF_RE.test(text)) return { value: '自身', source: 'literal' }
  if (inherited) return { value: inherited, source: 'inherited' }
  return { value: NONE, source: 'default' }
}

/** 对象槽位判定（增益作用在谁 / 什么上） */
function detectObject(clauseText, action, inherited) {
  const text = String(clauseText ?? '')
  if (/当前招式|该招式|本招式|招式发动期间/.test(text)) {
    return { value: '当前招式', source: 'literal' }
  }
  if (/能量/.test(text) && /回复|恢复|回能/.test(text)) return { value: '能量', source: 'literal' }
  if (/敌人|目标/.test(text) && (action === '无视' || action === '降低')) {
    return { value: '敌人', source: 'literal' }
  }
  if (inherited) return { value: inherited, source: 'inherited' }
  return { value: NONE, source: 'default' }
}

/** 一条关键字的 9 槽位 + 元素（**不许缺格**） */
function createSlots({ stat, elements, action, value, unit, target, conditions, stacks, duration, object }) {
  return {
    stat: stat?.value ?? NONE,
    elements: Array.isArray(elements) && elements.length ? [...elements] : [NONE],
    action: action?.value ?? UNABLE,
    value: value?.value ?? UNABLE,
    unit: unit?.value ?? NONE,
    target: target?.value ?? NONE,
    conditions: conditions?.value ?? noCondition(),
    stacks: stacks ?? NONE,
    duration: duration ?? NONE,
    object: object?.value ?? NONE,
  }
}

/** 槽位取值的来源（界面用来区分「原文写的」/「继承来的」/「默认」/「读不出」） */
function createSources({ stat, elements, action, value, unit, target, conditions, stacks, duration, object }) {
  return {
    stat: stat?.source ?? 'default',
    elements: Array.isArray(elements) && elements.length ? 'literal' : 'default',
    action: action?.source ?? 'unable',
    value: value?.source ?? 'unable',
    unit: unit?.source ?? 'default',
    target: target?.source ?? 'default',
    conditions: conditions?.source ?? 'default',
    stacks: stacks?.source ?? 'default',
    duration: duration?.source ?? 'default',
    object: object?.source ?? 'default',
  }
}

/**
 * 把一条子句按「数值」切成若干段，凡是不带属性/动作词的尾段并回前一段
 * （避免把「[普通攻击]、[冲刺攻击]造成的伤害提升3%」这类定语拆错）。
 */
function splitClauseIntoGroups(clause) {
  const numbers = gainNumbers(clause)
  if (numbers.length <= 1) return [clause]
  const segments = []
  let start = 0
  for (const token of numbers) {
    const end = token.index + String(token.value).length + (token.percent ? 1 : 0)
    segments.push(clause.slice(start, end))
    start = end
  }
  if (start < clause.length) segments.push(clause.slice(start))
  const merged = []
  for (const segment of segments) {
    const hasStat = Boolean(detectStatKeyword(segment))
    const hasAction = detectAction(segment).value !== UNABLE
    if (merged.length && !hasStat && !hasAction) merged[merged.length - 1] += segment
    else merged.push(segment)
  }
  return merged.map((text) => text.trim()).filter(Boolean)
}

/** 机制句（**没有数值**时 → 废原文）：无敌 / 抗打断 / 段数衔接 / 状态与次数… */
const MECHANISM_PATTERNS = [
  /无敌/,
  /抗打断|霸体|韧性/,
  /不会战败|免于退场|致命伤害时不会/,
  /后撤动作|衔接|跳过|换入|换出|勘域模式/,
  /格挡|闪避反击|免疫该次伤害/,
  /视为\[?[^\]]*\]?伤害/,
]

/** 命中「机制句」？（无敌 / 抗打断 / 段数衔接…） */
export function isMechanismText(text) {
  return MECHANISM_PATTERNS.some((re) => re.test(String(text ?? '')))
}

/**
 * 阶段1：一段原文 → N 条「关键字效果」（N≥1；条件不是独立效果，只进槽位）。
 *
 * v3：不再有「不解析（仅存原文）」开关；判为无意义的句子进 `waste`（**废原文**）：
 * 带丢弃原因、不入库、阶段二确认写入后丢弃。
 *
 * @param {object} options
 * @param {string} options.text 原文（nanoka 原文或界面里编辑过的文字）
 * @param {string} [options.origin] 来源标记（写进关键字 `origin`）
 * @param {string[]} [options.selfNames] 自身名（判「自身」指代 / 剔名字里的数字）
 * @param {Array<object>|null} [options.anchors] 技能库小类（锚点）；`null` = 没加载 → 招式限定条不录
 * @param {string} [options.agentId] 角色 id（锚点按角色过滤）
 * @returns {{ effects:Array, waste:Array<{text:string, reason:string}> }}
 */
export function extractKeywordEffects({
  text,
  origin = '',
  selfNames = [],
  anchors = null,
  agentId = '',
} = {}) {
  const units = splitUnits(text)
  const effects = []
  const waste = []
  let prefix = '' // 段落级前缀条件（`…：` 抬头，作用于整段）
  let pending = [] // 子句级条件（作用于紧随其后的那一条，用掉即清）
  let lastEffect = null // 指代继承的来源

  const pushWaste = (clause, reason) => {
    const key = `${clause}|${reason}`
    if (!waste.some((item) => `${item.text}|${item.reason}` === key)) {
      waste.push({ text: clause, reason })
    }
  }

  units.forEach((unit, unitIndex) => {
    pending = []
    const unitText = unit.clauses.join('，')
    const stack = readStackInfo(unitText)
    const duration = readDurationInfo(unitText)
    const unitEffects = []

    for (const rawClause of unit.clauses) {
      const clause = rawClause.trim()
      if (!clause) continue

      // 0) 触发上限 / 冷却尾巴：补进上一条的「条件」（条件槽位是唯一允许复数的）
      if (TRAILING_LIMIT_RE.test(clause) && !gainNumbers(clause).length) {
        if (lastEffect && unitEffects.includes(lastEffect)) {
          lastEffect.slots.conditions = conditionList([...lastEffect.slots.conditions, clause])
          continue
        }
      }

      // 1) 抬头条件（`…：`）：作用于整段
      if (/[：:]$/.test(clause) && !gainNumbers(numberSafeText(clause, selfNames)).length) {
        prefix = clause.replace(/[：:]$/, '')
        continue
      }

      // 2) 结构句（层数 / 时长 / 刷新）：不产效果
      if (STRUCTURAL_RE.test(clause)) continue

      // 3) 条件句（阈值 / `…时` / `若…`）：**不是独立效果**，进「条件」槽位
      if (isConditionOnly(clause, selfNames)) {
        pending.push(clause)
        continue
      }

      // 4) 我方减伤 → 废原文（用户 2026-10-16：「减伤不存在」）。
      //    主语是**敌人**时不算：那是「敌方受到的伤害降低」= 易伤（取负号），归阶段2。
      if (
        SELF_DAMAGE_REDUCTION_RE.test(clause) &&
        !/(?:敌人|敌方|目标|对方)/.test(clause)
      ) {
        pushWaste(clause, '我方减伤不存在（dmgReduction 是目标减伤语义）')
        continue
      }

      // 5) 强负信号（资源 / 倍率 / 回血 / 周期伤害…）→ 废原文
      const hardSkip = HARD_SKIP_RULES.find((rule) => rule.re.test(clause))
      if (hardSkip) {
        pushWaste(clause, hardSkip.reason)
        continue
      }

      // 6) 机制句（无敌 / 抗打断 / 段数衔接…）：没有数值时 → 废原文
      const clauseNumbers = gainNumbers(clause)
      if (!clauseNumbers.length && isMechanismText(clause)) {
        pushWaste(clause, '机制句（无敌 / 抗打断 / 段数衔接…）')
        continue
      }

      const clauseAction = detectAction(clause)
      const isConvert = isConvertClause(clause)

      // 7) 与增益无关的描述句（没命中属性词典，也没转模，且没有数值 / 没有动作）
      if (
        !detectStatKeyword(clause) &&
        !isConvert &&
        (!clauseNumbers.length || clauseAction.value === UNABLE)
      ) {
        pushWaste(clause, '没命中属性词典（描述句 / 无可量数值）')
        continue
      }

      // 7.5) 不进动作表的动词（获得 / 视为 / 替代 / 进入…状态）：当条件用，或进废原文
      if (NON_ACTION_VERB_RE.test(clause) && clauseAction.value === UNABLE && !isConvert) {
        pushWaste(clause, '动词不在动作表（获得 / 视为 / 替代 / 进入状态）')
        continue
      }

      // 7.6) 动作不存在（没有动作动词，也没有数值）→ 废原文；
      //      有数值但没动作 → **保留**，动作槽位标 `无法提取`，进阶段二等用户补
      if (clauseAction.value === UNABLE && !clauseNumbers.length && !isConvert) {
        pushWaste(clause, '动作不存在（没有动作动词，也没有数值）')
        continue
      }

      // 7.7) 纯伤害描述（`造成火属性伤害` 这类没有增益动词的句子）
      if (DAMAGE_STATEMENT_RE.test(clause) && !BUFF_VERB_RE.test(clause) && !isConvert) {
        pushWaste(clause, '伤害描述（不是增益）')
        continue
      }

      // 8) 拆条：一条子句里出现多个「属性 + 数值」→ N 条效果（规格 §二硬规则 3）。
      //    转模句（动作=转化）**不拆**：`每1点攻击力转化为1.5点暴击率` 是一个效果。
      const groups = isConvert ? [clause] : splitClauseIntoGroups(clause)
      const thresholds = extractThresholds(clause)
      const skillLimits = detectSkillLimits([prefix, ...pending, clause].join('，'))
      const anchorInfo = skillLimits.length
        ? resolveSkillAnchors({ limits: skillLimits, anchors, agentId })
        : resolveSkillAnchors({ limits: [], anchors, agentId })
      const skillLimitCondition = skillLimits.length
        ? `限定招式：${skillLimits.map((item) => item.name).join(' + ')}`
        : ''
      const documentConditions = conditionList([
        prefix,
        ...pending,
        skillLimitCondition,
        // 阈值短语（`不足40点`）也是条件：它是触发门槛，不是增益数值
        ...thresholds,
      ])
      let emittedInClause = false

      for (const group of groups) {
        const groupIsConvert = isConvertClause(group) || isConvert
        const convertParts = groupIsConvert ? readConvertParts([prefix, ...pending, group].join('，')) : null
        const rawStatKeyword = groupIsConvert
          ? detectStatKeyword(convertParts?.targetText ?? group) || detectStatKeyword(group)
          : detectStatKeyword(group)
        // 「（失衡状态下）受到的伤害提升」：属失衡易伤家族 → 只有在**失衡**在作用域里时才这么判；
        // 否则按「游戏描述坑」当**增伤**（`增伤`）处理（用户 2026-10-16 纠正）。
        const damageTakenPhrase = /(?:受到的伤害|受到伤害)(?:提升|增加|提高|降低|减少|下降)/.test(group)
        const scopeText = `${prefix}，${pending.join('，')}，${unitText}`
        const imbalanceInScope = /失衡/.test(scopeText)
        const globalImbalance = /(?:均|全局|常驻|非失衡期)[^，。；]{0,10}(?:生效|存在|计入)|均受到|都受到/.test(
          scopeText,
        )
        const statKeyword =
          damageTakenPhrase &&
          imbalanceInScope &&
          rawStatKeyword !== '直伤易伤' &&
          rawStatKeyword !== '异常易伤'
            ? globalImbalance
              ? '失衡易伤（全局）'
              : '失衡易伤'
            : rawStatKeyword
        const action = groupIsConvert
          ? { value: '转化', source: 'implicit' }
          : detectAction(group)
        const isReference = REFERENCE_RE.test(group)
        const inherited = lastEffect ?? null
        const inheritedSlots = inherited?.slots ?? null
        const contextText = [prefix, ...pending, group].join('，')

        // 属性：本句认不出时按「指代 / 省略」继承（继承值写成具体词）
        let stat = { value: statKeyword || '', source: statKeyword ? 'literal' : 'default' }
        if (!statKeyword) {
          if (isReference && inheritedSlots) stat = { value: inheritedSlots.stat, source: 'inherited' }
          else {
            const fromContext = detectStatKeyword(contextText)
            if (fromContext) stat = { value: fromContext, source: 'inherited' }
          }
        }
        if (stat.value === NONE || !stat.value) stat = { value: UNABLE, source: 'unable' }
        // 数值 / 单位（**层数、时长不进数值**；阈值不进数值；`技能等级+2` 这类纯数写 `无`）
        // 转模条：数值 / 单位**不适用**（比例% 走专用槽位），显式写 `无`（不是「无法提取」）。
        const valueTokens = gainNumbers(group)
        const plusOnly = /[+＋]\s*\d/.test(group) && !/%/.test(group)
        const unit = groupIsConvert
          ? { value: NONE, source: 'default' }
          : valueTokens.length
            ? {
                value: plusOnly ? NONE : valueTokens[valueTokens.length - 1].unit,
                source: plusOnly ? 'default' : 'literal',
              }
            : { value: NONE, source: 'default' }
        const value = groupIsConvert
          ? { value: NONE, source: 'default' }
          : valueTokens.length
            ? { value: valueTokens[valueTokens.length - 1].value, source: 'literal' }
            : { value: UNABLE, source: 'unable' }

        // 工具语义细化：攻击力按局内 / 局外 / 固定拆开（用户点名的语义名）
        const refinedStat = refineStatKeyword(stat.value, { text: group, unit: unit.value })
        if (refinedStat && refinedStat !== stat.value && stat.source !== 'unable') {
          stat = { value: refinedStat, source: stat.source }
        }

        // 元素**统一走元素槽**（用户 2026-10-16 二次确认）：单元素也写 `属性=增伤 / 元素=火`
        // → `elementFilter=['火']`；不再有「属性=火属性伤害」这第二种写法（旧字样仍能被识别，
        // 见 `STAT_TABLE` 里的别名与下面的 `ELEMENT_STAT_RE` 兜底）。多元素同样只出一条。
        const elementHits = ELEMENTS.filter((element) => group.includes(`${element}属性伤害`))
        let elements = elementHits
        const elementStatMatch = ELEMENT_STAT_RE.exec(String(stat.value))
        if (elementStatMatch) {
          stat = { value: '增伤', source: stat.source }
          if (!elements.length) elements = [elementStatMatch[1]]
        } else if (String(stat.value) === '全属性伤害') {
          // 「全属性伤害」= 不限元素 → 元素槽留空，阶段2 elementFilter 保持 all
          stat = { value: '增伤', source: stat.source }
          elements = []
        }

        const target = detectTarget(group, selfNames, inheritedSlots?.target)
        const object = detectObject(group, action.value, inheritedSlots?.object)

        const recorded = !(skillLimits.length && anchorInfo.ok !== true)
        const effect = {
          id: `${origin}#${effects.length}`,
          origin,
          index: effects.length,
          unitIndex,
          unitText,
          sentence: group,
          slots: createSlots({
            stat,
            elements,
            action,
            value,
            unit,
            target,
            conditions: { value: documentConditions, source: 'literal' },
            stacks: NONE,
            duration: NONE,
            object,
          }),
          sources: createSources({
            stat,
            elements,
            action,
            value,
            unit,
            target,
            conditions: { source: 'literal' },
            stacks: { source: 'default' },
            duration: { source: 'default' },
            object,
          }),
          convert: convertParts,
          stackMax: null,
          durationSeconds: null,
          perStack: false,
          // —— v3 招式限定（条件，不是来源 / 落点）
          skillLimits,
          anchors: {
            ok: anchorInfo.ok,
            labels: anchorInfo.labels,
            resolved: anchorInfo.resolved,
            skillTargets: anchorInfo.skillTargets,
            skillCategory: anchorInfo.skillCategory,
            skillSubcategoryId: anchorInfo.skillSubcategoryId,
            /** 需要在技能库里**建立**的小类锚点（`{ name, categoryId, agentId }`） */
            pendingCreates: anchorInfo.pendingCreates ?? [],
            reason: anchorInfo.reason,
          },
          recorded,
          dropReason: recorded ? '' : anchorInfo.reason || '招式锚点关联不上 → 按 v3 规则这条不录',
        }
        // —— v3：可映射性预检（动作 + 属性 → 阶段2 词表反查）。查不到字段的**整条**进废原文，
        //    阶段1 就结束（不进阶段2）：「生命回复」「立即回复 N 点能量」都走这条。
        const mappable = checkKeywordMappable({
          slots: {
            ...effect.slots,
            conditions: documentConditions,
          },
          text: `${unitText}，${group}`,
        })
        if (!mappable.ok) {
          pushWaste(group, mappable.reason)
          continue
        }

        effects.push(effect)
        unitEffects.push(effect)
        lastEffect = effect
        emittedInClause = true
      }

      if (emittedInClause) pending = []
    }

    // unit 级后处理：层数 / 时长挂到本 unit 最后一条效果（**层、秒都不是单位**）
    const targetEffect = unitEffects[unitEffects.length - 1]
    if (targetEffect) {
      if (stack.mentioned) {
        targetEffect.stackMax = stack.maxStacks
        targetEffect.perStack = stack.perStack
        targetEffect.slots.stacks = stack.maxStacks ? formatStacks(stack.maxStacks, 'literal') : UNABLE
        targetEffect.sources.stacks = stack.maxStacks ? 'literal' : 'unable'
      }
      if (duration.mentioned) {
        targetEffect.durationSeconds = duration.seconds
        targetEffect.slots.duration = duration.seconds
          ? formatDuration(duration.seconds, 'literal')
          : UNABLE
        targetEffect.sources.duration = duration.seconds ? 'literal' : 'unable'
      }
    }
  })

  return { effects, waste }
}

// ================================================================== 阶段2：纯查表映射

/**
 * 属性词表（**阶段2 唯一入口**；`单位 → stat`）。
 * 键 = 阶段1 的属性槽位取值；值 = `{ '%': stat, '点': stat }`。
 *
 * ⚠ **游戏描述坑（用户 2026-10-16 纠正，别按字面翻译）**：
 * 「目标 / 敌人**受到的伤害提升** X%」在游戏文案里读起来像易伤，**实际是【增伤】** →
 * 阶段1 故意**不**产出 `易伤`，这句话被「伤害加成」接住 → `dmgBonus`。
 * 证据：全库 `vulnerable` 只有 1 条（莱卡恩影画 6）且值为 0，槽位备注写着「不知道是不是易伤区，
 * 目前按易伤区算」——是**存疑占位**，不是有效用法；家族实际用量是
 * `staggerVulnerable` 13 / `staggerVulnerableOnly` 2 / `globalStaggerVulnerable` 2 / `vulnerable` 1。
 * 所以：**抽取器不主动产出 `vulnerable`**（下拉里保留该取值，只有用户手动改才用）。
 * 保留的易伤类落法：失衡态 → `staggerVulnerable`；失衡期与非失衡期**均**生效 / 常驻失衡易伤 →
 * `globalStaggerVulnerable`（扳机核心被动 35、影画 1 20 就是实例，目标=全队）。
 */
const STAT_TABLE = {
  // —— 工具语义（阶段1 写进 `属性` 的值）
  增伤: { '%': 'dmgBonus', 点: 'dmgBonus' },
  全属性伤害: { '%': 'dmgBonus', 点: 'dmgBonus' },
  招式增伤: { '%': 'skillDmgBonus', 点: 'skillDmgBonus' },
  异常增伤: { '%': 'anomalyDmgBonus', 点: 'anomalyDmgBonus' },
  异常暴击率: { '%': 'anomalyCritRate', 点: 'anomalyCritRate' },
  异常暴击伤害: { '%': 'anomalyCritDmg', 点: 'anomalyCritDmg' },
  异常精通: { 点: 'mastery', '%': 'mastery' },
  异常掌控: { '%': 'anomalyControlPercent', 点: 'anomalyControl' },
  暴击率: { '%': 'critRate', 点: 'critRate' },
  暴击伤害: { '%': 'critDmg', 点: 'critDmg' },
  '攻击力（局外）': { '%': 'externalAtkPercent', 点: 'atk' },
  '攻击力（局内）': { '%': 'inCombatAtkPercent', 点: 'atk' },
  '攻击力（固定）': { '%': 'externalAtkPercent', 点: 'atk' },
  生命值: { '%': 'externalHpPercent', 点: 'hp' },
  防御力: { '%': 'externalDefPercent', 点: 'def' },
  减防: { '%': 'reduceDefense', 点: 'reduceDefense' },
  抗性穿透: { '%': 'resPen', 点: 'resPen' },
  穿透率: { '%': 'penRate', 点: 'penRate' },
  穿透: { 点: 'pierce', '%': 'pierce' },
  易伤: { '%': 'vulnerable', 点: 'vulnerable' }, // **只供手动**（抽取器不主动产出，见上面的「游戏描述坑」）
  失衡易伤: { '%': 'staggerVulnerable', 点: 'staggerVulnerable' },
  '失衡易伤（全局）': { '%': 'globalStaggerVulnerable', 点: 'globalStaggerVulnerable' },
  直伤易伤: { '%': 'directVulnerable', 点: 'directVulnerable' },
  异常易伤: { '%': 'anomalyVulnerable', 点: 'anomalyVulnerable' },
  // 我方减伤在阶段1 已进废原文；这里保留取值只为**手动补词**（界面下拉里还在）
  受到伤害降低: { '%': 'dmgReduction', 点: 'dmgReduction' },
  能量自动回复: { '%': 'energyRegen', 点: 'energyRegen' },
  // —— 旧取值别名（老关键字 / 手填内容仍能映射）
  伤害加成: { '%': 'dmgBonus', 点: 'dmgBonus' },
  招式伤害: { '%': 'skillDmgBonus', 点: 'skillDmgBonus' },
  异常伤害: { '%': 'anomalyDmgBonus', 点: 'anomalyDmgBonus' },
  攻击力: { '%': 'externalAtkPercent', 点: 'atk' },
  抗性: { '%': 'resPen', 点: 'resPen' },
  穿透值: { 点: 'pierce', '%': 'pierce' },
}

/** 易伤家族的字段（动作=`降低` 时取负号；失衡条件时优先走 `staggerVulnerable`） */
const VULNERABLE_STATS = new Set([
  'vulnerable',
  'directVulnerable',
  'anomalyVulnerable',
  'globalStaggerVulnerable',
  'staggerVulnerable',
  'staggerVulnerableOnly',
])

// `<元素>属性伤害` → 通用增伤 + elementFilter（阶段2 由 `mapKeywordsToEffect` 拆元素）
for (const element of ELEMENTS) {
  STAT_TABLE[`${element}属性伤害`] = { '%': 'dmgBonus', 点: 'dmgBonus' }
}

/**
 * 阶段2 的额外规则（**动作把属性改写**，用户 2026-10-16 最终口径「降低 / 无视 的落法」）：
 *   无视 + 抗性穿透 → `resPen`；无视 / 降低 + 减防 → `reduceDefense`；
 *   降低 + 易伤家族 → 取负号；失衡态 → `staggerVulnerable` 系列。
 * 注：`ignoreDefense` **不在 `BUFF_STAT_KEYS` 里**，这里绝不使用；`dmgReduction` 的语义是
 * 「**目标**减伤」（易伤区里的减项），我方「受到的伤害降低」在阶段1 已进废原文。
 */
const ACTION_STAT_OVERRIDES = {
  减防: { 无视: 'reduceDefense', 降低: 'reduceDefense' },
  抗性穿透: { 无视: 'resPen', 降低: 'resPen', 提升: 'resPen' },
  易伤: { 提升: 'vulnerable', 降低: 'vulnerable' },
  失衡易伤: { 提升: 'staggerVulnerable', 降低: 'staggerVulnerable' },
  '失衡易伤（全局）': {
    提升: 'globalStaggerVulnerable',
    降低: 'globalStaggerVulnerable',
  },
  直伤易伤: { 提升: 'directVulnerable', 降低: 'directVulnerable' },
  异常易伤: { 提升: 'anomalyVulnerable', 降低: 'anomalyVulnerable' },
  // 旧取值别名
  抗性: { 无视: 'resPen', 降低: 'resPen', 提升: 'resPen' },
}

/**
 * 动作 + 属性（+ 单位 / 条件 / 原文）→ 阶段2 的增益字段；查不到返回 `''`（**阶段1 预检与阶段2 同源**）。
 */
export function resolveStatField({ stat, action, unit = '%', conditions = [], text = '' } = {}) {
  const keyword = String(stat ?? '').trim()
  const act = String(action ?? '').trim()
  if (!keyword || !ACTION_OPTIONS.includes(act)) return ''
  let field = ACTION_STAT_OVERRIDES[keyword]?.[act] ?? ''
  if (!field) {
    const table = STAT_TABLE[keyword]
    const key = String(unit ?? '').trim()
    if (table) {
      field =
        act === '转化'
          ? (table['%'] ?? Object.values(table)[0] ?? '')
          : (table[key] ?? table['%'] ?? Object.values(table)[0] ?? '')
    }
  }
  if (!field) return ''
  const joined = `${(Array.isArray(conditions) ? conditions : []).join('，')}，${String(text ?? '')}`
  // 失衡易伤家族：显式「失衡易伤」或条件里带失衡 → staggerVulnerable；
  // 「失衡期与非失衡期**均**生效 / 常驻」→ globalStaggerVulnerable（扳机式）
  if (field === 'staggerVulnerable' || (field === 'vulnerable' && keyword === '易伤')) {
    if (/失衡/.test(joined)) {
      if (/(?:均|全局|常驻|非失衡期)[^，。；]{0,10}(?:生效|存在|计入)|均受到|都受到/.test(joined)) {
        field = 'globalStaggerVulnerable'
      } else if (field === 'vulnerable') {
        field = 'staggerVulnerable'
      }
    }
  }
  return field
}

/**
 * **可映射性预检**（用户 2026-10-16 最终口径）：阶段1 抽完关键字后，
 * 拿「动作 + 属性」去阶段2 词表反查；查不到对应字段的**整条**在阶段1 结束时归入**废原文**
 * （写明原因），**不进阶段2**。
 *
 * ⚠ 关键区分（用户 2026-10-16 二次确认）：**`无法提取` 是槽位级标记、留给人补，不是丢弃** ——
 * `动作=无法提取` 或 `属性=无法提取` 的条目**留在阶段2**（标 `blocked / 待补`，阻断自动映射，
 * 等用户补完再解析）。只有这两种才进废原文：
 *   1. 动作**认得**（在动作表内）但属性在阶段2 词表里查不到对应字段；
 *   2. 命中明确的机制 / 舍弃模式（我方减伤、生命回复、瞬时回能、无敌·抗打断、改上限…）——
 *      那些在更早的步骤里已经被 `pushWaste` 掉了。
 *
 * 例：「生命回复」「立即回复 N 点能量」「技能等级+2」= 废原文；「能量自动回复 +X%」= 正常。
 */
export function checkKeywordMappable({ slots, text = '' } = {}) {
  const value = isPlainObject(slots) ? slots : {}
  const action = String(value.action ?? '').trim()
  const stat = String(value.stat ?? '').trim()
  // —— 槽位级 `无法提取` → 留在阶段2 等补（**不丢**）
  if (isUnable(action) || !action || action === NONE) {
    return { ok: true, field: '', pending: true, reason: '' }
  }
  if (isUnable(stat) || !stat || stat === NONE) {
    return { ok: true, field: '', pending: true, reason: '' }
  }
  if (!ACTION_OPTIONS.includes(action)) {
    return {
      ok: false,
      field: '',
      reason: `动作「${action}」不在动作表（${ACTION_OPTIONS.join(' / ')}）→ 阶段2 查不到对应字段`,
    }
  }
  const field = resolveStatField({
    stat,
    action,
    unit: String(value.unit ?? '%'),
    conditions: value.conditions,
    text,
  })
  if (!field) {
    return {
      ok: false,
      field: '',
      reason: `属性=${stat} + 动作=${action}：阶段2 词表里没有对应字段（需补词表）`,
    }
  }
  return { ok: true, field, reason: '' }
}

function isPercentUnit(unit) {
  return unit === '%'
}

/** 转模专用槽位里哪些被标了 `无法提取` */
function unableConvertSlots(convert) {
  const out = []
  for (const id of CONVERT_SLOT_IDS) {
    if (id === 'convertBase' || id === 'convertCap') continue // 基础值 / 上限允许留空
    if (isUnable(convert?.[id])) out.push(id)
  }
  return out
}

/**
 * 阶段2：**纯查表**把一条关键字映射成层C 增益效果（不做语义理解）。
 *
 * @param {object} keyword `{ slots, convert, stackMax, durationSeconds, anchors, id, origin, rawText }`
 * @returns {{ ok:boolean, blocked:boolean, unableSlots:string[], unmapped:string[], notices:string[],
 *   steps:string[], stat:string, statLabel:string, effect:object|null, reason:string }}
 */
export function mapKeywordsToEffect(keyword = {}) {
  const slots = isPlainObject(keyword.slots) ? keyword.slots : {}
  const steps = []
  const unmapped = []
  const notices = []
  const unableSlots = SLOT_IDS.filter((id) => isUnable(slots[id]))

  // 硬规则 7：`无法提取` 阻断该条自动映射（界面标红待补）
  if (unableSlots.length) {
    return {
      ok: false,
      blocked: true,
      unableSlots,
      unmapped: [],
      notices,
      steps,
      stat: '',
      statLabel: '',
      effect: null,
      reason: `有 ${unableSlots.map((id) => SLOT_LABELS[id]).join(' / ')} 标了「${UNABLE}」，已阻断自动映射（补齐后重试）`,
    }
  }

  // v3 招式锚点：关联不上 → 这条不录（不新建挂载点、不动 schema）
  if (keyword.anchors && keyword.anchors.ok === false) {
    return {
      ok: false,
      blocked: true,
      unableSlots: [],
      unmapped: [],
      notices,
      steps,
      stat: '',
      statLabel: '',
      effect: null,
      reason: keyword.anchors.reason || '招式锚点关联不上 → 按 v3 规则这条不录',
    }
  }

  const statKeyword = String(slots.stat ?? '').trim()
  const action = String(slots.action ?? '').trim()
  const unit = String(slots.unit ?? '').trim()
  const target = String(slots.target ?? '').trim()
  const object = String(slots.object ?? '').trim()
  const stacks = String(slots.stacks ?? '').trim()
  const duration = String(slots.duration ?? '').trim()
  const conditions = Array.isArray(slots.conditions) && slots.conditions.length ? slots.conditions : [NONE]
  const value = Number(slots.value)
  const isConvert = action === '转化'

  // —— 数值（转模条不用「数值」：值由运行时折算，`effect.value ≡ 0`）
  if (!isConvert) {
    if (!Number.isFinite(value)) {
      unmapped.push(`数值「${slots.value}」不是数字，阶段2 无法映射`)
    }
    if (!unit || unit === NONE) {
      steps.push(`单位=${NONE}（纯数，按词表默认单位取键）`)
    }
  }

  // —— 属性 + 动作 → stat（与阶段1 预检 `checkKeywordMappable` 同一个查表函数）
  const override = ACTION_STAT_OVERRIDES[statKeyword]?.[action]
  const stat = resolveStatField({
    stat: statKeyword,
    action,
    unit,
    conditions,
    text: String(keyword.rawText ?? ''),
  })
  if (!stat) {
    unmapped.push(
      `属性「${statKeyword || NONE}」+ 动作「${action || NONE}」在阶段2 词表里没有对应字段（需补词表）`,
    )
  } else if (override) {
    steps.push(`属性=${statKeyword} + 动作=${action} → stat=${stat}`)
  } else if (isConvert) {
    steps.push(`属性=${statKeyword}（转模目标属性）→ stat=${stat}`)
  } else {
    steps.push(
      `属性=${statKeyword} + 动作=${action} + 数值=${slots.value} + 单位=${unit || NONE} → stat=${stat}`,
    )
  }
  if (stat === 'staggerVulnerable' && statKeyword === '易伤') {
    steps.push('条件含失衡 → 走失衡易伤系列 staggerVulnerable')
  }
  if (stat && !isConvert && !isPercentUnit(unit) && unit === NONE && /Percent|Rate|Crit|Bonus|Pen/i.test(stat)) {
    steps.push(`单位=${NONE} 按百分比语义取值（${STAT_LABELS[stat] ?? stat}）`)
  }

  // —— 元素过滤：`元素` 槽位（**允许复数**）优先；没有该槽位时由属性里的 `<元素>属性伤害` 拆
  const elementSlot = Array.isArray(slots.elements)
    ? slots.elements.filter((item) => item && item !== NONE && item !== UNABLE)
    : []
  let elementFilter = 'all'
  if (elementSlot.length) {
    elementFilter = [...elementSlot]
    steps.push(`元素=${elementSlot.join(' + ')}（可多选）→ elementFilter=${JSON.stringify(elementFilter)}`)
  } else {
    const elementMatch = /^(物理|火|冰|电|以太|风)属性伤害$/.exec(statKeyword)
    if (elementMatch) {
      elementFilter = [elementMatch[1]]
      steps.push(`属性=${statKeyword} → elementFilter=['${elementMatch[1]}']`)
    }
    if (statKeyword === '全属性伤害') {
      steps.push('属性=全属性伤害 → elementFilter 留 all（不限元素）')
    }
  }

  // —— 条件 → applySituation（条件原文一律进 note）
  // 条件**不阻断**映射（v2 规格 §三：映射不了的才由「我补词表」解决；条件只是不做完整枚举建模）
  const conditionTexts = conditions.filter((item) => item && item !== NONE)
  let applySituation = 'global'
  if (!conditionTexts.length) {
    steps.push(`条件=${NONE} → applySituation=global`)
  } else {
    const joined = conditionTexts.join('，')
    if (/非失衡/.test(joined)) applySituation = 'non_stagger'
    else if (/失衡/.test(joined)) applySituation = 'stagger'
    steps.push(
      `条件=${conditionTexts.join(' + ')} → applySituation=${applySituation}` +
        (applySituation === 'global' ? '（阶段2 不做条件枚举建模，条件原文进 note）' : ''),
    )
    for (const text of conditionTexts) {
      if (applySituation === 'global' || !/失衡/.test(text)) {
        notices.push(`条件「${text}」阶段2 不做完整建模 → 只进 note`)
      }
    }
  }

  // —— 目标 → applyTarget
  let applyTarget = 'self'
  if (target === '全队') {
    applyTarget = 'team'
    steps.push('目标=全队 → applyTarget=team')
  } else {
    steps.push(`目标=${target || NONE} → applyTarget=self`)
  }

  // —— 招式锚点（v3：条件用锚点关联到该招式；关联不上前面已 return）
  const anchors = keyword.anchors && isPlainObject(keyword.anchors) ? keyword.anchors : null
  const skillTargets = Array.isArray(anchors?.skillTargets) ? anchors.skillTargets : []
  if (skillTargets.length) {
    steps.push(
      `限定招式=${anchors.labels.join(' + ')} → skillTargets=` +
        JSON.stringify(skillTargets),
    )
  }

  // —— 转模专用槽位
  const convert = isConvert ? (isPlainObject(keyword.convert) ? keyword.convert : {}) : null
  const unableConvert = isConvert ? unableConvertSlots(convert) : []
  if (isConvert) {
    if (unableConvert.length) {
      unmapped.push(
        `转模槽位 ${unableConvert.map((id) => CONVERT_SLOT_LABELS[id]).join(' / ')} 标了「${UNABLE}」（补齐后重试）`,
      )
    }
    const ratio = Number(convert?.convertRatio)
    if (!Number.isFinite(ratio)) unmapped.push('转模「折算比例」不是数字')
    steps.push(
      `动作=转化（转模）→ kind=convert / value≡0 / 读取属性=${convert?.convertFrom ?? UNABLE}` +
        ` / 取哪一层=${convert?.convertPanelSource ?? 'external'} / 折算比例=${convert?.convertRatio ?? UNABLE}` +
        ` / 上限=${convert?.convertCap ?? '不限'} / 基础值=${convert?.convertBase ?? '未填'}`,
    )
    if (Number.isFinite(Number(convert?.convertRatio))) {
      // 校验比例是数字（转模比例是「百分比」，如 150 = 150%）
      notices.push(`转模比例按百分数入库：${convert.convertRatio}`)
    }
  }

  // —— 增伤 / 易伤家族 + 动作=降低 → 取负号（易伤区里是减项；增伤同理为负向）
  const negativeVulnerable = action === '降低' && (VULNERABLE_STATS.has(stat) || stat === 'dmgBonus')
  const effectValue = negativeVulnerable && Number.isFinite(value) ? -Math.abs(value) : value
  if (negativeVulnerable) {
    steps.push(`动作=降低 + ${STAT_LABELS[stat] ?? stat} → 取负号 ${effectValue}（加算区里的减项）`)
  }

  // —— 层数 → kind / valuePerStack / maxStacks（转模条恒为 `convert`，层数只进 note）
  const stackMax = Number(keyword.stackMax)
  let kind = isConvert ? 'convert' : 'fixed'
  let maxStacks = 1
  let valuePerStack = 0
  const stacked = !isConvert && stacks !== NONE && (Number.isFinite(stackMax) ? stackMax > 0 : /层/.test(stacks))
  if (stacked) {
    kind = 'stacked'
    maxStacks = Number.isFinite(stackMax) && stackMax > 0 ? stackMax : 1
    valuePerStack = effectValue
    steps.push(
      `数值=${slots.value} + 单位=${unit || NONE} + 层数=${stacks} → kind=stacked / valuePerStack=${valuePerStack} / maxStacks=${maxStacks} / defaultStacks=1`,
    )
    if (!(Number.isFinite(stackMax) && stackMax > 0)) {
      unmapped.push(`层数「${stacks}」读不出上限（maxStacks 暂按 1），请补齐`)
    }
  } else if (!isConvert) {
    steps.push(`层数=${NONE} → kind=fixed`)
  } else if (stacks !== NONE) {
    steps.push(`层数=${stacks} → 转模条只进 note（kind 恒为 convert）`)
  }

  // —— 时长：**不转化**，只进 note（规格 §三）
  if (duration && duration !== NONE) {
    steps.push(`时长=${duration} → 不转化，只进 note（后续再议）`)
  }

  // —— 对象：阶段2 不做转模自动判定（留空，界面可手改）
  if (object === '当前招式') {
    steps.push('对象=当前招式 → 阶段2 不做按招式锚点生效（skillTargets 留空），只进 note')
  } else if (object === '能量') {
    steps.push('对象=能量 → 按能量回复口径（energyRegenFlat）')
  }

  const convertNote = isConvert
    ? `转模：读取属性=${CONVERT_FROM_LABELS[convert?.convertFrom] ?? convert?.convertFrom ?? UNABLE} 折算比例=${convert?.convertRatio ?? UNABLE}`
    : ''
  const noteParts = [
    String(keyword.rawText ?? '').trim(),
    ...conditionTexts,
    duration && duration !== NONE ? duration : '',
    object === '当前招式' ? `对象=${object}` : '',
    convertNote,
  ]
  const note = noteParts
    .filter(Boolean)
    .reduce((acc, part) => {
      if (!acc) return part
      if (acc.includes(part)) return acc
      return `${acc}，${part}`
    }, '')

  const ok = unmapped.length === 0 && Boolean(stat)
  const effect = ok
    ? {
        id: String(keyword.id ?? ''),
        origin: String(keyword.origin ?? ''),
        scope: 'general',
        applyTarget,
        applySituation,
        applyProfession: null,
        teamProfession: null,
        teamProfessionValues: null,
        teamProfessionMinCount: null,
        elementFilter,
        kind,
        stat,
        statLabel: STAT_LABELS[stat] ?? stat,
        value: isConvert ? 0 : effectValue,
        stackable: false,
        maxStacks,
        valuePerStack,
        defaultStacks: 1,
        appliesToAnomaly: undefined,
        enabledDefault: true,
        note,
        // 招式限定 = 条件（锚点关联到既有招式小类 / 大类）
        skillCategory: anchors?.skillCategory || undefined,
        skillSubcategoryId: anchors?.skillSubcategoryId ?? (skillTargets.length === 1 ? null : undefined),
        skillTargets: skillTargets.length ? skillTargets.map((item) => ({ ...item })) : undefined,
        // 转模（动作=转化）：字段对齐 `normalizeConvert`
        convert: isConvert
          ? {
              from: convert?.convertFrom,
              panelSource: convert?.convertPanelSource ?? 'external',
              ratioPercent: Number(convert?.convertRatio),
              cap: convert?.convertCap ?? null,
              defaultBase: convert?.convertBase ?? null,
              initialBase: 0,
            }
          : undefined,
        keywords: {
          slots: { ...slots, conditions: [...conditions] },
          convert: isConvert ? { ...convert } : null,
          stackMax: Number.isFinite(stackMax) ? stackMax : null,
          durationSeconds: Number.isFinite(Number(keyword.durationSeconds))
            ? Number(keyword.durationSeconds)
            : null,
        },
      }
    : null

  return {
    ok,
    blocked: false,
    unableSlots: [...unableSlots, ...unableConvert],
    unmapped,
    steps,
    stat,
    statLabel: STAT_LABELS[stat] ?? '',
    effect,
    reason: ok ? '' : unmapped.join('；'),
  }
}

// ================================================================== 原文项组装

/** 一条关键字效果 → 层C（阶段2 结果挂上去；`不录` 的条目照旧显示原因） */
function decorateEffect(effect, rawText) {
  const parsed = mapKeywordsToEffect({
    slots: effect.slots,
    convert: effect.convert,
    stackMax: effect.stackMax,
    durationSeconds: effect.durationSeconds,
    anchors: effect.anchors,
    id: effect.id,
    origin: effect.origin,
    rawText,
  })
  return {
    ...effect,
    unableSlots: parsed.unableSlots,
    blocked: parsed.blocked,
    layerC: parsed.effect,
    mapping: {
      ok: parsed.ok,
      blocked: parsed.blocked,
      steps: parsed.steps,
      unmapped: parsed.unmapped,
      reason: parsed.reason ?? '',
    },
  }
}

/**
 * 一段原文（阶段1 的公开入口）：原文 → 关键字效果（层B/C）+ 废原文。
 * `化简` 按钮、`buildItem`、单测都走这里，保证同源。
 */
export function simplifyText({ text, origin = '', selfNames = [], anchors = null, agentId = '' } = {}) {
  const rawText = cleanNanokaText(text)
  if (!rawText) return { rawText: '', effects: [], waste: [] }
  const { effects, waste } = extractKeywordEffects({
    text: rawText,
    origin,
    selfNames,
    anchors,
    agentId,
  })
  return { rawText, effects: effects.map((effect) => decorateEffect(effect, effect.sentence)), waste }
}

/**
 * 组装一个「原文项」：落点 + 原文 + **关键字效果（层B→层C）** + **废原文**清单。
 *
 * v3：`waste` 是**整条丢弃**（不入库、确认写入后丢弃，只在阶段一底部展示原因）；
 * 与槽位级 `无法提取` 严格区分。
 */
function buildItem({
  slot,
  slotLabel,
  containerIndex,
  source,
  title,
  text,
  origin,
  selfNames,
  landing,
  anchors,
  agentId,
  skillDesc,
}) {
  const simplified = simplifyText({ text, origin, selfNames, anchors, agentId })
  const rawText = simplified.rawText
  if (!rawText) return null
  const decorated = simplified.effects
  const waste = simplified.waste
  const recordable = decorated.filter((effect) => effect.recorded)
  return {
    slot,
    slotLabel,
    containerIndex,
    source,
    title: title ? cleanNanokaText(title) : '',
    rawText,
    numbers: extractNumbers(rawText).map((item) => item.value),
    effects: decorated,
    /** 废原文：不入库；阶段二确认写入后丢弃 */
    waste,
    landing: landing ?? null,
    /** 招式文本专用：原文 + 关键字还要写进该技能的「描述」字段（`calculator_skills.note`） */
    skillDesc: skillDesc ?? null,
    verdict: recordable.length ? 'buff' : 'waste',
    verdictReason: recordable.length
      ? ''
      : decorated.length
        ? decorated[0]?.dropReason || '招式锚点关联不上'
        : waste[0]?.reason ?? '没抓到可量的增益（机制句）',
  }
}

/** 取满级那条核心被动 / 额外能力（数值随被动等级爬） */
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
 * 角色详情 → 原文项（层A）+ 关键字效果（层B/C）（**纯函数，不联网**）。
 *
 * 落点（v3）：
 *   - 核心被动 / 额外能力 → `mindscapeBuffs[0]`（**复用该槽位已有的块**，不管块名）
 *   - 影画 1–6            → `mindscapeBuffs[i]`
 *   - 招式文本            → **角色增益块**（槽位 0，与核心被动同槽）+ **该技能的「描述」字段**；
 *     文本里限定的招式只进「条件」（锚点 `skillTargets` / `skillSubcategoryId`）。
 *
 * @param {object} options
 * @param {object} options.detail nanoka 角色详情 JSON
 * @param {string|number} [options.nanokaId]
 * @param {Array<object>|null} [options.anchors] 技能库小类（锚点）
 */
export function extractAgentBuffItems({ detail, nanokaId, anchors = null } = {}) {
  if (!isPlainObject(detail)) throw new Error('缺少角色详情 JSON')
  const id = nanokaId === null || nanokaId === undefined ? '' : String(nanokaId)
  const name = cleanNanokaText(detail.name)
  const selfNames = [name, cleanNanokaText(detail.code_name)].filter(Boolean)
  const items = []
  const slot0Landing = {
    container: 'mindscapeBuffs',
    index: 0,
    label: 'mindscapeBuffs[0]（核心被动 / 额外能力）',
  }

  // 来源 2：核心被动 + 额外能力（取满级）→ mindscapeBuffs[0]（复用该槽位已有的块）
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
      anchors,
      agentId: id,
      landing: { ...slot0Landing, blockHint: '核心被动' },
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
      anchors,
      agentId: id,
      landing: { ...slot0Landing, blockHint: '额外能力' },
    })
    if (extra) items.push(extra)
  }

  // 来源 3：影画 1–6 → mindscapeBuffs[i]
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
      anchors,
      agentId: id,
      landing: {
        container: 'mindscapeBuffs',
        index: rank,
        label: `mindscapeBuffs[${rank}]（影画 ${rank}）`,
      },
    })
    if (item) items.push(item)
  })

  // 来源 1：招式文本 → 角色增益块（槽位 0）+ 该技能「描述」字段
  const skill = isPlainObject(detail.skill) ? detail.skill : {}
  for (const [key, label] of Object.entries(SKILL_SLOT_LABELS)) {
    const block = skill[key]
    if (!isPlainObject(block)) continue
    const descriptions = Array.isArray(block.description) ? block.description : []
    descriptions.forEach((entry, index) => {
      if (!isPlainObject(entry)) return
      const text = entry.desc ?? entry.description ?? ''
      const skillName = cleanNanokaText(entry.name ?? label)
      const item = buildItem({
        slot: `skill-${key}-${index}`,
        slotLabel: `招式文本（${label}）`,
        containerIndex: 0,
        source: `skill.${key}.${index}`,
        title: skillName,
        text,
        origin: `nanoka:${id}:skill:${key}.${index}`,
        selfNames,
        anchors,
        agentId: id,
        landing: { ...slot0Landing, blockHint: '核心被动' },
        skillDesc: { agentId: id, skillName, category: key },
      })
      if (item) items.push(item)
    })
  }

  return { kind: 'agent', nanokaId: id, name, items }
}

/**
 * 音擎详情 → 原文项 + 关键字效果（**纯函数，不联网**）。
 *
 * 落点：基础效果（`talents[0]`）→ `fixedBuffs`；精炼 j（`j>=1`）→ `refinementBuffs[j-1]`。
 */
export function extractWengineBuffItems({ detail, nanokaId, anchors = null } = {}) {
  if (!isPlainObject(detail)) throw new Error('缺少音擎详情 JSON')
  const id = nanokaId === null || nanokaId === undefined ? '' : String(nanokaId)
  const name = cleanNanokaText(detail.name)
  const selfNames = ['装备者', name].filter(Boolean)
  const talents = isPlainObject(detail.talents) ? detail.talents : {}
  const items = []

  // 基础说明（不随精炼变）：`talents[0]`；没有该键时退回顶层 `desc2`
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
    anchors,
    agentId: '',
    landing: { container: 'fixedBuffs', index: null, label: 'fixedBuffs（基础效果）' },
  })
  if (baseItem && (baseItem.effects.length || talents['0']?.desc)) items.push(baseItem)

  // 精炼 1–5 → refinementBuffs[0..4]
  for (let level = 1; level <= 5; level += 1) {
    const talent = talents[String(level)]
    if (!isPlainObject(talent)) continue
    const item = buildItem({
      slot: `refinement-${level}`,
      slotLabel: `精炼 ${level}`,
      containerIndex: level - 1,
      source: `weapons.talents.${level}`,
      title: talent.name ?? '',
      text: talent.desc ?? '',
      origin: `nanoka:${id}:refinement:${level}`,
      selfNames,
      anchors,
      agentId: '',
      landing: {
        container: 'refinementBuffs',
        index: level - 1,
        label: `refinementBuffs[${level - 1}]（精炼 ${level}）`,
      },
    })
    if (item) items.push(item)
  }

  return { kind: 'wengine', nanokaId: id, name, items }
}

/**
 * 阶段2 的「解析」入口（纯函数）：把（界面里编辑过的）关键字重跑阶段2，拿到层C。
 * **不联网、不写库、不重新理解人话**（v2 规格 §六：不做「改人话→再理解一次」）。
 */
export function mapEditedKeywords({ effects, kind, nanokaId, origin, anchors } = {}) {
  const list = Array.isArray(effects) ? effects : []
  const id = nanokaId === null || nanokaId === undefined ? '' : String(nanokaId)
  const useOrigin = String(origin ?? '').trim() || `nanoka:${id || 'manual'}:manual`
  void kind
  return list.map((raw, index) => {
    const slots = isPlainObject(raw?.slots) ? raw.slots : {}
    const anchorsPayload = isPlainObject(raw?.anchors)
      ? raw.anchors
      : isPlainObject(anchors)
        ? anchors
        : null
    const mapped = mapKeywordsToEffect({
      slots,
      convert: raw?.convert,
      stackMax: raw?.stackMax,
      durationSeconds: raw?.durationSeconds,
      anchors: anchorsPayload,
      id: String(raw?.id ?? `${useOrigin}#${index}`),
      origin: String(raw?.origin ?? useOrigin),
      rawText: String(raw?.rawText ?? raw?.sentence ?? ''),
    })
    return {
      id: String(raw?.id ?? `${useOrigin}#${index}`),
      origin: String(raw?.origin ?? useOrigin),
      slots,
      convert: isPlainObject(raw?.convert) ? raw.convert : null,
      stackMax: raw?.stackMax ?? null,
      durationSeconds: raw?.durationSeconds ?? null,
      anchors: anchorsPayload,
      unableSlots: mapped.unableSlots,
      blocked: mapped.blocked,
      layerC: mapped.effect,
      mapping: {
        ok: mapped.ok,
        blocked: mapped.blocked,
        steps: mapped.steps,
        unmapped: mapped.unmapped,
        reason: mapped.reason ?? '',
      },
    }
  })
}

// ================================================================== 界面用的槽位视图（v3 显示规则）

/**
 * 关键字行要显示的槽位（v3 变更 1）：**只显示有值的槽位**；
 * `无` 默认隐藏，`详情` 展开全部 9 槽位；`无法提取` 用 ⚠X 表示（不铺开）。
 *
 * @returns {{ visible:Array<{id:string,label:string,value:any,source:string,unable:boolean}>,
 *   hidden:Array<{id:string,label:string,value:any}>, unable:Array<{id:string,label:string}> }}
 */
export function slotView(slots = {}, { expandAll = false } = {}) {
  const visible = []
  const hidden = []
  const unable = []
  for (const id of SLOT_IDS) {
    const value = slots?.[id]
    const entry = { id, label: SLOT_LABELS[id], value, source: '' }
    if (isUnable(value)) {
      unable.push({ id, label: SLOT_LABELS[id] })
      continue
    }
    if (isEmptySlot(value)) {
      hidden.push(entry)
      continue
    }
    visible.push(entry)
  }
  return { visible, hidden, unable, expandAll: Boolean(expandAll) }
}

