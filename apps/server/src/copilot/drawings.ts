import type { Drawing } from '@aurum/shared';

const MAX_DRAWINGS = 50;

/** Copilot chart annotations (in memory; they are ephemeral by design). */
export class DrawingStore {
  private list: Drawing[] = [];

  all(): readonly Drawing[] {
    return this.list;
  }

  add(drawing: Drawing): void {
    this.list = [...this.list.filter((d) => d.id !== drawing.id), drawing].slice(-MAX_DRAWINGS);
  }

  remove(id: string): boolean {
    const before = this.list.length;
    this.list = this.list.filter((d) => d.id !== id);
    return this.list.length !== before;
  }

  clear(): void {
    this.list = [];
  }
}
