import { ARMOR_SLOT_LABELS, ARMOR_SLOTS } from "@/lib/game/config";
import { useState } from "react";
import type { EquippedArmor, InventorySlot, Recipe } from "@/lib/game/types";

type InventoryPanelProps = {
  inventory: InventorySlot[];
  equippedArmor: EquippedArmor;
  selectedHotbarSlot: number;
  hotbarSlots: number;
  recipes: Recipe[];
  canCraft: (recipe: Recipe) => boolean;
  onSwapSlots: (fromIndex: number, toIndex: number) => void;
  onToggleEquipArmor: (index: number) => void;
  onCraft: (recipe: Recipe) => void;
};

export default function InventoryPanel({ inventory, equippedArmor, selectedHotbarSlot, hotbarSlots, recipes, canCraft, onSwapSlots, onToggleEquipArmor, onCraft }: InventoryPanelProps) {
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);

  const onSlotClick = (index: number) => {
    const slot = inventory[index];
    if (slot.kind === "armor" && slot.count > 0) {
      onToggleEquipArmor(index);
      setPendingIndex(null);
      return;
    }

    if (pendingIndex === null) {
      setPendingIndex(index);
      return;
    }
    if (pendingIndex === index) {
      setPendingIndex(null);
      return;
    }
    onSwapSlots(pendingIndex, index);
    setPendingIndex(null);
  };

  const hotbar = inventory.slice(0, hotbarSlots);
  const storage = inventory.slice(hotbarSlots);

  return (
    <div className="inventory-panel">
      <div className="inventory-title">Inventory & Crafting</div>
      <div className="inventory-subtitle">Click one slot, then another to move/swap items between hotbar and inventory.</div>
      <div className="inventory-section-title">Hotbar</div>
      <div className="inventory-grid">
        {hotbar.map((slot, idx) => (
          <button
            key={`inv-hotbar-${idx}`}
            className={[
              "inventory-slot",
              idx === selectedHotbarSlot ? "active" : "",
              pendingIndex === idx ? "pending" : "",
              slot.kind === "armor" && slot.id && equippedArmor[slot.armorSlot ?? "helmet"] === slot.id ? "equipped" : ""
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => onSlotClick(idx)}
          >
            <span>{slot.id ? slot.label : "Empty"}</span>
            <span>{slot.maxDurability ? `dur ${slot.durability ?? slot.maxDurability}/${slot.maxDurability}` : ""}</span>
            <span>{slot.count > 0 ? `x${slot.count}` : ""}</span>
          </button>
        ))}
      </div>
      <div className="inventory-section-title">Storage</div>
      <div className="inventory-grid inventory-grid-storage">
        {storage.map((slot, offset) => {
          const idx = offset + hotbarSlots;
          const isEquippedArmor = slot.kind === "armor" && !!slot.id && equippedArmor[slot.armorSlot ?? "helmet"] === slot.id;
          return (
            <button
              key={`inv-storage-${idx}`}
              className={[
                "inventory-slot",
                pendingIndex === idx ? "pending" : "",
                isEquippedArmor ? "equipped" : ""
              ]
              .filter(Boolean)
                .join(" ")}
              onClick={() => onSlotClick(idx)}
            >
              <span>{slot.id ? slot.label : "Empty"}</span>
              <span>{slot.maxDurability ? `dur ${slot.durability ?? slot.maxDurability}/${slot.maxDurability}` : ""}</span>
              <span>{slot.count > 0 ? `x${slot.count}` : ""}</span>
            </button>
          );
        })}
      </div>
      <div className="inventory-section-title">Armor (click armor item to equip/unequip)</div>
      <div className="armor-grid">
        {ARMOR_SLOTS.map((armorSlot) => {
          const equippedId = equippedArmor[armorSlot];
          const equippedItem = equippedId ? inventory.find((slot) => slot.id === equippedId && slot.count > 0) : undefined;
          return (
            <div key={`armor-${armorSlot}`} className={equippedItem ? "armor-slot filled" : "armor-slot"}>
              <span className="armor-slot-name">{ARMOR_SLOT_LABELS[armorSlot]}</span>
              <span className="armor-slot-item">{equippedItem?.label ?? "Empty"}</span>
              <span className="armor-slot-item">{equippedItem?.maxDurability ? `${equippedItem.durability ?? equippedItem.maxDurability}/${equippedItem.maxDurability}` : ""}</span>
            </div>
          );
        })}
      </div>

      <div className="crafting-title">Recipes</div>
      <div className="crafting-list">
        {recipes.map((recipe) => (
          <button key={recipe.id} className="craft-btn" onClick={() => onCraft(recipe)} disabled={!canCraft(recipe)}>
            {recipe.label}
          </button>
        ))}
      </div>
    </div>
  );
}
