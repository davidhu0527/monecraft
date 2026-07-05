"use client";

import MenuScreen from "@/components/menu/MenuScreen";

/**
 * The logged-out root: an explicit choice between the two identity worlds —
 * an online account (sign in; register inside) or local browser profiles with
 * no account at all. Signed-in browsers skip it: the shell's session probe
 * lands them straight on the account home. The captions live OUTSIDE the
 * buttons so the accessible names stay exactly "Sign in" / "Play locally"
 * (the e2e suites and muscle memory both key on them).
 */
type WelcomeScreenProps = {
  onSignIn: () => void;
  onPlayLocally: () => void;
};

export default function WelcomeScreen({ onSignIn, onPlayLocally }: WelcomeScreenProps) {
  return (
    <MenuScreen title="Welcome">
      <button type="button" className="mc-button menu-primary" data-testid="welcome-sign-in" onClick={onSignIn}>
        Sign in
      </button>
      <p className="menu-note">Online worlds, synced profiles and cloud saves — needs a free account.</p>
      <button type="button" className="mc-button menu-primary" data-testid="welcome-play-locally" onClick={onPlayLocally}>
        Play locally
      </button>
      <p className="menu-note">Profiles and worlds stored in this browser — no account needed.</p>
    </MenuScreen>
  );
}
