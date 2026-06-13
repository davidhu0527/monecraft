import { useState } from "react";
import ItemIcon from "@/components/game/ItemIcon";
import { type TooltipContent, useItemTooltip } from "@/components/game/ItemTooltip";
import PixelImg from "@/components/game/PixelImg";
import { ARMOR_SLOT_LABELS, ARMOR_SLOTS, createSlot } from "@/lib/game/items";
import { itemIconUrl } from "@/lib/ui/sprites";
import type { EquippedArmor, InventorySlot, Recipe } from "@/lib/game/types";

type InventoryPanelProps = {
  inventory: InventorySlot[];
  equippedArmor: EquippedArmor;
  selectedHotbarSlot: number;
  hotbarSlots: number;
  recipes: Recipe[];
  craftingStation: "furnace" | null;
  canCraft: (recipe: Recipe) => boolean;
  onSwapSlots: (fromIndex: number, toIndex: number) => void;
  onToggleEquipArmor: (index: number) => void;
  onCraft: (recipe: Recipe) => void;
};

const STATION_LABELS: Record<NonNullable<Recipe["station"]>, string> = {
  furnace: "Furnace"
};

function slotTooltip(slot: InventorySlot): TooltipContent {
  if (!slot.id || slot.count <= 0) return null;
  if (slot.maxDurability) return { title: slot.label, lines: [`Durability ${slot.durability ?? slot.maxDurability} / ${slot.maxDurability}`] };
  return { title: slot.label };
}

/**
 * The survival inventory: armor column, 27-slot storage grid, hotbar row, and
 * a recipe book where every entry shows ingredient icons and the result.
 * Items move by clicking one slot and then another (click-to-swap); clicking
 * an armor item toggles equipping it instead.
 */
export default function InventoryPanel({
  inventory,
  equippedArmor,
  selectedHotbarSlot,
  hotbarSlots,
  recipes,
  craftingStation,
  canCraft,
  onSwapSlots,
  onToggleEquipArmor,
  onCraft
}: InventoryPanelProps) {
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const { tooltip, bind } = useItemTooltip();

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

  const isEquipped = (slot: InventorySlot) => slot.kind === "armor" && !!slot.id && equippedArmor[slot.armorSlot ?? "helmet"] === slot.id;

  const renderSlot = (slot: InventorySlot, idx: number, extraClass = "") => (
    <button
      key={`inv-slot-${idx}`}
      className={["inv-slot", extraClass, pendingIndex === idx ? "pending" : "", isEquipped(slot) ? "equipped" : ""].filter(Boolean).join(" ")}
      onClick={() => onSlotClick(idx)}
      {...bind(slotTooltip(slot))}
      aria-label={slot.id && slot.count > 0 ? `Slot ${idx + 1}: ${slot.label}` : `Slot ${idx + 1}: empty`}
    >
      <ItemIcon slot={slot} size={32} />
    </button>
  );

  const hotbar = inventory.slice(0, hotbarSlots);
  const storage = inventory.slice(hotbarSlots);

  return (
    <div className="inventory-panel">
      <div className="inventory-columns">
        <div className="inventory-main">
          <div className="inventory-heading">Inventory</div>
          <div className="inventory-upper">
            <div className="armor-column">
              {ARMOR_SLOTS.map((armorSlot) => {
                const equippedId = equippedArmor[armorSlot];
                const equippedIndex = equippedId ? inventory.findIndex((slot) => slot.id === equippedId && slot.count > 0) : -1;
                const equippedItem = equippedIndex >= 0 ? inventory[equippedIndex] : undefined;
                return (
                  <button
                    key={`armor-${armorSlot}`}
                    className={equippedItem ? "inv-slot armor-slot filled" : "inv-slot armor-slot"}
                    onClick={() => equippedIndex >= 0 && onToggleEquipArmor(equippedIndex)}
                    {...bind(equippedItem ? slotTooltip(equippedItem) : { title: `${ARMOR_SLOT_LABELS[armorSlot]} (empty)` })}
                    aria-label={equippedItem ? `${ARMOR_SLOT_LABELS[armorSlot]}: ${equippedItem.label}` : `${ARMOR_SLOT_LABELS[armorSlot]}: empty`}
                  >
                    {equippedItem ? (
                      <ItemIcon slot={equippedItem} size={32} />
                    ) : (
                      <span className="armor-ghost">
                        <PixelImg src={itemIconUrl(armorSlot)} alt="" size={32} aria-hidden />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="inventory-hint">
              Click one slot, then another to move items.
              <br />
              Click armor to equip or unequip it.
            </div>
          </div>
          <div className="inv-grid storage" data-testid="storage-grid">
            {storage.map((slot, offset) => renderSlot(slot, offset + hotbarSlots))}
          </div>
          <div className="inv-grid hotbar-row" data-testid="hotbar-grid">
            {hotbar.map((slot, idx) => renderSlot(slot, idx, idx === selectedHotbarSlot ? "active" : ""))}
          </div>
        </div>

        <div className="recipe-book">
          <div className="inventory-heading">Crafting</div>
          <div className="recipe-list">
            {recipes.map((recipe) => {
              const stationLocked = !!recipe.station && recipe.station !== craftingStation;
              return (
                <button
                  key={recipe.id}
                  className="recipe-entry"
                  onClick={() => onCraft(recipe)}
                  disabled={stationLocked || !canCraft(recipe)}
                  aria-label={recipe.label}
                  {...bind({ title: recipe.label, lines: stationLocked ? [`Requires ${STATION_LABELS[recipe.station!]}`] : undefined })}
                >
                  <span className="recipe-ingredients">
                    {recipe.cost.map((cost) => (
                      <ItemIcon key={`${recipe.id}-${cost.slotId}`} slot={createSlot(cost.slotId, cost.count)} size={24} />
                    ))}
                  </span>
                  <span className="recipe-arrow" aria-hidden>
                    →
                  </span>
                  <ItemIcon slot={createSlot(recipe.result.slotId, recipe.result.count)} size={24} />
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {tooltip}
    </div>
  );
}
