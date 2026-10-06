import { isTerminalStatus, type Setup } from '@aurum/shared';
import { mergeSetup } from './build';

/**
 * Combines the setups the playbooks just proposed with the active ones:
 * same id → merge (keep identity/progress), otherwise add. Active setups that were not
 * re-proposed stay as they are — the lifecycle decides when they end.
 */
export function reconcileSetups(active: readonly Setup[], proposed: readonly Setup[]): Setup[] {
  const byId = new Map(active.filter((s) => !isTerminalStatus(s.status)).map((s) => [s.id, s] as const));
  for (const candidate of proposed) {
    const existing = byId.get(candidate.id);
    byId.set(candidate.id, existing ? mergeSetup(existing, candidate) : candidate);
  }
  return [...byId.values()];
}
