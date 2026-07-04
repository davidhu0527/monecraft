"use client";

import { useEffect, useState } from "react";
import { authClient, currentUser, ensureSignedIn, markOnlineUsed, onlineUsed, type OnlineUser } from "@/lib/auth/client";

/**
 * The account corner of the menu: shows who you are online, offers instant
 * guest play, and upgrades a guest to a real account without losing worlds
 * (the server re-parents them — see lib/auth/server.ts). Purely additive to
 * the offline game: with no online features touched, no account ever exists.
 */
export default function AccountPanel() {
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

  const refresh = async () => setUser(await currentUser());
  const signOut = async () => {
    await authClient().signOut();
    await refresh();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    markOnlineUsed();
    // Sign-up (and sign-in) while holding a guest session links the account:
    // the guest's worlds move over server-side before the guest is deleted.
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
            {mode === "signup" ? (user?.isAnonymous ? "Create account (keeps your worlds)" : "Create account") : "Sign in"}
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
          <span className="account-status">{user.isAnonymous ? "Playing as guest" : `Signed in as ${user.name}`}</span>
          {user.isAnonymous ? (
            <>
              <button type="button" className="mc-button" onClick={() => setMode("signup")}>
                Keep my worlds — create account
              </button>
              {/* A guest could previously never get back to the login screen; sign
                  out drops to the "Offline" state where Sign in / register live. */}
              <button type="button" className="mc-button" onClick={signOut}>
                Sign out
              </button>
            </>
          ) : (
            <button type="button" className="mc-button" onClick={signOut}>
              Sign out
            </button>
          )}
        </>
      ) : (
        <>
          <span className="account-status">Offline</span>
          <button
            type="button"
            className="mc-button"
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await ensureSignedIn();
                await refresh();
              } catch {
                setError("Couldn't reach the server — check your connection and try again.");
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
          >
            Play online as guest
          </button>
          <button type="button" className="mc-button" onClick={() => setMode("signin")}>
            Sign in
          </button>
          {error && <div className="account-error">{error}</div>}
        </>
      )}
    </div>
  );
}
