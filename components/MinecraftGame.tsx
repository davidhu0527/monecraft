"use client";

import { useEffect, useReducer } from "react";
import ActiveEffects from "@/components/game/ActiveEffects";
import BossHealthBar from "@/components/game/BossHealthBar";
import DeathScreen from "@/components/game/DeathScreen";
import DebugOverlay from "@/components/game/DebugOverlay";
import GameOverScreen from "@/components/game/GameOverScreen";
import AdvancementsPanel from "@/components/game/AdvancementsPanel";
import Hotbar from "@/components/game/Hotbar";
import InventoryPanel from "@/components/game/InventoryPanel";
import PauseMenu from "@/components/game/PauseMenu";
import SleepOverlay from "@/components/game/SleepOverlay";
import StatusBars from "@/components/game/StatusBars";
import TouchControls from "@/components/game/TouchControls";
import TreasureCompass from "@/components/game/TreasureCompass";
import VictoryScreen from "@/components/game/VictoryScreen";
import XpBar from "@/components/game/XpBar";
import { ANVIL_COMBINE_COST_LEVELS, ANVIL_RENAME_COST_LEVELS, ANVIL_REPAIR_COST_LEVELS, ENCHANT_COST_LEVELS } from "@/lib/game/config";
import type { Profile } from "@/lib/game/profiles";
import type { SaveData } from "@/lib/game/types";
import { useMinecraftGame } from "@/lib/game/useMinecraftGame";
import { takesDamage, usesInventory } from "@/lib/game/gameModes";
import type { WorldMeta } from "@/lib/game/worlds";
import { installUiTiles } from "@/lib/ui/chromeTiles";
import ChatPanel from "@/components/game/ChatPanel";
import ConnectionStatus from "@/components/game/ConnectionStatus";
import RosterPanel from "@/components/game/RosterPanel";
import type { NetworkSession } from "@/lib/net/NetworkSession";

type MinecraftGameProps = {
  world: WorldMeta;
  profile: Profile;
  /** Preloaded by the shell's WorldSaveGate; null boots a fresh world from seed. */
  initialSave: SaveData | null;
  /** A connected multiplayer session — this world lives on the server. */
  online?: NetworkSession;
  onQuitToWorlds: () => void;
  /** Hardcore Game Over: erase the dead world and return to the world list. */
  onDeleteWorld: () => void;
  onReloadWorld: () => void;
};

