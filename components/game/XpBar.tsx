type XpBarProps = {
  level: number;
  /** Fraction toward the next level, 0–1. */
  progress: number;
};

/**
 * The Minecraft-style experience bar above the hotbar: a green track that fills
 * toward the next level, with the current level number floating over it (hidden
 * at level 0, like Minecraft).
 */
export default function XpBar({ level, progress }: XpBarProps) {
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  return (
    <div className="xp-bar" role="meter" aria-label={`Experience level ${level}`} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="xp-bar-track">
        <div className="xp-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      {level > 0 ? <span className="xp-bar-level">{level}</span> : null}
    </div>
  );
}
