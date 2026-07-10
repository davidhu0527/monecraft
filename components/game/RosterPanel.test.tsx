import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import RosterPanel from "@/components/game/RosterPanel";
import type { NetworkSession, RosterMember } from "@/lib/net/NetworkSession";

/** A minimal fake session — the panel only reads playerId/role/roster and calls kick. */
function fakeSession(role: "owner" | "member", members: RosterMember[]) {
  const kicked: string[] = [];
  const session = {
    playerId: "me",
    role,
    roster: () => members,
    subscribeRoster: () => () => {},
    kick: (id: string) => kicked.push(id)
  } as unknown as NetworkSession;
  return { session, kicked };
}

const members: RosterMember[] = [
  { id: "me", name: "Alpha", dimension: "overworld" },
  { id: "acct-2", name: "Beta", dimension: "overworld" }
];

describe("RosterPanel", () => {
  test("lists everyone and marks yourself", () => {
    const { session } = fakeSession("member", members);
    render(<RosterPanel session={session} />);
    const panel = screen.getByLabelText("Players in this world");
    expect(panel.textContent).toContain("Players (2)");
    expect(panel.textContent).toContain("Alpha (you)");
    expect(panel.textContent).toContain("Beta");
  });

  test("a member sees no kick buttons", () => {
    const { session } = fakeSession("member", members);
    render(<RosterPanel session={session} />);
    expect(screen.queryByRole("button", { name: /Kick/ })).toBeNull();
  });

  test("an owner can kick another player, but there is no kick button for themselves", () => {
    const { session, kicked } = fakeSession("owner", members);
    render(<RosterPanel session={session} />);
    expect(screen.queryByRole("button", { name: "Kick Alpha" })).toBeNull(); // no self-kick
    const kickBeta = screen.getByRole("button", { name: "Kick Beta" });
    fireEvent.click(kickBeta);
    expect(kicked).toEqual(["acct-2"]);
  });
});
