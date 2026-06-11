type DeathScreenProps = {
  seconds: number;
  onRespawn: () => void;
};

/** The Minecraft death screen: red-tinted overlay, big title, respawn button. */
export default function DeathScreen({ seconds, onRespawn }: DeathScreenProps) {
  if (seconds <= 0) return null;

  return (
    <div className="death-overlay">
      <div className="death-content">
        <div className="death-title">You Died!</div>
        <div className="death-sub">Respawning in {seconds}…</div>
        <button className="mc-button" onClick={onRespawn}>
          Respawn
        </button>
      </div>
    </div>
  );
}
