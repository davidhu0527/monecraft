import { useState } from "react";
import ItemIcon from "@/components/game/ItemIcon";
import { canMaterialRepair, findSacrificeIndex, isAnvilGear, repairMaterialFor, sanitizeCustomName, wouldCombineHelp } from "@/lib/game/anvil";
import { CUSTOM_NAME_MAX_LEN } from "@/lib/game/config";
import { displayName, ITEM_DEF_BY_ID } from "@/lib/game/items";
import type { InventorySlot } from "@/lib/game/types";

type AnvilColumnProps = {
  /** The selected hotbar item to repair/combine/rename (or undefined/empty). */
  item: InventorySlot | undefined;
  /** Full inventory, to detect a combine duplicate and the repair material. */
  inventory: InventorySlot[];
  selectedHotbarSlot: number;
  xpLevel: number;
  combineCost: number;
  repairCost: number;
  renameCost: number;
  onCombine: () => void;
  onRepair: () => void;
  onRename: (name: string) => void;
};

const labelFor = (slotId: string): string => ITEM_DEF_BY_ID[slotId]?.label ?? slotId;

/**
 * The anvil panel (replaces the recipe book while an anvil is open): repair,
 * combine, or rename the selected hotbar gear, each spending XP levels. Mirrors
 * the enchanting panel — it acts on whichever hotbar slot is selected.
 */
export default function AnvilColumn({
  item,
  inventory,
  selectedHotbarSlot,
  xpLevel,
  combineCost,
  repairCost,
  renameCost,
  onCombine,
  onRepair,
  onRename
}: AnvilColumnProps) {
  const gear = isAnvilGear(item);
  // Reset the rename field whenever the targeted item changes — keyed on the saved
  // name too, so swapping in a same-id item with a different name refreshes it.
  const fieldKey = `${selectedHotbarSlot}:${item?.id ?? ""}:${item?.customName ?? ""}`;
  const [nameField, setNameField] = useState({ key: fieldKey, value: item?.customName ?? "" });
  const name = nameField.key === fieldKey ? nameField.value : (item?.customName ?? "");
  const setName = (value: string) => setNameField({ key: fieldKey, value });

  if (!gear || !item) {
    return (
      <div className="anvil-column">
        <div className="inventory-heading">Anvil</div>
        <div className="enchanting-hint">Select a tool, weapon, or armor in the hotbar to repair or rename it.</div>
      </div>
    );
  }

  const max = item.maxDurability ?? 0;
  const durability = item.durability ?? max;

  const sacrificeIndex = findSacrificeIndex(inventory, selectedHotbarSlot);
  const hasDuplicate = sacrificeIndex >= 0;
  const combineHelps = hasDuplicate && wouldCombineHelp(item, inventory[sacrificeIndex]);
  const combineEnabled = combineHelps && xpLevel >= combineCost;
  const combineStatus = !hasDuplicate
    ? `Need a second ${displayName(item)} to combine`
    : !combineHelps
      ? "Already at full durability and enchantments"
      : xpLevel < combineCost
        ? "Not enough XP"
        : `Costs ${combineCost} levels`;

  const material = repairMaterialFor(item);
  const repairable = canMaterialRepair(item, inventory);
  const repairEnabled = repairable && xpLevel >= repairCost;
  const repairStatus = !material
    ? "No repair material for this item"
    : durability >= max
      ? "Already at full durability"
      : !repairable
        ? `Need ${labelFor(material)} to repair`
        : xpLevel < repairCost
          ? "Not enough XP"
          : `Costs ${repairCost} levels`;

  const trimmed = name.trim();
  const renameChanged = trimmed !== (item.customName ?? "");
  const renameEnabled = renameChanged && xpLevel >= renameCost;

  return (
    <div className="anvil-column">
      <div className="inventory-heading">Anvil</div>
      <div className="enchanting-item">
        <ItemIcon slot={item} size={32} />
        <span>{displayName(item)}</span>
      </div>
      <div className="enchanting-cost">
        Durability {durability} / {max} · you have {xpLevel} levels
      </div>
      <div className="anvil-actions">
        <button className="anvil-action" onClick={onCombine} disabled={!combineEnabled} aria-label={`Combine duplicate — ${combineStatus}`}>
          <span className="enchant-name">Combine duplicate</span>
          <span className="enchant-cost">{hasDuplicate ? `${combineCost} lvl` : "—"}</span>
        </button>
        <div className="anvil-status">{combineStatus}</div>
        <button className="anvil-action" onClick={onRepair} disabled={!repairEnabled} aria-label={`Repair with material — ${repairStatus}`}>
          <span className="enchant-name">Repair{material ? ` with ${labelFor(material)}` : ""}</span>
          <span className="enchant-cost">{material ? `${repairCost} lvl` : "—"}</span>
        </button>
        <div className="anvil-status">{repairStatus}</div>
        <label className="anvil-rename-field">
          <span className="enchant-name">Rename</span>
          <input
            type="text"
            value={name}
            maxLength={CUSTOM_NAME_MAX_LEN}
            placeholder={item.label}
            onChange={(e) => setName(e.target.value)}
            aria-label="Custom item name"
          />
        </label>
        <button
          className="anvil-action"
          onClick={() => onRename(sanitizeCustomName(name))}
          disabled={!renameEnabled}
          aria-label={`Apply rename — costs ${renameCost} levels`}
        >
          <span className="enchant-name">{trimmed ? "Apply name" : "Clear name"}</span>
          <span className="enchant-cost">{renameCost} lvl</span>
        </button>
      </div>
    </div>
  );
}