export default function MinecraftGame({ world, profile, initialSave, online, onQuitToWorlds, onDeleteWorld, onReloadWorld }: MinecraftGameProps) {
  const {
    attachMount,
    attachMinimap,
    locked,
    rendererError,
    gameMode,
    difficulty,
    hardcore,
    gameOver,
    giveCreativeItem,
    setGameMode,
    setDifficulty,
    selectedSlot,
    setSelectedSlot,
    capsActive,
    inventoryOpen,
    advancementsOpen,
    advancementState,
    toggleAdvancements,
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
    activeVillagerProfession,
    container,
    boss,
    treasure,
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
    anvilCombine,
    anvilRepair,
    anvilRename,
    grindstoneStrip,
    swapInventorySlots,
    moveStack,
    toggleEquipArmor,
    unequipArmor,
    resumeNow,
    respawnNow,
    dismissVictory,
    saveNow,
    loadNow,
    resetNow,
    quitToWorlds,
    touchControls,
    engageControls,
    isFlying,
    pauseNow,
    toggleInventory,
    toggleCameraView,
    clearControlKeys,
    touchMode,
    updateTouchSettings,
    unstuckNow
  } = useMinecraftGame({ world, profile, initialSave, online, onQuitToWorlds, onReloadWorld });

  useEffect(() => {
    installUiTiles();
  }, []);

  // While the advancements overlay is open the live stats keep accruing (play
  // time, distance), but the snapshot only changes on an unlock. Re-render on a
  // light interval *while open* so the Statistics tab stays current — without
  // coupling stat freshness to the hot per-frame snapshot path.
  const [, refreshAdvancements] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!advancementsOpen) return;
    const id = window.setInterval(refreshAdvancements, 400);
    return () => window.clearInterval(id);
  }, [advancementsOpen]);

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

  const showClickHint = !locked && !paused && !inventoryOpen && !advancementsOpen && respawnSeconds === 0;
  const showTouchControls =
    touchControls !== null && locked && !paused && !inventoryOpen && !advancementsOpen && respawnSeconds === 0 && !gameOver && !victory && !sleeping;
  const heldSlot = inventory[selectedSlot];
  const showEat = Boolean(heldSlot && heldSlot.count > 0 && (heldSlot.hunger != null || heldSlot.effect != null));

  return (
    <div className="game-root">
      <div ref={attachMount} className="game-canvas-wrap" />
      <div className="vignette" aria-hidden="true" />

      {debugOpen ? (
        <DebugOverlay debug={debug} passiveCount={passiveCount} hostileCount={hostileCount} daylightPercent={daylightPercent} net={online ?? null} />
      ) : null}

      {showClickHint ? (
        touchControls ? (
          // On touch the hint doubles as the engagement surface: any tap starts play.
          <button type="button" className="touch-tap-area" onPointerDown={engageControls}>
            <span className="click-hint">Tap to play</span>
          </button>
        ) : (
          <div className="click-hint">Double-click to play</div>
        )
      ) : null}

      {showTouchControls ? (
        <TouchControls
          controls={touchControls}
          showEat={showEat}
          isFlying={isFlying}
          onPause={pauseNow}
          onOpenInventory={toggleInventory}
          onToggleCamera={toggleCameraView}
          onDeactivate={clearControlKeys}
        />
      ) : null}

      <BossHealthBar boss={boss} />

      <TreasureCompass treasure={treasure} />

      <ActiveEffects effects={activeEffects} />

      {online && <ChatPanel session={online} locked={locked} />}
      {online && <ConnectionStatus session={online} onLeave={quitToWorlds} />}
      {online && <RosterPanel session={online} />}
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
              hardcore={hardcore}
            />
            <XpBar level={xpLevel} progress={xpProgress} />
          </>
        ) : null}
        {usesInventory(gameMode) ? <Hotbar inventory={inventory} selectedSlot={selectedSlot} hotbarSlots={hotbarSlots} onSelectSlot={setSelectedSlot} /> : null}
      </div>

      {inventoryOpen || advancementsOpen || paused ? <div className="menu-backdrop" /> : null}

      {advancementsOpen ? <AdvancementsPanel {...advancementState()} onClose={toggleAdvancements} /> : null}

      {inventoryOpen ? (
        <InventoryPanel
          inventory={inventory}
          equippedArmor={equippedArmor}
          selectedHotbarSlot={selectedSlot}
          hotbarSlots={hotbarSlots}
          recipes={recipes}
          craftingStation={craftingStation}
          activeVillagerProfession={activeVillagerProfession}
          gameMode={gameMode}
          container={container}
          xpLevel={xpLevel}
          enchantCost={ENCHANT_COST_LEVELS}
          anvilCombineCost={ANVIL_COMBINE_COST_LEVELS}
          anvilRepairCost={ANVIL_REPAIR_COST_LEVELS}
          anvilRenameCost={ANVIL_RENAME_COST_LEVELS}
          canCraft={canCraft}
          onSwapSlots={swapInventorySlots}
          onMoveStack={moveStack}
          onToggleEquipArmor={toggleEquipArmor}
          onUnequipArmor={unequipArmor}
          onCraft={craft}
          onEnchant={enchant}
          onAnvilCombine={anvilCombine}
          onAnvilRepair={anvilRepair}
          onAnvilRename={anvilRename}
          onGrindstoneStrip={grindstoneStrip}
          onGiveItem={giveCreativeItem}
          onClose={toggleInventory}
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
          hardcore={hardcore}
          skinId={skinId}
          onSkinChange={updateSkin}
          touchMode={touchMode}
          onTouchModeChange={(mode) => updateTouchSettings({ mode })}
          touchActive={touchControls !== null}
          onUnstuck={() => {
            unstuckNow();
            resumeNow();
          }}
          onBack={resumeNow}
          onSave={saveNow}
          onLoad={loadNow}
          onReset={resetNow}
          onQuitToWorlds={quitToWorlds}
        />
      ) : null}

      <DeathScreen seconds={respawnSeconds} onRespawn={respawnNow} />

      <VictoryScreen show={victory} onDismiss={dismissVictory} />

      <GameOverScreen show={gameOver} onQuitToWorlds={quitToWorlds} onDeleteWorld={onDeleteWorld} />

      <SleepOverlay sleeping={sleeping} />

      <div className="crosshair" />
      {/* CapsLock is meaningless without a keyboard; sprint lives on the joystick. */}
      {touchControls ? null : <div className={capsActive ? "caps-indicator on" : "caps-indicator"}>CapsLock {capsActive ? "ON (Sprint)" : "OFF"}</div>}
    </div>
  );
}
