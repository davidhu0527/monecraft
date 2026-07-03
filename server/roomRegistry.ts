import { Room } from "./room";
import type { Persistence } from "./persistence";

/**
 * The rooms this process hosts: loaded on first join, evicted (persist +
 * stop) after sitting empty. MAX_ROOMS bounds memory (~74 MB of world per
 * room); joins beyond it are refused at the door so an overloaded process
 * degrades by rejecting, never by thrashing.
 */

const IDLE_EVICT_MS = 5 * 60 * 1000;

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();
  private readonly loading = new Map<string, Promise<Room | null>>();
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly persistence: Persistence,
    private readonly maxRooms: number,
    private readonly now: () => number = () => Date.now()
  ) {}

  startSweeper(): void {
    this.sweeper ??= setInterval(() => void this.sweepIdle(), 30_000);
  }

  /** The room for a world, loading it from persistence on first use. Null: unknown world or at capacity. */
  async getOrLoad(worldId: string): Promise<Room | null> {
    const existing = this.rooms.get(worldId);
    if (existing) return existing;
    const inFlight = this.loading.get(worldId);
    if (inFlight) return inFlight;
    // Count in-flight loads too: two concurrent loads of different worlds must
    // not both slip past the cap before either registers in `rooms`.
    if (this.rooms.size + this.loading.size >= this.maxRooms) return null;

    const promise = (async (): Promise<Room | null> => {
      const record = await this.persistence.loadWorld(worldId);
      if (!record) return null;
      const room = new Room(record, this.persistence, this.now);
      room.start();
      this.rooms.set(worldId, room);
      return room;
    })().finally(() => this.loading.delete(worldId));
    this.loading.set(worldId, promise);
    return promise;
  }

  /** A currently-loaded room, or null (admin endpoints operate on live rooms only, never load one). */
  getExisting(worldId: string): Room | null {
    return this.rooms.get(worldId) ?? null;
  }

  diagnostics(): Array<ReturnType<Room["diagnostics"]>> {
    return [...this.rooms.values()].map((room) => room.diagnostics());
  }

  async sweepIdle(): Promise<void> {
    for (const [worldId, room] of this.rooms) {
      if (room.playerCount() === 0 && room.emptySinceMs !== null && this.now() - room.emptySinceMs > IDLE_EVICT_MS) {
        this.rooms.delete(worldId);
        await room.shutdown();
      }
    }
  }

  async shutdownAll(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    const rooms = [...this.rooms.values()];
    this.rooms.clear();
    await Promise.all(rooms.map((room) => room.shutdown()));
  }
}
