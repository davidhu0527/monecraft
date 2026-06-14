type VictoryScreenProps = {
  show: boolean;
  onDismiss: () => void;
};

/** One-shot win screen after the boss falls: gold-tinted overlay, title, continue. */
export default function VictoryScreen({ show, onDismiss }: VictoryScreenProps) {
  if (!show) return null;

  return (
    <div className="victory-overlay">
      <div className="victory-content">
        <div className="victory-title">You Win!</div>
        <div className="victory-sub">The Dragon Lord is slain. Claim your Dragon Heart.</div>
        <button className="mc-button" onClick={onDismiss}>
          Continue
        </button>
      </div>
    </div>
  );
}
