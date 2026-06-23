import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import XpBar from "./XpBar";

describe("XpBar", () => {
  test("shows the level and fills the track to the progress fraction", () => {
    render(<XpBar level={5} progress={0.4} />);
    expect(screen.getByText("5")).toBeTruthy();
    expect(document.querySelector<HTMLElement>(".xp-bar-fill")?.style.width).toBe("40%");
    expect(screen.getByRole("meter").getAttribute("aria-label")).toContain("level 5");
  });

  test("hides the level number at level 0 but still renders an empty track", () => {
    render(<XpBar level={0} progress={0} />);
    expect(screen.queryByText("0")).toBeNull();
    expect(document.querySelector<HTMLElement>(".xp-bar-fill")?.style.width).toBe("0%");
  });

  test("clamps an out-of-range progress to the track", () => {
    render(<XpBar level={2} progress={1.5} />);
    expect(document.querySelector<HTMLElement>(".xp-bar-fill")?.style.width).toBe("100%");
  });
});
