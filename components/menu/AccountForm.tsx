"use client";

import { useState } from "react";
import { authClient, markOnlineUsed } from "@/lib/auth/client";

/**
 * The email/password sign-in / register form — online play is accounts-only.
 * Shared by the menu's dedicated sign-in screen (AuthScreen) and the invite
 * landing page's AccountPanel; the in-form toggle flips between the modes.
 */
type AccountFormProps = {
  initialMode: "signin" | "signup";
  /** Fired after a successful sign-in / sign-up (a session now exists). */
  onSuccess: () => void;
  /** Renders a Cancel button only when provided. */
  onCancel?: () => void;
};

export default function AccountForm({ initialMode, onSuccess, onCancel }: AccountFormProps) {
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guard against a failed request (no unhandled rejection, a visible error)
  // and against concurrent double-clicks.
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
      setPassword("");
      onSuccess();
    } catch {
      // A thrown request (network failure) instead of an { error } result.
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

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
        <button
          type="button"
          className="mc-button"
          disabled={busy}
          onClick={() => {
            // A mode switch invalidates whatever the previous mode reported.
            setError(null);
            setMode(mode === "signup" ? "signin" : "signup");
          }}
        >
          {mode === "signup" ? "I have an account" : "I need an account"}
        </button>
        {onCancel && (
          <button type="button" className="mc-button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
