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
  /**
   * Rooms whose shutdown (and final persist) is still running. They are already
   * out of `rooms` — nobody may join a room that is closing its sockets — but
   * their state is not down yet, so a load must wait rather than read the blob
   * they are about to overwrite.
   */
  private readonly evicting = new Map<string, Promise<void>>();
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
    // Wait out an eviction in progress before reading the row: its final
    // persist is what we would otherwise load a stale copy of. Awaiting FIRST
    // keeps the checks below synchronous, so `loading` still collapses
    // concurrent callers into one load.
    const evicting = this.evicting.get(worldId);
    if (evicting) await evicting;
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
   * Evicts rooms that have sat empty. The room leaves `rooms` and enters
   * `evicting` in the same synchronous step: a join must never reach a room
   * that is closing its sockets, but must also not load a second copy of the
   * world from the blob this shutdown is still writing. Between those two
   * states there is no window — dropping it from `rooms` and only THEN awaiting
   * shutdown is what let a join build a rival room from pre-shutdown state,
   * with two Rooms then writing one row under an UPDATE that has no version
   * guard (last write wins, and the eviction's is usually the older).
   */
  async sweepIdle(): Promise<void> {
    for (const [worldId, room] of this.rooms) {
      if (this.shuttingDown) return; // shutdownAll owns the drain now — don't start new evictions
      if (room.playerCount() === 0 && room.emptySinceMs !== null && this.now() - room.emptySinceMs > IDLE_EVICT_MS) {
        this.rooms.delete(worldId);
        const done = room.shutdown();
        // Waiters only need the shutdown to FINISH — a failed final persist
        // shouldn't reject into a caller that is just trying to load the world
        // afterwards (it still surfaces on the await below).
        this.evicting.set(
          worldId,
          done.catch(() => {}).finally(() => this.evicting.delete(worldId))
        );
        await done;
      }
    }
  }

  /**
   * Terminal drain (the process is exiting). Must catch EVERY room that holds
   * unpersisted state, not just the ones currently in `rooms`:
   *  - a load in flight will `rooms.set` when it resolves, so await `loading`
   *    first and let those rooms land before snapshotting;
   *  - an eviction's final persist may still be running in `evicting`;
   *  - then shut down whatever is now in `rooms`.
   * `shuttingDown` blocks new loads, so these three sets can't grow under us.
   * `allSettled` + logging so one failed persist can't strand the exit.
   */
  async shutdownAll(): Promise<void> {
    this.shuttingDown = true;
    if (this.sweeper) clearInterval(this.sweeper);
    // Drain in-flight loads (which then register in `rooms`) and evictions until
    // both are empty. `shuttingDown` blocks new loads and stops sweepIdle from
    // starting new evictions, so at most a sweep that already began adds one
    // more eviction — the loop catches it and terminates.
    while (this.loading.size > 0 || this.evicting.size > 0) {
      await settleAll([...this.loading.values()], "load");
      await settleAll([...this.evicting.values()], "eviction");
    }
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
