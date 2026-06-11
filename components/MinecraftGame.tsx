"use client";

import { useEffect } from "react";
import DeathScreen from "@/components/game/DeathScreen";
import DebugOverlay from "@/components/game/DebugOverlay";
import Hotbar from "@/components/game/Hotbar";
import InventoryPanel from "@/components/game/InventoryPanel";
import PauseMenu from "@/components/game/PauseMenu";
import StatusBars from "@/components/game/StatusBars";
import { useMinecraftGame } from "@/lib/game/useMinecraftGame";
import { installUiTiles } from "@/lib/ui/chromeTiles";

export default function MinecraftGame() {
  const {
    attachMount,
    locked,
    rendererError,
    selectedSlot,
    setSelectedSlot,
    capsActive,
    inventoryOpen,
    inventory,
    equippedArmor,
    armorPoints,
    hearts,
    hunger,
    daylightPercent,
    passiveCount,
    hostileCount,
    respawnSeconds,
    paused,
    debugOpen,
    debug,
    saveMessage,
    hotbarSlots,
    recipes,
    maxHearts,
    maxHunger,
    canCraft,
    craft,
    swapInventorySlots,
    toggleEquipArmor,
    resumeNow,
    respawnNow,
    saveNow,
    loadNow,
    resetNow
  } = useMinecraftGame();

  useEffect(() => {
    installUiTiles();
  }, []);

  if (rendererError) {
    return (
      <div className="game-root">
        <div className="renderer-error">
          <h2>Could not start the 3D renderer</h2>
          <p>WebGL appears to be unavailable in this browser ({rendererError}).</p>
          <p>Try enabling hardware acceleration or switching browsers, then reload.</p>
        </div>
      </div>
    );
  }

  const showClickHint = !locked && !paused && !inventoryOpen && respawnSeconds === 0;

  return (
    <div className="game-root">
      <div ref={attachMount} className="game-canvas-wrap" />

      {debugOpen ? <DebugOverlay debug={debug} passiveCount={passiveCount} hostileCount={hostileCount} daylightPercent={daylightPercent} /> : null}

      {showClickHint ? <div className="click-hint">Click to play</div> : null}

      <div className="hud-bottom">
        <StatusBars hearts={hearts} maxHearts={maxHearts} hunger={hunger} maxHunger={maxHunger} armorPoints={armorPoints} />
        <Hotbar inventory={inventory} selectedSlot={selectedSlot} hotbarSlots={hotbarSlots} onSelectSlot={setSelectedSlot} />
      </div>

      {inventoryOpen ? (
        <InventoryPanel
          inventory={inventory}
          equippedArmor={equippedArmor}
          selectedHotbarSlot={selectedSlot}
          hotbarSlots={hotbarSlots}
          recipes={recipes}
          canCraft={canCraft}
          onSwapSlots={swapInventorySlots}
          onToggleEquipArmor={toggleEquipArmor}
          onCraft={craft}
        />
      ) : null}

      {paused ? <PauseMenu saveMessage={saveMessage} onBack={resumeNow} onSave={saveNow} onLoad={loadNow} onReset={resetNow} /> : null}

      <DeathScreen seconds={respawnSeconds} onRespawn={respawnNow} />

      <div className="crosshair" />
      <div className={capsActive ? "caps-indicator on" : "caps-indicator"}>CapsLock {capsActive ? "ON (Sprint)" : "OFF"}</div>
    </div>
  );
}
