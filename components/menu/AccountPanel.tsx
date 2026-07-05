"use client";

import { useEffect, useState } from "react";
import { authClient, currentUser, markOnlineUsed, onlineUsed, type OnlineUser } from "@/lib/auth/client";

/**
 * The account corner of the menu: shows who you are online and hosts the
 * sign-in / register form — online play is accounts-only. Purely additive to
 * the offline game: with no online features touched, no account ever exists.
 */
type AccountPanelProps = {
  /** Notified after any auth mutation (sign in/up/out) so a parent shell can
   *  react — e.g. flip the menu into account mode. */
  onAuthChange?: () => void;
};

export default function AccountPanel({ onAuthChange }: AccountPanelProps) {
  const [user, setUser] = useState<OnlineUser | null>(null);
  const [mode, setMode] = useState<"closed" | "signin" | "signup">("closed");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
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
  // Mirror submit: guard against a failed request (no unhandled rejection, a
  // visible error) and against concurrent double-clicks.
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

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    // This form and the invite landing page are the only places that flip the
    // offline-first flag — nothing else may trigger session probes.
    markOnlineUsed();
    try {
      const result =
        mode === "signup"
          ? await authClient().signUp.email({ email, password, name: name.trim() || email.split("@")[0] })
          : await authClient().signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? "That didn't work — check the details and try again.");
        return;
      }
      setMode("closed");
      setPassword("");
      await refresh();
    } catch {
      // A thrown request (network failure) instead of an { error } result.
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (mode !== "closed") {
    return (
      <form className="menu-form account-panel" onSubmit={submit}>
        <label className="menu-field">
          Email
          <input className="menu-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode === "signup" && (
          <label className="menu-field">
            Display name
            <input className="menu-input" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <label className="menu-field">
          Password
          <input className="menu-input" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="account-error">{error}</div>}
        <div className="menu-form-actions">
          <button type="submit" className="mc-button" disabled={busy}>
            {mode === "signup" ? "Create account" : "Sign in"}
          </button>
          <button type="button" className="mc-button" onClick={() => setMode(mode === "signup" ? "signin" : "signup")}>
            {mode === "signup" ? "I have an account" : "I need an account"}
          </button>
          <button type="button" className="mc-button" onClick={() => setMode("closed")}>
            Cancel
          </button>
        </div>
      </form>
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
          {error && <div className="account-error">{error}</div>}
        </>
      )}
    </div>
  );
}
