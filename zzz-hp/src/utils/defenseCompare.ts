import type { BossOption, ChartBossPreview, ChartRoomBuffPreview, HpChartPoint } from '@/api/crisisAssault'
import type { MonsterDetailRecord } from '@/components/history/MonsterDetailStats.vue'
import type { DefenseEnemy, DefenseRoom, DefenseSeason } from '@/types/defense'
import type { BuffInfo, EnemySlot, PhaseData } from '@/types/history'
import { decodeDefenseBossId, isDefenseBossId, type DefenseMonsterCategory } from '@/utils/defenseId'
import {
  buildDefenseRoomHpOptions,
  getDefenseHpOptionKey,
  getLastDefenseFrontier,
  type HpComparison,
} from '@/utils/defenseHp'
import { formatHpDelta, parseHpString } from '@/utils/gameData'

const EMPTY_ENEMY: EnemySlot = {
  label: '',
  subStats: '',
  hp: '',
  altHp: '',
  elements: [],
}

export type DefenseCompareMonsterCategory = Extract<DefenseMonsterCategory, 'elite' | 'boss'>

export function getDefenseMonsterCategory(enemy: DefenseEnemy): DefenseCompareMonsterCategory | null {
  if (enemy.id != null && isDefenseBossId(enemy.id)) {
    try {
      const decoded = decodeDefenseBossId(enemy.id)
      if (decoded.monsterCategory === 'elite' || decoded.monsterCategory === 'boss') {
        return decoded.monsterCategory
      }
    } catch {
      return null
    }
  }

  if (enemy.isBoss) return 'boss'
  return null
}

export function isDefenseEliteOrBoss(enemy: DefenseEnemy): boolean {
  return getDefenseMonsterCategory(enemy) != null
}

function formatSeasonPhaseLabel(season: DefenseSeason) {
  const phaseNum = season.phase.replace(/\D/g, '')
  return `${season.version}第${phaseNum}期`
}

export function getDefaultDefenseHpOptionKey(seasons: DefenseSeason[]): string {
  if (!seasons.length) return ''

  const options = buildDefenseRoomHpOptions(seasons[0]!)
  if (!options.length) return ''

  const lastFrontier = getLastDefenseFrontier(seasons[0]!)
  const lastFrontierOption = lastFrontier
    ? options.find((option) => option.kind === 'frontier' && option.frontierId === lastFrontier.id)
    : null

  return getDefenseHpOptionKey(lastFrontierOption ?? options[0]!)
}

export function findDefenseSeasonIndexFromChartPoint(
  seasons: DefenseSeason[],
  point: HpChartPoint,
): number {
  if (point.version && point.phase) {
    const targetPhase = String(Number(point.phase))
    const byVersionPhase = seasons.findIndex(
      (item) =>
        item.version === point.version &&
        String(Number(item.phase.replace(/\D/g, ''))) === targetPhase,
    )
    if (byVersionPhase >= 0) return byVersionPhase
  }

  return seasons.findIndex((item) => formatSeasonPhaseLabel(item) === point.label)
}

function formatDefenseRoomLabel(roomLabel: string) {
  const digits = roomLabel.match(/\d+/)?.[0]
  return digits ?? roomLabel.replace(/\s+/g, '')
}

export function buildDefenseLastFrontierBossPreviews(season: DefenseSeason): ChartBossPreview[] {
  const lastFrontier = getLastDefenseFrontier(season)
  if (!lastFrontier) return []

  const previewMap = new Map<string, ChartBossPreview>()

  for (const room of lastFrontier.rooms) {
    const roomCode = formatDefenseRoomLabel(room.label)

    for (const battleRoom of room.battleRooms) {
      for (const wave of battleRoom.waves) {
        for (const enemy of wave.enemies) {
          if (getDefenseMonsterCategory(enemy) !== 'boss' || !enemy.name) continue

          const key = `${roomCode}::${enemy.name}`
          const hpValue = enemy.hpValue ?? parseHpString(enemy.hp) ?? 0
          const existing = previewMap.get(key)

          if (!existing || hpValue > (parseHpString(existing.hp) ?? 0)) {
            previewMap.set(key, {
              room: roomCode,
              bossName: enemy.name,
              hp: enemy.hp,
              imageUrl: enemy.imageUrl,
            })
          }
        }
      }
    }
  }

  return [...previewMap.values()].sort((a, b) => {
    const roomDiff = Number(a.room) - Number(b.room)
    if (!Number.isNaN(roomDiff) && roomDiff !== 0) return roomDiff
    return a.room.localeCompare(b.room, 'zh-CN')
  })
}

export function extractDefenseBossList(
  seasons: DefenseSeason[],
  category: DefenseCompareMonsterCategory,
): BossOption[] {
  const bossMap = new Map<string, string | null>()

  for (const season of seasons) {
    for (const frontier of season.frontiers) {
      for (const room of frontier.rooms) {
        for (const battleRoom of room.battleRooms) {
          for (const wave of battleRoom.waves) {
            for (const enemy of wave.enemies) {
              if (!enemy.name || getDefenseMonsterCategory(enemy) !== category) continue
              if (!bossMap.has(enemy.name)) {
                bossMap.set(enemy.name, enemy.imageUrl ?? null)
              }
            }
          }
        }
      }
    }
  }

  return [...bossMap.entries()]
    .map(([boss_name, boss_image]) => ({ boss_name, boss_image }))
    .sort((a, b) => a.boss_name.localeCompare(b.boss_name, 'zh-CN'))
}

