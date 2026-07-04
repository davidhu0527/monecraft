"use client";

import { useEffect, useState } from "react";
import type { NetworkSession, RosterMember } from "@/lib/net/NetworkSession";

/**
 * The online player list (top-right HUD): who's in the world, and — for the
 * world owner only — a Kick button per other player. Rendered above the pause
 * overlay so the owner can free the cursor (Escape) and eject a griefer without
 * leaving the world. Pure state-mirroring, like the other online HUD panels:
 * it re-reads session.roster() whenever a player joins or leaves.
 */
export default function RosterPanel({ session }: { session: NetworkSession }) {
  // Seed from the current roster (the session is already connected at mount);
  // the subscription keeps it live as players join and leave.
  const [members, setMembers] = useState<RosterMember[]>(() => session.roster());

  useEffect(() => session.subscribeRoster(() => setMembers(session.roster())), [session]);

  return (
    <div className="roster-panel" aria-label="Players in this world">
      <div className="roster-title">Players ({members.length})</div>
      <ul className="roster-list">
        {members.map((member) => (
          <li key={member.id} className="roster-row">
            <span className="roster-name">
              {member.name}
              {member.id === session.playerId ? " (you)" : ""}
            </span>
            {session.role === "owner" && member.id !== session.playerId ? (
              <button type="button" className="roster-kick" onClick={() => session.kick(member.id)} aria-label={`Kick ${member.name}`}>
                Kick
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
