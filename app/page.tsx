"use client";

import { useEffect, useState } from "react";
import MinecraftGame from "@/components/MinecraftGame";
import { migrateLegacySave } from "@/lib/game/legacyMigration";
import { createProfile, getActiveProfile, type Profile } from "@/lib/game/profiles";
import { createWorld, worldsForProfile, type WorldMeta } from "@/lib/game/worlds";

/**
 * Temporary single-world shim. It runs the legacy migration, then boots the
 * active profile's most-recent world (creating a default profile/world if
 * none exist). The profile/world selection menus replace this in a later
 * commit; for now the app still drops straight into one world.
 *
 * localStorage is read in an effect (client-only) so SSR never touches it.
 */
export default function HomePage() {
  const [session, setSession] = useState<{ profile: Profile; world: WorldMeta } | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    migrateLegacySave();
    const profile = getActiveProfile() ?? createProfile("Player", "default");
    const world = worldsForProfile(profile.id)[0] ?? createWorld(profile.id, "My World", null);
    // Microtask hop keeps this off the synchronous effect path (cascading-render lint).
    queueMicrotask(() => setSession({ profile, world }));
  }, []);

  if (!session) return <div className="game-root" />;

  return (
    <MinecraftGame
      key={`${session.world.id}:${reloadNonce}`}
      world={session.world}
      profile={session.profile}
      onQuitToWorlds={() => window.location.reload()}
      onReloadWorld={() => setReloadNonce((n) => n + 1)}
    />
  );
}
