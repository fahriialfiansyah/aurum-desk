import { isTerminalStatus, type Setup } from '@aurum/shared';

/** Immutable-style holder for active setups and the journal (closed trades). */
export class SetupStore {
  private activeList: Setup[] = [];
  private journalList: Setup[] = [];
  private readonly maxJournal: number;

  constructor(options: { maxJournal?: number } = {}) {
    this.maxJournal = options.maxJournal ?? 2000;
  }

  load(active: readonly Setup[], journal: readonly Setup[]): void {
    this.activeList = active.filter((s) => !isTerminalStatus(s.status));
    this.journalList = [...journal];
  }

  get active(): readonly Setup[] {
    return this.activeList;
  }

  get journal(): readonly Setup[] {
    return this.journalList;
  }

  all(): Setup[] {
    return [...this.activeList, ...this.journalList];
  }

  byId(id: string): Setup | undefined {
    return this.activeList.find((s) => s.id === id) ?? this.journalList.find((s) => s.id === id);
  }

  /** Replaces the active list; terminal setups move to the journal. Returns the setups that changed. */
  replaceActive(next: readonly Setup[]): Setup[] {
    const changed: Setup[] = [];
    const prevById = new Map(this.activeList.map((s) => [s.id, s] as const));
    const stillActive: Setup[] = [];
    for (const s of next) {
      const prev = prevById.get(s.id);
      if (prev !== s) changed.push(s);
      if (isTerminalStatus(s.status)) this.journalList = [s, ...this.journalList.filter((j) => j.id !== s.id)].slice(0, this.maxJournal);
      else stillActive.push(s);
    }
    this.activeList = stillActive;
    return changed;
  }

  /** Setups created on the given UTC day. */
  createdOn(dayIso: string): number {
    const day = dayIso.slice(0, 10);
    return this.all().filter((s) => s.createdAt.slice(0, 10) === day).length;
  }
}
