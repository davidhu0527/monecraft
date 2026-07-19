import { Room } from "./room";
import type { Persistence } from "./persistence";

/**
 * The rooms this process hosts: loaded on first join, evicted (persist +
 * stop) after sitting empty. MAX_ROOMS bounds memory (~40 MB of world per
 * dimension engine — headless engines skip the renderer-only light cache;
 * ~80 MB while a room's nether shard is occupied); joins beyond it are
 * refused at the door so an overloaded process degrades by rejecting, never
 * by thrashing.
 */

const IDLE_EVICT_MS = 5 * 60 * 1000;

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();
  private readonly loading = new Map<string, Promise<Room | null>>();
  private sweeper: ReturnType<typeof setInterval> | null = null;
  /** Set by shutdownAll: no new loads, so the drain there has a fixed set to await. */
  private shuttingDown = false;

  constructor(
    private readonly persistence: Persistence,
    private readonly maxRooms: number,
    private readonly now: () => number = () => Date.now()
  ) {}

  startSweeper(): void {
    this.sweeper ??= setInterval(() => void this.sweepIdle(), 30_000);
  }

  /** The room for a world, loading it from persistence on first use. Null: unknown world, at capacity, or shutting down. */
  async getOrLoad(worldId: string): Promise<Room | null> {
    // Once shutdownAll has started, refuse new loads so its drain awaits a fixed
    // set — a load admitted here could register in `rooms` after the drain
    // snapshotted it and never be persisted before process exit.
    if (this.shuttingDown) return null;
    // A room being evicted stays in `rooms` until its final persist has
    // succeeded (sweepIdle persists BEFORE removing), so a join here simply gets
    // the live room — there is no window to load a stale blob.
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

  /**
   * Evicts rooms that have sat empty. Persist FIRST, while the room is still in
   * `rooms`, and only remove it once that write has SUCCEEDED and the room is
   * still empty. Two properties fall out:
   *  - No stale-reload window: a join during the persist finds the live room in
   *    `rooms` (getOrLoad returns it), never a second copy loaded from a blob
   *    that's mid-write.
   *  - A failed persist keeps the room live and retryable next sweep, rather than
   *    handing a join a stale DB blob (the room's final state was never written).
   */
  async sweepIdle(): Promise<void> {
    for (const [worldId, room] of this.rooms) {
      if (this.shuttingDown) return; // shutdownAll owns the drain now — don't start new evictions
      if (this.isIdleFor(room)) {
        try {
          await room.persist();
        } catch (err) {
          console.error(`room ${worldId} eviction persist failed; keeping it live to retry:`, err);
          continue; // do NOT evict — the world stays joinable from the live room
        }
        // shutdownAll may have started, or a session may have come and gone,
        // during the persist. Re-check the FULL idle condition, not just
        // playerCount: a join-then-leave leaves playerCount at 0 but refreshes
        // emptySinceMs, so the room is no longer past the idle window — and its
        // post-session state postdates the snapshot we just took. Evicting now
        // would drop that state and bypass the idle grace period.
        if (this.shuttingDown) return;
        if (!this.isIdleFor(room)) continue;
        this.rooms.delete(worldId);
        room.stop();
      }
    }
  }

  /** Empty past the idle window — the eviction predicate, evaluated against `now()`. */
  private isIdleFor(room: Room): boolean {
    return room.playerCount() === 0 && room.emptySinceMs !== null && this.now() - room.emptySinceMs > IDLE_EVICT_MS;
  }

  /**
   * Terminal drain (the process is exiting). Awaits in-flight loads first (they
   * register in `rooms` when they resolve), then shuts down every room. Rooms
   * mid-eviction are still in `rooms` (sweepIdle removes them only after a
   * successful persist), so they're covered by the snapshot. `shuttingDown`
   * blocks new loads and stops sweepIdle from completing evictions, so the sets
   * can't grow under us. `allSettled` + logging so one failed persist can't
   * strand the exit.
   */
  async shutdownAll(): Promise<void> {
    this.shuttingDown = true;
    if (this.sweeper) clearInterval(this.sweeper);
    while (this.loading.size > 0) await settleAll([...this.loading.values()], "load");
    const rooms = [...this.rooms.values()];
    this.rooms.clear();
    await settleAll(
      rooms.map((room) => room.shutdown()),
      "shutdown"
    );
  }
}

/** Awaits every promise, logging (not throwing) any rejection so the shutdown drain always completes. */
async function settleAll(promises: Promise<unknown>[], what: string): Promise<void> {
  for (const result of await Promise.allSettled(promises)) {
    if (result.status === "rejected") console.error(`room ${what} failed during shutdown:`, result.reason);
  }
}
