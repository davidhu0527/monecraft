import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import AdvancementsPanel from "./AdvancementsPanel";
import { ADVANCEMENTS } from "@/lib/game/engine/systems/advancements";

const noop = () => {};

describe("AdvancementsPanel", () => {
  test("defaults to the Advancements tab, marking unlocked vs locked entries", () => {
    render(<AdvancementsPanel stats={[]} unlocked={["getting_wood"]} onClose={noop} />);
    expect(screen.getByText("Getting Wood")).toBeTruthy();
    expect(screen.getByText("Dragon Slayer")).toBeTruthy();
    expect(screen.getByText(`1 / ${ADVANCEMENTS.length} unlocked`)).toBeTruthy();
    expect(screen.getByTestId("adv-getting_wood").className).toContain("is-unlocked");
    expect(screen.getByTestId("adv-diamonds").className).toContain("is-locked");
  });

  test("the Statistics tab lists stat labels with formatted values", () => {
    render(
      <AdvancementsPanel
        stats={[
          { id: "blocks_mined", value: 1234 },
          { id: "play_time", value: 3725 },
          { id: "distance_walked", value: 4096 }
        ]}
        unlocked={[]}
        onClose={noop}
      />
    );
    // The Advancements tab is active first — no stat rows yet.
    expect(screen.queryByText("Blocks Mined")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Statistics" }));
    expect(screen.getByText("Blocks Mined")).toBeTruthy();
    expect(screen.getByText("1,234")).toBeTruthy(); // count, thousands-separated
    expect(screen.getByText("1h 2m")).toBeTruthy(); // duration (3725s)
    expect(screen.getByText("4,096 blocks")).toBeTruthy(); // distance
  });

  test("missing stats render as zero", () => {
    render(<AdvancementsPanel stats={[]} unlocked={[]} onClose={noop} />);
    fireEvent.click(screen.getByRole("button", { name: "Statistics" }));
    expect(screen.getByText("0s")).toBeTruthy(); // play_time
    expect(screen.getAllByText("0").length).toBeGreaterThan(0); // the count stats
  });

  test("Close calls onClose", () => {
    let closed = false;
    render(<AdvancementsPanel stats={[]} unlocked={[]} onClose={() => (closed = true)} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(closed).toBe(true);
  });
});
