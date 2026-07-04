"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import AccountPanel from "@/components/menu/AccountPanel";
import { currentUser, markOnlineUsed } from "@/lib/auth/client";
import { acceptInviteToken, resolveInviteToken } from "@/lib/online/onlineClient";

/**
 * The invite-link landing page: resolves the token (so the world's name shows
 * before any sign-in), asks the visitor to sign in or register if they aren't,
 * accepts the membership, and points at the game — where the world now sits in
 * the account's online world list. Deliberately unmagical: joining a friend's
 * world is a short story on one page, not hidden state threading into the shell.
 */
export default function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [state, setState] = useState<
    { phase: "loading" } | { phase: "signin"; worldName: string } | { phase: "joined"; worldName: string } | { phase: "error"; message: string }
  >({ phase: "loading" });
  // Bumped by AccountPanel after a sign-in/up so the effect below retries the
  // accept. The accept lives HERE (not in onAuthChange): the phase flip
  // unmounts the panel, and the effect owns the cancellation story.
  const [authNonce, setAuthNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Landing on an invite IS an online action: without this mark, the shell's
    // offline-first gate would never probe the session after "Open the game"
    // and a freshly signed-in visitor would land back on the local menus.
    markOnlineUsed();
    void (async () => {
      const invite = await resolveInviteToken(token);
      if (!invite) return void (!cancelled && setState({ phase: "error", message: "This invite link is invalid or has expired." }));
      const user = await currentUser();
      if (!user) return void (!cancelled && setState({ phase: "signin", worldName: invite.worldName }));
      const accepted = await acceptInviteToken(token);
      if (!accepted) return void (!cancelled && setState({ phase: "error", message: "This invite could not be accepted (it may be used up)." }));
      if (!cancelled) setState({ phase: "joined", worldName: invite.worldName });
    })();
    return () => {
      cancelled = true;
    };
  }, [token, authNonce]);

  return (
    <main className="menu-screen join-page">
      <div className="net-modal-box">
        {state.phase === "loading" && <p>Checking your invite…</p>}
        {state.phase === "error" && <p>{state.message}</p>}
        {state.phase === "signin" && (
          <>
            <p>
              You&apos;re invited to <strong>{state.worldName}</strong> — sign in to join.
            </p>
            <AccountPanel onAuthChange={() => setAuthNonce((nonce) => nonce + 1)} />
          </>
        )}
        {state.phase === "joined" && (
          <>
            <p>
              You&apos;ve joined <strong>{state.worldName}</strong>!
            </p>
            <p>Open the game and press its card in your online worlds.</p>
          </>
        )}
        <Link className="mc-button" href="/">
          {state.phase === "joined" ? "Open the game" : "Back to the game"}
        </Link>
      </div>
    </main>
  );
}
