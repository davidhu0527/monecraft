import type { InventorySlot } from "@/lib/game/types";

type HudProps = {
  locked: boolean;
  passiveCount: number;
  hostileCount: number;
  daylightPercent: number;
  selectedSlotData?: InventorySlot;
  saveMessage: string;
  onSave: () => void;
  onLoad: () => void;
  onReset: () => void;
};

export default function Hud(props: HudProps) {
  const {
    locked,
    passiveCount,
    hostileCount,
    daylightPercent,
    selectedSlotData,
    saveMessage,
    onSave,
    onLoad,
    onReset
  } = props;

  return (
    <div className="hud">
      <div className="title">Minecraft-ish</div>
      <div className="help">
        <span>{locked ? "Mouse: Look" : "Click to lock mouse"}</span>
        <span>Move: W/S forward-back, A/D strafe</span>
        <span>Sprint: W + CapsLock | Crouch: C | Eat: F</span>
        <span>Energy: Sprint 20 blocks = -1, Walk 60 blocks = -1, Jump 10 times = -1. Eat food to recover.</span>
        <span>Attack: Left click | Mine: Hold left click | Place: Right click or E</span>
        <span>Stone needs pickaxe, Sliver needs Stone, Ruby/Gold need Sliver, Sapphire/Diamond need Ruby pickaxe or higher</span>
        <span>Armor: click armor items in inventory to equip/unequip (only equipped pieces reduce damage)</span>
        <span>Inventory/Crafting: I (swap slots by clicking two slots) | Hotbar: 1..0 | Max Stack: 99</span>
        <span>Emergency Unstuck: U</span>
      </div>
      <div className="stats-line">Passive Mobs: {passiveCount} | Hostile Mobs: {hostileCount}</div>
      <div className="stats-line">Daylight: {daylightPercent}%</div>
      <div className="stats-line">Selected: {selectedSlotData?.label ?? "None"}</div>
      <div className="save-controls">
        <button className="save-btn" onClick={onSave}>
          Save World
        </button>
        <button className="save-btn" onClick={onLoad}>
          Load Save
        </button>
        <button className="save-btn reset-btn" onClick={onReset} style={{ backgroundColor: "#822", marginLeft: "10px" }}>
          Reset World
        </button>
        {saveMessage ? <span className="save-msg">{saveMessage}</span> : null}
      </div>

    </div>
  );
}
