import { Fragment, useState } from "react";
import AnvilColumn from "@/components/game/AnvilColumn";
import CreativeInventoryTab from "@/components/game/CreativeInventoryTab";
import EnchantingColumn from "@/components/game/EnchantingColumn";
import ItemIcon from "@/components/game/ItemIcon";
import { itemTooltipFor, type TooltipContent, useItemTooltip } from "@/components/game/ItemTooltip";
import PixelImg from "@/components/game/PixelImg";
import { CONTAINER_SLOT_BASE } from "@/lib/game/engine/commands";
import { ingredientStatus } from "@/lib/game/inventory";
import { itemSourceHint } from "@/lib/game/itemSources";
import { ARMOR_SLOT_LABELS, ARMOR_SLOTS, createSlot, displayName, ITEM_DEF_BY_ID } from "@/lib/game/items";
import { groupRecipes } from "@/lib/game/recipes";
import { itemIconUrl } from "@/lib/ui/sprites";
import type { GameMode } from "@/lib/game/gameModes";
import type { EnchantmentId, EquippedArmor, InventorySlot, Recipe } from "@/lib/game/types";

type InventoryPanelProps = {
  inventory: InventorySlot[];
  equippedArmor: EquippedArmor;
  selectedHotbarSlot: number;
  hotbarSlots: number;
  recipes: Recipe[];
  craftingStation: "furnace" | "villager" | "brewing" | "enchanting" | "anvil" | null;
  /** Current game mode — Creative swaps the recipe book for the item palette. */
  gameMode: GameMode;
  /** Contents of the open chest, or null when no chest is open. */
  container: InventorySlot[] | null;
  /** Current XP level + per-enchant cost, for the enchanting panel. */
  xpLevel: number;
  enchantCost: number;
  anvilCombineCost: number;
  anvilRepairCost: number;
  anvilRenameCost: number;
  canCraft: (recipe: Recipe) => boolean;
  onSwapSlots: (fromIndex: number, toIndex: number) => void;
  /** Moves a slot across the inventory/chest boundary (chest indices offset by CONTAINER_SLOT_BASE). */
  onMoveStack: (fromIndex: number, toIndex: number) => void;
  onToggleEquipArmor: (index: number) => void;
  onCraft: (recipe: Recipe) => void;
  onEnchant: (id: EnchantmentId) => void;
  onAnvilCombine: () => void;
  onAnvilRepair: () => void;
  onAnvilRename: (name: string) => void;
  /** Pulls a full stack of an item from the Creative palette into the inventory. */
  onGiveItem: (itemId: string) => void;
};

const STATION_LABELS: Record<NonNullable<Recipe["station"]>, string> = {
  furnace: "Furnace",
  villager: "Villager",
  brewing: "Brewing Stand"
};

const labelFor = (slotId: string): string => ITEM_DEF_BY_ID[slotId]?.label ?? slotId;

/**
 * Hover text for a recipe. A craftable recipe just names itself; a station-locked
 * one says which station it needs; an unaffordable one lists each ingredient as
 * have/need and, for every shortfall, a "how to obtain" hint. The detail is what
 * the user can't read from the tiny grayscale icons alone.
 */
function recipeTooltip(recipe: Recipe, inventory: InventorySlot[], locked: boolean, craftable: boolean): TooltipContent {
  if (locked) return { title: labelFor(recipe.result.slotId), lines: [`Requires ${STATION_LABELS[recipe.station!]}`] };
  if (craftable) return { title: recipe.label };

  const status = ingredientStatus(inventory, recipe);
  const lines = status.map((s) => `${labelFor(s.slotId)}  ${s.have} / ${s.need}${s.have < s.need ? ` (need ${s.need - s.have} more)` : " ✓"}`);
  for (const s of status) {
    if (s.have >= s.need) continue;
    const hint = itemSourceHint(s.slotId);
    if (hint) lines.push(`→ ${labelFor(s.slotId)}: ${hint}`);
  }
  return { title: labelFor(recipe.result.slotId), lines };
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
  gameMode,
  container,
  xpLevel,
  enchantCost,
  anvilCombineCost,
  anvilRepairCost,
  anvilRenameCost,
  canCraft,
  onSwapSlots,
  onMoveStack,
  onToggleEquipArmor,
  onCraft,
  onEnchant,
  onAnvilCombine,
  onAnvilRepair,
  onAnvilRename,
  onGiveItem
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
        aria-label={slot.id && slot.count > 0 ? `${name}: ${displayName(slot)}` : `${name}: empty`}
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
    const craftable = !locked && canCraft(recipe);
    return (
      <button
        key={recipe.id}
        className={`recipe-entry${craftable ? "" : " is-disabled"}`}
        // Not the native `disabled` attribute: disabled buttons swallow hover
        // events, so the tooltip explaining what's missing would never appear.
        onClick={() => {
          if (craftable) onCraft(recipe);
        }}
        aria-disabled={!craftable}
        aria-label={recipe.label}
        {...bind(recipeTooltip(recipe, inventory, locked, craftable))}
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
                    aria-label={equippedItem ? `${ARMOR_SLOT_LABELS[armorSlot]}: ${displayName(equippedItem)}` : `${ARMOR_SLOT_LABELS[armorSlot]}: empty`}
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
        ) : craftingStation === "anvil" ? (
          <AnvilColumn
            item={inventory[selectedHotbarSlot]}
            inventory={inventory}
            selectedHotbarSlot={selectedHotbarSlot}
            xpLevel={xpLevel}
            combineCost={anvilCombineCost}
            repairCost={anvilRepairCost}
            renameCost={anvilRenameCost}
            onCombine={onAnvilCombine}
            onRepair={onAnvilRepair}
            onRename={onAnvilRename}
          />
        ) : gameMode === "creative" ? (
          <CreativeInventoryTab onGiveItem={onGiveItem} />
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
