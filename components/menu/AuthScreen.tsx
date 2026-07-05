"use client";

import AccountForm from "@/components/menu/AccountForm";
import MenuScreen from "@/components/menu/MenuScreen";

/**
 * The dedicated sign-in / register screen behind the welcome gate's "Sign in".
 * Hosts only the account form (register lives behind its "I need an account"
 * toggle) — local browser profiles are a separate world behind "Play locally",
 * so nothing here can read as "an account is needed to play".
 */
type AuthScreenProps = {
  /** Fired after a successful sign-in/up so the shell re-probes the session. */
  onAuthChange: () => void;
  /** Return to the welcome gate. */
  onBack: () => void;
};

export default function AuthScreen({ onAuthChange, onBack }: AuthScreenProps) {
  return (
    <MenuScreen title="Sign in">
      <p className="menu-note">Online worlds, synced profiles and cloud saves — needs a free account.</p>
      <AccountForm initialMode="signin" onSuccess={onAuthChange} />
      <button type="button" className="mc-button" data-testid="back-to-welcome" onClick={onBack}>
        Back
      </button>
    </MenuScreen>
  );
}
