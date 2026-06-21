"use client";

import { useEffect } from "react";
import ActiveEffects from "@/components/game/ActiveEffects";
import BossHealthBar from "@/components/game/BossHealthBar";
import DeathScreen from "@/components/game/DeathScreen";
import DebugOverlay from "@/components/game/DebugOverlay";
import Hotbar from "@/components/game/Hotbar";
import InventoryPanel from "@/components/game/InventoryPanel";
import PauseMenu from "@/components/game/PauseMenu";
import SleepOverlay from "@/components/game/SleepOverlay";
import StatusBars from "@/components/game/StatusBars";
import VictoryScreen from "@/components/game/VictoryScreen";
import XpBar from "@/components/game/XpBar";
import { ENCHANT_COST_LEVELS } from "@/lib/game/config";
import type { Profile } from "@/lib/game/profiles";
import { useMinecraftGame } from "@/lib/game/useMinecraftGame";
import { takesDamage, usesInventory } from "@/lib/game/gameModes";
import type { WorldMeta } from "@/lib/game/worlds";
import { installUiTiles } from "@/lib/ui/chromeTiles";

type MinecraftGameProps = {
  world: WorldMeta;
  profile: Profile;
  onQuitToWorlds: () => void;
  onReloadWorld: () => void;
};

export default function MinecraftGame({ world, profile, onQuitToWorlds, onReloadWorld }: MinecraftGameProps) {
  const {
    attachMount,
    attachMinimap,
    locked,
    rendererError,
    gameMode,
    difficulty,
    giveCreativeItem,
    setGameMode,
    setDifficulty,
    selectedSlot,
    setSelectedSlot,
    capsActive,
    inventoryOpen,
    inventory,
    equippedArmor,
    armorPoints,
    hearts,
    hunger,
    oxygen,
    daylightPercent,
    passiveCount,
    hostileCount,
    respawnSeconds,
    paused,
    sleeping,
    craftingStation,
    container,
    boss,
    victory,
    activeEffects,
    xpLevel,
    xpProgress,
    debugOpen,
    debug,
    saveMessage,
    audioSettings,
    updateAudioSettings,
    skinId,
    updateSkin,
    hotbarSlots,
    recipes,
    maxHearts,
    maxHunger,
    maxOxygen,
    canCraft,
    craft,
    enchant,
    swapInventorySlots,
    moveStack,
    toggleEquipArmor,
    resumeNow,
    respawnNow,
    dismissVictory,
    saveNow,
    loadNow,
    resetNow,
    quitToWorlds
  } = useMinecraftGame({ world, profile, onQuitToWorlds, onReloadWorld });

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
      <div className="vignette" aria-hidden="true" />

      {debugOpen ? <DebugOverlay debug={debug} passiveCount={passiveCount} hostileCount={hostileCount} daylightPercent={daylightPercent} /> : null}

      {showClickHint ? <div className="click-hint">Double-click to play</div> : null}

      <BossHealthBar boss={boss} />

      <ActiveEffects effects={activeEffects} />

      {saveMessage && !paused ? (
        <div className="hud-toast" role="status">
          {saveMessage}
        </div>
      ) : null}

      <div ref={attachMinimap} className="minimap" data-testid="minimap" />

      <div className="hud-bottom">
        {/* Creative/Spectator take no damage — hide the survival bars; Spectator has no hotbar. */}
        {takesDamage(gameMode) ? (
          <>
            <StatusBars
              hearts={hearts}
              maxHearts={maxHearts}
              hunger={hunger}
              maxHunger={maxHunger}
              armorPoints={armorPoints}
              oxygen={oxygen}
              maxOxygen={maxOxygen}
            />
            <XpBar level={xpLevel} progress={xpProgress} />
          </>
        ) : null}
        {usesInventory(gameMode) ? <Hotbar inventory={inventory} selectedSlot={selectedSlot} hotbarSlots={hotbarSlots} onSelectSlot={setSelectedSlot} /> : null}
      </div>

      {inventoryOpen || paused ? <div className="menu-backdrop" /> : null}

      {inventoryOpen ? (
        <InventoryPanel
          inventory={inventory}
          equippedArmor={equippedArmor}
          selectedHotbarSlot={selectedSlot}
          hotbarSlots={hotbarSlots}
          recipes={recipes}
          craftingStation={craftingStation}
          gameMode={gameMode}
          container={container}
          xpLevel={xpLevel}
          enchantCost={ENCHANT_COST_LEVELS}
          canCraft={canCraft}
          onSwapSlots={swapInventorySlots}
          onMoveStack={moveStack}
          onToggleEquipArmor={toggleEquipArmor}
          onCraft={craft}
          onEnchant={enchant}
          onGiveItem={giveCreativeItem}
        />
      ) : null}

      {paused ? (
        <PauseMenu
          saveMessage={saveMessage}
          audioSettings={audioSettings}
          onAudioSettingsChange={updateAudioSettings}
          gameMode={gameMode}
          onGameModeChange={setGameMode}
          difficulty={difficulty}
          onDifficultyChange={setDifficulty}
          skinId={skinId}
          onSkinChange={updateSkin}
          onBack={resumeNow}
          onSave={saveNow}
          onLoad={loadNow}
          onReset={resetNow}
          onQuitToWorlds={quitToWorlds}
        />
      ) : null}

      <DeathScreen seconds={respawnSeconds} onRespawn={respawnNow} />

      <VictoryScreen show={victory} onDismiss={dismissVictory} />

      <SleepOverlay sleeping={sleeping} />

      <div className="crosshair" />
      <div className={capsActive ? "caps-indicator on" : "caps-indicator"}>CapsLock {capsActive ? "ON (Sprint)" : "OFF"}</div>
    </div>
  );
}
