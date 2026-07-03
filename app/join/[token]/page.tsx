"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ensureSignedIn } from "@/lib/auth/client";
import { acceptInviteToken, resolveInviteToken } from "@/lib/online/onlineClient";

/**
 * The invite-link landing page: resolves the token (so the world's name shows
 * before any sign-in), creates a guest identity if needed, accepts the
 * membership, and points at the game — where the world now sits in the
 * Online Worlds list. Deliberately unmagical: joining a friend's world is a
 * two-click story, not hidden state threading into the shell.
 */
export default function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [state, setState] = useState<{ phase: "loading" } | { phase: "joined"; worldName: string } | { phase: "error"; message: string }>({
    phase: "loading"
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const invite = await resolveInviteToken(token);
      if (!invite) return void (!cancelled && setState({ phase: "error", message: "This invite link is invalid or has expired." }));
      const user = await ensureSignedIn();
      if (!user) return void (!cancelled && setState({ phase: "error", message: "Could not sign you in — try again." }));
      const accepted = await acceptInviteToken(token);
      if (!accepted) return void (!cancelled && setState({ phase: "error", message: "This invite could not be accepted (it may be used up)." }));
      if (!cancelled) setState({ phase: "joined", worldName: invite.worldName });
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <main className="menu-screen join-page">
      <div className="net-modal-box">
        {state.phase === "loading" && <p>Checking your invite…</p>}
        {state.phase === "error" && <p>{state.message}</p>}
        {state.phase === "joined" && (
          <>
            <p>
              You&apos;ve joined <strong>{state.worldName}</strong>!
            </p>
            <p>Open the game and press its card in Online Worlds.</p>
          </>
        )}
        <Link className="mc-button" href="/">
          {state.phase === "joined" ? "Open the game" : "Back to the game"}
        </Link>
      </div>
    </main>
  );
}
