type BossHealthBarProps = {
  /** Boss HP and player-relative navigation, or null when no boss is alive. */
  boss: { hpPercent: number; bearingDegrees: number; distanceBlocks: number } | null;
};

/** Top-center boss health and navigation HUD shown while the Dragon Lord lives. */
export default function BossHealthBar({ boss }: BossHealthBarProps) {
  if (!boss) return null;

  return (
    <div className="boss-bar" role="status" aria-label={`The Dragon Lord: ${boss.distanceBlocks} blocks away, bearing ${boss.bearingDegrees} degrees`}>
      <div className="boss-bar-heading">
        <div className="boss-bar-name">The Dragon Lord</div>
        <div className="boss-tracker">
          <span className="boss-pointer" style={{ transform: `rotate(${boss.bearingDegrees}deg)` }} aria-hidden="true" />
          <span>{boss.distanceBlocks} blocks</span>
        </div>
      </div>
      <div className="boss-bar-track">
        <div className="boss-bar-fill" style={{ width: `${Math.round(boss.hpPercent * 100)}%` }} />
      </div>
    </div>
  );
}
