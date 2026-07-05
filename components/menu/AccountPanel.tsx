"use client";

import { useEffect, useState } from "react";
import AccountForm from "@/components/menu/AccountForm";
import { authClient, currentUser, onlineUsed, type OnlineUser } from "@/lib/auth/client";

/**
 * The compact account corner used by the invite landing page (/join/<token>):
 * shows who you are online and expands into the sign-in / register form —
 * online play is accounts-only. The main menu no longer embeds it (the welcome
 * gate routes to the dedicated AuthScreen instead). Purely additive to the
 * offline game: with no online features touched, no account ever exists.
 */
type AccountPanelProps = {
  /** Notified after any auth mutation (sign in/up/out) so a parent shell can
   *  react — e.g. accept the pending invite. */
  onAuthChange?: () => void;
};

export default function AccountPanel({ onAuthChange }: AccountPanelProps) {
  const [user, setUser] = useState<OnlineUser | null>(null);
  const [mode, setMode] = useState<"closed" | "signin" | "signup">("closed");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Offline-first: never even ask the server about a session until this
    // browser has used online features once (see lib/auth/client.ts).
    if (onlineUsed()) void currentUser().then(setUser);
  }, []);

  const refresh = async () => {
    setUser(await currentUser());
    onAuthChange?.();
  };
  // Guard against a failed request (no unhandled rejection, a visible error)
  // and against concurrent double-clicks.
  const signOut = async () => {
    setBusy(true);
    setError(null);
    try {
      await authClient().signOut();
      await refresh();
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (mode !== "closed") {
    return (
      <AccountForm
        initialMode={mode}
        onSuccess={() => {
          setMode("closed");
          void refresh();
        }}
        onCancel={() => setMode("closed")}
      />
    );
  }

  return (
    <div className="account-panel">
      {user ? (
        <>
          <span className="account-status">Signed in as {user.name}</span>
          <button type="button" className="mc-button" onClick={signOut} disabled={busy}>
            Sign out
          </button>
          {error && <div className="account-error">{error}</div>}
        </>
      ) : (
        <>
          <span className="account-status">Offline</span>
          <button type="button" className="mc-button" onClick={() => setMode("signin")}>
            Sign in
          </button>
          <button type="button" className="mc-button" onClick={() => setMode("signup")}>
            Create account
          </button>
          {error && <div className="account-error">{error}</div>}
        </>
      )}
    </div>
  );
}
