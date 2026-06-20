import { Fragment, useState } from "react";
import EnchantingColumn from "@/components/game/EnchantingColumn";
import ItemIcon from "@/components/game/ItemIcon";
import { itemTooltipFor, useItemTooltip } from "@/components/game/ItemTooltip";
import PixelImg from "@/components/game/PixelImg";
import { CONTAINER_SLOT_BASE } from "@/lib/game/engine/commands";
import { ARMOR_SLOT_LABELS, ARMOR_SLOTS, createSlot } from "@/lib/game/items";
import { groupRecipes } from "@/lib/game/recipes";
import { itemIconUrl } from "@/lib/ui/sprites";
import type { EnchantmentId, EquippedArmor, InventorySlot, Recipe } from "@/lib/game/types";

type InventoryPanelProps = {
  inventory: InventorySlot[];
  equippedArmor: EquippedArmor;
  selectedHotbarSlot: number;
  hotbarSlots: number;
  recipes: Recipe[];
  craftingStation: "furnace" | "villager" | "brewing" | "enchanting" | null;
  /** Contents of the open chest, or null when no chest is open. */
  container: InventorySlot[] | null;
  /** Current XP level + per-enchant cost, for the enchanting panel. */
  xpLevel: number;
  enchantCost: number;
  canCraft: (recipe: Recipe) => boolean;
  onSwapSlots: (fromIndex: number, toIndex: number) => void;
  /** Moves a slot across the inventory/chest boundary (chest indices offset by CONTAINER_SLOT_BASE). */
  onMoveStack: (fromIndex: number, toIndex: number) => void;
  onToggleEquipArmor: (index: number) => void;
  onCraft: (recipe: Recipe) => void;
  onEnchant: (id: EnchantmentId) => void;
};

const STATION_LABELS: Record<NonNullable<Recipe["station"]>, string> = {
  furnace: "Furnace",
  villager: "Villager",
  brewing: "Brewing Stand"
};

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
  container,
  xpLevel,
  enchantCost,
  canCraft,
  onSwapSlots,
  onMoveStack,
  onToggleEquipArmor,
  onCraft,
  onEnchant
}: InventoryPanelProps) {
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const { tooltip, bind } = useItemTooltip();

  // While a chest is open, moves span both grids (chest slots are offset by
  // CONTAINER_SLOT_BASE); otherwise a swap stays within the player inventory.
  const slotAt = (index: number): InventorySlot | undefined => (index >= CONTAINER_SLOT_BASE ? container?.[index - CONTAINER_SLOT_BASE] : inventory[index]);

  const onSlotClick = (index: number) => {
    const slot = slotAt(index);
    if (!slot) return;
    // Clicking armor in the player inventory equips it; chest slots only move.
    if (index < CONTAINER_SLOT_BASE && slot.kind === "armor" && slot.count > 0) {
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
    (container ? onMoveStack : onSwapSlots)(pendingIndex, index);
    setPendingIndex(null);
  };

  const isEquipped = (slot: InventorySlot) => slot.kind === "armor" && !!slot.id && equippedArmor[slot.armorSlot ?? "helmet"] === slot.id;

  const renderSlot = (slot: InventorySlot, idx: number, extraClass = "") => {
    const isChest = idx >= CONTAINER_SLOT_BASE;
    const name = isChest ? `Chest slot ${idx - CONTAINER_SLOT_BASE + 1}` : `Slot ${idx + 1}`;
    return (
      <button
        key={`inv-slot-${idx}`}
        className={["inv-slot", extraClass, pendingIndex === idx ? "pending" : "", isEquipped(slot) ? "equipped" : ""].filter(Boolean).join(" ")}
        onClick={() => onSlotClick(idx)}
        {...bind(itemTooltipFor(slot))}
        aria-label={slot.id && slot.count > 0 ? `${name}: ${slot.label}` : `${name}: empty`}
      >
        <ItemIcon slot={slot} size={32} />
      </button>
    );
  };

  const hotbar = inventory.slice(0, hotbarSlots);
  const storage = inventory.slice(hotbarSlots);

  // A recipe is locked when it needs a station the player isn't using; it can be
  // made right now only when it's both unlocked and affordable. The recipe book
  // groups by category and floats the "make now" recipes to the top of each group.
  const stationLocked = (recipe: Recipe) => !!recipe.station && recipe.station !== craftingStation;
  const canMakeNow = (recipe: Recipe) => !stationLocked(recipe) && canCraft(recipe);
  const recipeGroups = groupRecipes(recipes, canMakeNow);

  const renderRecipe = (recipe: Recipe) => {
    const locked = stationLocked(recipe);
    return (
      <button
        key={recipe.id}
        className="recipe-entry"
        onClick={() => onCraft(recipe)}
        disabled={locked || !canCraft(recipe)}
        aria-label={recipe.label}
        {...bind({ title: recipe.label, lines: locked ? [`Requires ${STATION_LABELS[recipe.station!]}`] : undefined })}
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
  };

  return (
    <div className="inventory-panel">
      <div className="inventory-columns">
        <div className="inventory-main">
          {container ? (
            <div className="chest-section">
              <div className="inventory-heading">Chest</div>
              <div className="inv-grid chest-grid" data-testid="chest-grid">
                {container.map((slot, i) => renderSlot(slot, CONTAINER_SLOT_BASE + i))}
              </div>
            </div>
          ) : null}
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
                    {...bind(equippedItem ? itemTooltipFor(equippedItem) : { title: `${ARMOR_SLOT_LABELS[armorSlot]} (empty)` })}
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

        {craftingStation === "enchanting" ? (
          <EnchantingColumn item={inventory[selectedHotbarSlot]} xpLevel={xpLevel} cost={enchantCost} onEnchant={onEnchant} />
        ) : (
          <div className="recipe-book">
            <div className="inventory-heading">{craftingStation === "villager" ? "Trading" : craftingStation === "brewing" ? "Brewing" : "Crafting"}</div>
            <div className="recipe-list">
              {recipeGroups.map((group) => (
                <Fragment key={group.category}>
                  <div className="recipe-category" role="presentation">
                    {group.category}
                  </div>
                  {group.recipes.map(renderRecipe)}
                </Fragment>
              ))}
            </div>
          </div>
        )}
      </div>
      {tooltip}
    </div>
  );
}
