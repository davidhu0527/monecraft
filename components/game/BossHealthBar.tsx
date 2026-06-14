type BossHealthBarProps = {
  /** Boss HP as 0..1, or null when no boss is alive. */
  boss: { hpPercent: number } | null;
};

/** Top-center named health bar shown while the endgame boss is alive. */
export default function BossHealthBar({ boss }: BossHealthBarProps) {
  if (!boss) return null;

  return (
    <div className="boss-bar" role="status" aria-label="Boss health">
      <div className="boss-bar-name">The Dragon Lord</div>
      <div className="boss-bar-track">
        <div className="boss-bar-fill" style={{ width: `${Math.round(boss.hpPercent * 100)}%` }} />
      </div>
    </div>
  );
}
