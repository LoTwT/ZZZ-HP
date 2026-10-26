import type { DamageEvent } from '@/types/calculator'
import { TRIGGER_AGENT_AT_CALC } from '@/types/calculator'
import { isLuminousAgent } from '@/utils/remielUtils'

export function resolveEventOwnerAgentId(
  event: DamageEvent,
  mainAgentId: string,
): string {
  const raw = event.ownerAgentId
  if (raw && raw !== TRIGGER_AGENT_AT_CALC) return raw
  return mainAgentId
}

export function formatEventOwnerPrefix(agentName: string): string {
  const name = agentName.trim()
  return name ? `${name} · ` : ''
}

export function isRadianceOwnerValid(
  event: DamageEvent,
  mainAgentId: string,
  agents: Array<{ id: string; element?: string | null }>,
): boolean {
  const ownerId = resolveEventOwnerAgentId(event, mainAgentId)
  const owner = agents.find((item) => item.id === ownerId)
  return isLuminousAgent(owner)
}
