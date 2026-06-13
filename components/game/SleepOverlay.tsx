type SleepOverlayProps = {
  sleeping: boolean;
};

/**
 * Fade-to-black while the player sleeps. Rendered always (like DeathScreen) and
 * driven by CSS opacity so the fade animates both ways; pointer events pass
 * through when transparent so it never blocks the HUD.
 */
export default function SleepOverlay({ sleeping }: SleepOverlayProps) {
  return <div className={sleeping ? "sleep-overlay on" : "sleep-overlay"} data-testid="sleep-overlay" />;
}
