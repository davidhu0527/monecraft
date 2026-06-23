import { useState } from "react";

type GameOverScreenProps = {
  show: boolean;
  onQuitToWorlds: () => void;
  onDeleteWorld: () => void;
};

/**
 * Hardcore permadeath screen. Unlike the respawn DeathScreen the run is over: the
 * player already spectates their dead world behind this overlay. "Spectate World"
 * minimizes to a corner badge so they can fly around (the pause menu is blocked in
 * game-over), and the badge re-opens this menu. Delete/Quit hand off to the shell.
 */
export default function GameOverScreen({ show, onQuitToWorlds, onDeleteWorld }: GameOverScreenProps) {
  const [minimized, setMinimized] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (!show) return null;

  if (minimized) {
    return (
      <button className="gameover-badge" onClick={() => setMinimized(false)} aria-label="Open Game Over menu">
        ☠ Game Over
      </button>
    );
  }

  return (
    <div className="gameover-overlay">
      <div className="gameover-content">
        <div className="gameover-title">Game Over</div>
        <div className="gameover-sub">This hardcore world has ended. You may roam it as a spectator.</div>
        <button className="mc-button" onClick={() => setMinimized(true)}>
          Spectate World
        </button>
        <button className="mc-button" onClick={onQuitToWorlds}>
          Back to Worlds
        </button>
        {confirmingDelete ? (
          <div className="gameover-delete-row">
            <button className="mc-button danger" onClick={onDeleteWorld}>
              Confirm Delete
            </button>
            <button className="mc-button" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="mc-button danger" onClick={() => setConfirmingDelete(true)}>
            Delete World
          </button>
        )}
      </div>
    </div>
  );
}
