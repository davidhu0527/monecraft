/**
 * Offline replay of a room's command log — reconstructs the deterministic,
 * player-driven half of a world's state without a live server, for debugging
 * "how did we get here?" from a `/rooms/:id/log` dump:
 *
 *   curl -H "authorization: Bearer $ADMIN_TOKEN" \
 *     http://localhost:8080/rooms/my-world/log > dump.json
 *   bun scripts/replay.ts dump.json
 *
 * It boots a fresh authoritative engine from the dump's seed/world settings,
 * seats every player that appears, and steps tick-by-tick, applying each
 * logged command from its claimed eye pose (exactly as the room did) and each
 * pose anchor. It then prints the resulting player positions, inventory
 * fingerprints, and block-edit count.
 *
 * Caveat: mob/spawn behavior is NOT reproduced — the live room uses an
 * unseeded RNG, so only command-driven state (edits, inventory, movement) is
 * deterministic. That is exactly the state this tool is for.
 */
import { GameEngine } from "@/lib/game/engine/GameEngine";
import type { CommandLogEntry, RoomLogDump } from "@/server/room";

const path = process.argv[2];

async function readDump(): Promise<RoomLogDump> {
  const text = path ? await Bun.file(path).text() : await new Response(Bun.stdin.stream()).text();
  return JSON.parse(text) as RoomLogDump;
}

function inventoryFingerprint(engine: GameEngine, playerId: string): string {
  const player = engine.state.players.get(playerId);
  if (!player) return "(gone)";
  const items = player.inventory.filter((slot) => slot && slot.count > 0).map((slot) => `${slot!.id}×${slot!.count}`);
  return items.length ? items.join(", ") : "(empty)";
}

const dump = await readDump();
console.log(`replaying room ${dump.worldId}: seed=${dump.seed} type=${dump.worldType} diff=${dump.difficulty} hardcore=${dump.hardcore}`);
console.log(`${dump.entries.length} log entries up to tick ${dump.tick}`);

const engine = new GameEngine({
  seed: dump.seed,
  worldType: dump.worldType as never,
  difficulty: dump.difficulty as never,
  hardcore: dump.hardcore,
  authority: "server",
  headless: true,
  bootPlayer: false
});

const playerIds = [...new Set(dump.entries.map((e) => e.playerId))];
for (const id of playerIds) engine.addPlayer({ id });
console.log(`seated ${playerIds.length} player(s): ${playerIds.join(", ")}`);

const entries = [...dump.entries].sort((a, b) => a.tick - b.tick);
if (entries.length === 0) {
  console.log("no entries to replay");
  process.exit(0);
}

const TICK_DT = 0.05;
const applyPose = (entry: CommandLogEntry) => {
  const onGround = engine.state.players.get(entry.playerId)?.onGround ?? true;
  engine.applyRemotePose(entry.playerId, { ...entry.pose, onGround }, TICK_DT);
};

let cursor = 0;
let commandsApplied = 0;
for (let tick = entries[0].tick; tick <= entries[entries.length - 1].tick; tick += 1) {
  engine.step(TICK_DT);
  while (cursor < entries.length && entries[cursor].tick === tick) {
    const entry = entries[cursor++];
    applyPose(entry);
    if ("cmd" in entry) {
      engine.dispatch(entry.cmd, entry.playerId);
      commandsApplied += 1;
    }
  }
}

console.log(`\nreplayed ${commandsApplied} command(s); ${engine.state.blockChanges.changes().length} block edit(s) vs the worldgen baseline`);
for (const id of playerIds) {
  const player = engine.state.players.get(id);
  if (!player) continue;
  const { x, y, z } = player.position;
  console.log(
    `  ${id}: pos=(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}) hearts=${player.hearts} xp=${player.xp} inv=[${inventoryFingerprint(engine, id)}]`
  );
}
