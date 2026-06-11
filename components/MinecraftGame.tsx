"use client";

import { useState } from "react";
import Hud from "@/components/game/Hud";
import Hotbar from "@/components/game/Hotbar";
import InventoryPanel from "@/components/game/InventoryPanel";
import RespawnOverlay from "@/components/game/RespawnOverlay";
import { useMinecraftGame } from "@/lib/game/useMinecraftGame";

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
    hearts,
    hunger,
    daylightPercent,
    passiveCount,
    hostileCount,
    respawnSeconds,
    saveMessage,
    selectedSlotData,
    hotbarSlots,
    recipes,
    maxHearts,
    maxHunger,
    canCraft,
    craft,
    swapInventorySlots,
    toggleEquipArmor,
    saveNow,
    loadNow,
    resetNow
  } = useMinecraftGame();
  const [hudMenuOpen, setHudMenuOpen] = useState(false);
  const [hudHidden, setHudHidden] = useState(false);

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

  return (
    <div className="game-root">
      <div ref={attachMount} className="game-canvas-wrap" />

      {!hudHidden ? (
        <Hud
          locked={locked}
          passiveCount={passiveCount}
          hostileCount={hostileCount}
          daylightPercent={daylightPercent}
          selectedSlotData={selectedSlotData}
          saveMessage={saveMessage}
          onSave={saveNow}
          onLoad={loadNow}
          onReset={resetNow}
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
        inventory={inventory}
        selectedSlot={selectedSlot}
        hotbarSlots={hotbarSlots}
        hearts={hearts}
        maxHearts={maxHearts}
        hunger={hunger}
        maxHunger={maxHunger}
        onSelectSlot={setSelectedSlot}
      />

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

      <RespawnOverlay seconds={respawnSeconds} />

      <div className="crosshair" />
      <div className={capsActive ? "caps-indicator on" : "caps-indicator"}>CapsLock {capsActive ? "ON (Sprint Enabled)" : "OFF"}</div>
    </div>
  );
}
