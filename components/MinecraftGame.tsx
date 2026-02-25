"use client";

import { useState } from "react";
import Hud from "@/components/game/Hud";
import Hotbar from "@/components/game/Hotbar";
import InventoryPanel from "@/components/game/InventoryPanel";
import RespawnOverlay from "@/components/game/RespawnOverlay";
import { useMinecraftGame } from "@/lib/game/useMinecraftGame";

export default function MinecraftGame() {
  const game = useMinecraftGame();
  const [hudMenuOpen, setHudMenuOpen] = useState(false);
  const [hudHidden, setHudHidden] = useState(false);

  return (
    <div className="game-root">
      <div ref={game.mountRef} className="game-canvas-wrap" />

      {!hudHidden ? (
        <Hud
          locked={game.locked}
          passiveCount={game.passiveCount}
          hostileCount={game.hostileCount}
          daylightPercent={game.daylightPercent}
          selectedSlotData={game.selectedSlotData}
          saveMessage={game.saveMessage}
          onSave={game.saveNow}
          onLoad={game.loadNow}
          onReset={game.resetNow}
        />
      ) : null}

      <button className="hud-menu-toggle" onClick={() => setHudMenuOpen((v) => !v)}>
        •••
      </button>
      {hudMenuOpen ? (
        <div className="hud-menu-panel">
          <button className="hud-menu-btn" onClick={() => setHudHidden((v) => !v)}>
            {hudHidden ? "Show Top-Left Info" : "Hide Top-Left Info"}
          </button>
          <button className="hud-menu-btn" onClick={() => setHudMenuOpen(false)}>
            Close
          </button>
        </div>
      ) : null}

      <Hotbar
        inventory={game.inventory}
        selectedSlot={game.selectedSlot}
        hotbarSlots={game.hotbarSlots}
        hearts={game.hearts}
        maxHearts={game.maxHearts}
        energy={game.energy}
        maxEnergy={game.maxEnergy}
        onSelectSlot={game.setSelectedSlot}
      />

      {game.inventoryOpen ? (
        <InventoryPanel
          inventory={game.inventory}
          equippedArmor={game.equippedArmor}
          selectedHotbarSlot={game.selectedSlot}
          hotbarSlots={game.hotbarSlots}
          recipes={game.recipes}
          canCraft={game.canCraft}
          onSwapSlots={game.swapInventorySlots}
          onToggleEquipArmor={game.toggleEquipArmor}
          onCraft={game.craft}
        />
      ) : null}

      <RespawnOverlay seconds={game.respawnSeconds} />

      <div className="crosshair" />
      <div className={game.capsActive ? "caps-indicator on" : "caps-indicator"}>CapsLock {game.capsActive ? "ON (Sprint Enabled)" : "OFF"}</div>
    </div>
  );
}