function isValidDefenseRoomBuff(buff: { name: string; lines: string[] }) {
  return Boolean(buff.name && buff.name !== '—' && !buff.name.startsWith('Buff '))
}

function toChartRoomBuffPreview(room: DefenseRoom): ChartRoomBuffPreview | undefined {
  if (!isValidDefenseRoomBuff(room.roomBuff)) return undefined

  return {
    room: formatDefenseRoomLabel(room.label),
    name: room.roomBuff.name,
    lines: room.roomBuff.lines.length ? room.roomBuff.lines : [room.roomBuff.name],
    imageUrl: room.roomBuff.imageUrl,
  }
}

export function buildDefenseBossChart(
  seasons: DefenseSeason[],
  bossName: string,
  category: DefenseCompareMonsterCategory,
): HpChartPoint[] {
  const points: HpChartPoint[] = []

  for (const season of seasons) {
    let bestHp: number | null = null
    let bestRoom: DefenseRoom | null = null

    for (const frontier of season.frontiers) {
      for (const room of frontier.rooms) {
        for (const battleRoom of room.battleRooms) {
          for (const wave of battleRoom.waves) {
            for (const enemy of wave.enemies) {
              if (getDefenseMonsterCategory(enemy) !== category || enemy.name !== bossName) continue

              const hp = enemy.hpValue ?? parseHpString(enemy.hp)
              if (hp == null) continue

              if (bestHp == null || hp > bestHp) {
                bestHp = hp
                bestRoom = room
              }
            }
          }
        }
      }
    }

    if (bestHp == null) continue

    const phaseNum = season.phase.replace(/\D/g, '')
    points.push({
      label: formatSeasonPhaseLabel(season),
      dateRange: season.dateRange,
      totalHp: bestHp,
      version: season.version,
      phase: phaseNum,
      roomBuff: bestRoom ? toChartRoomBuffPreview(bestRoom) : undefined,
    })
  }

  return points
}

/** boss_info 基础库为怪物详情行补的字段；`BossInfoRecord` 结构兼容，可直接传入 */
export interface DefenseMonsterDetailBossInfo {
  level?: number | null
  stagger_multiplier?: number | null
  stagger_time?: number | null
}

/**
 * 防卫战怪物详情数据行组装（与危局弹窗同形状，共用 `MonsterDetailStats`）：
 * 血量 / 防御 / 失衡时间 / 弱点 / 抗性取自 `DefenseEnemy`，血量对比由面板按卡片同一口径算好传入；
 * 等级与失衡易伤 `DefenseEnemy` 不带，只能来自 boss_info 基础库（查无记录时为 null ⇒ 对应行不渲染）；
 * 危局专属的基础血量 / 血量系数不填，共享组件里本就不渲染这几行。
 */
export function buildDefenseMonsterDetailRecord(
  enemy: DefenseEnemy,
  hpComparison: HpComparison | null,
  bossInfo: DefenseMonsterDetailBossInfo | null,
): MonsterDetailRecord {
  return {
    boss_name: enemy.name || null,
    hp: enemy.hp || null,
    hp_expansion: hpComparison?.expansion ?? null,
    hp_delta_label: hpComparison ? formatHpDelta(hpComparison.diff) : null,
    level: bossInfo?.level ?? null,
    defense: enemy.defense ?? null,
    stagger_time: enemy.staggerTime ?? bossInfo?.stagger_time ?? null,
    stagger_multiplier: bossInfo?.stagger_multiplier ?? null,
    weakness: enemy.weakness ?? null,
    resistance: enemy.resistance ?? null,
    resistance_high: enemy.resistanceHigh ?? null,
  }
}

export function defenseSeasonsToPhaseData(seasons: DefenseSeason[]): PhaseData[] {
  return seasons.map((season) => {
    const buffs: BuffInfo[] = []

    for (const frontier of season.frontiers) {
      for (const room of frontier.rooms) {
        const roomBuff = room.roomBuff
        if (!isValidDefenseRoomBuff(roomBuff)) continue

        buffs.push({
          name: roomBuff.name,
          icon: '✦',
          imageUrl: roomBuff.imageUrl,
          lines: roomBuff.lines.length ? roomBuff.lines : [roomBuff.name],
        })
      }
    }

    if (!buffs.length) {
      buffs.push({ name: 'Buff 1', icon: '✦', lines: ['暂无 Buff 数据'] })
    }

    return {
      id: season.id,
      version: season.version,
      phase: season.phase,
      dateRange: season.dateRange,
      tid: season.seasonId,
      rawHp: season.rawHp,
      totalHp: season.totalHp,
      buffs: buffs as [BuffInfo, BuffInfo, BuffInfo],
      enemies: [EMPTY_ENEMY, EMPTY_ENEMY, EMPTY_ENEMY],
    }
  })
}
