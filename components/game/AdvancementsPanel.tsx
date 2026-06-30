"use client";

import { useState } from "react";
import PixelImg from "./PixelImg";
import { itemIconUrl } from "@/lib/ui/sprites";
import { ADVANCEMENTS, ADVANCEMENT_CATEGORY_ORDER, STATS, type StatFormat } from "@/lib/game/engine/systems/advancements";

type AdvancementsPanelProps = {
  /** Live stat counters, pulled on render via the engine's advancementState(). */
  stats: Array<{ id: string; value: number }>;
  /** Ids of the advancements the player has unlocked. */
  unlocked: string[];
  onClose: () => void;
};

type Tab = "advancements" | "statistics";

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "advancements", label: "Advancements" },
  { id: "statistics", label: "Statistics" }
];

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${rest}s`;
  return `${rest}s`;
}

/** Thousands separators without locale dependence (so the display is stable everywhere). */
function groupThousands(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatStat(value: number, format: StatFormat): string {
  if (format === "duration") return formatDuration(value);
  if (format === "distance") return `${groupThousands(value)} blocks`;
  return groupThousands(value);
}

export default function AdvancementsPanel({ stats, unlocked, onClose }: AdvancementsPanelProps) {
  const [tab, setTab] = useState<Tab>("advancements");
  const unlockedSet = new Set(unlocked);
  const statValues = new Map(stats.map((entry) => [entry.id, entry.value]));
  const earned = ADVANCEMENTS.filter((advancement) => unlockedSet.has(advancement.id)).length;

  const groups = ADVANCEMENT_CATEGORY_ORDER.map((category) => ({
    category,
    entries: ADVANCEMENTS.filter((advancement) => advancement.category === category)
  })).filter((group) => group.entries.length > 0);

  return (
    <div className="adv-overlay" role="dialog" aria-modal="true" aria-label="Advancements and statistics">
      <div className="adv-panel">
        <div className="adv-header">
          <div className="adv-tabs">
            {TABS.map((entry) => (
              <button key={entry.id} className="mc-button adv-tab" aria-pressed={tab === entry.id} onClick={() => setTab(entry.id)}>
                {entry.label}
              </button>
            ))}
          </div>
          <button className="mc-button adv-close" onClick={onClose}>
            Close
          </button>
        </div>

        {tab === "advancements" ? (
          <div className="adv-body">
            <div className="adv-progress">
              {earned} / {ADVANCEMENTS.length} unlocked
            </div>
            {groups.map((group) => (
              <div key={group.category} className="adv-group">
                <div className="adv-category">{group.category}</div>
                <div className="adv-grid">
                  {group.entries.map((advancement) => {
                    const isUnlocked = unlockedSet.has(advancement.id);
                    return (
                      <div key={advancement.id} className={`adv-entry${isUnlocked ? " is-unlocked" : " is-locked"}`} data-testid={`adv-${advancement.id}`}>
                        <PixelImg src={itemIconUrl(advancement.icon)} alt="" size={32} aria-hidden />
                        <div className="adv-entry-text">
                          <div className="adv-entry-title">{advancement.title}</div>
                          <div className="adv-entry-desc">{advancement.description}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="adv-body">
            <div className="adv-stats">
              {STATS.map((stat) => (
                <div key={stat.id} className="adv-stat-row">
                  <span className="adv-stat-label">{stat.label}</span>
                  <span className="adv-stat-value">{formatStat(statValues.get(stat.id) ?? 0, stat.format)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
