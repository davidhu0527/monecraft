"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NetworkSession } from "@/lib/net/NetworkSession";

/**
 * Multiplayer chat: a fading bottom-left log plus an input that opens on
 * T/Enter (releasing pointer lock while typing) and closes on Escape/send.
 * Rendered only for online sessions — single-player has nobody to talk to.
 */

type ChatEntry = { id: number; name: string; text: string; atMs: number };
const LOG_LIMIT = 8;
const FADE_AFTER_MS = 8000;

export default function ChatPanel({ session, locked, onOpenChange }: { session: NetworkSession; locked: boolean; onOpenChange?: (open: boolean) => void }) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  // Render-time clock (the compiler forbids impure reads in render): advanced
  // by the fade interval and on each arrival.
  const [nowMs, setNowMs] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const nextIdRef = useRef(1);

  // Subscribe to incoming chat (the session survives re-renders; effect per session).
  useEffect(() => {
    return session.subscribeChat((entry) => {
      // Mint the id OUTSIDE the updater — setState updaters must stay pure.
      const id = nextIdRef.current;
      nextIdRef.current += 1;
      const item = { id, name: entry.name, text: entry.text, atMs: performance.now() };
      setEntries((current) => [...current, item].slice(-LOG_LIMIT));
      setNowMs(performance.now());
    });
  }, [session]);

  // Entries fade out; advance the render clock at 1 Hz while any are visible.
  useEffect(() => {
    if (entries.length === 0) return;
    const timer = window.setInterval(() => setNowMs(performance.now()), 1000);
    return () => window.clearInterval(timer);
  }, [entries.length]);

  const openChat = useCallback(() => {
    setOpen(true);
    onOpenChange?.(true);
    if (document.pointerLockElement) document.exitPointerLock();
    // Focus after the input exists.
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [onOpenChange]);

  const closeChat = useCallback(() => {
    setOpen(false);
    setDraft("");
    onOpenChange?.(false);
  }, [onOpenChange]);

  // T / Enter opens while playing (not while another overlay owns the keys).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (open) return;
      if (!locked) return; // only from live gameplay — menus own their keys
      if (event.code === "KeyT" || event.code === "Enter") {
        event.preventDefault();
        openChat();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, locked, openChat]);

  const visible = open ? entries : entries.filter((entry) => nowMs - entry.atMs < FADE_AFTER_MS);

  return (
    <div className={open ? "chat-panel open" : "chat-panel"}>
      <ul className="chat-log" aria-live="polite">
        {visible.map((entry) => (
          <li key={entry.id} className="chat-line">
            <span className="chat-name">{entry.name}</span> {entry.text}
          </li>
        ))}
      </ul>
      {open && (
        <form
          className="chat-input-row"
          onSubmit={(event) => {
            event.preventDefault();
            session.sendChat(draft);
            closeChat();
          }}
        >
          <input
            ref={inputRef}
            className="chat-input"
            value={draft}
            maxLength={256}
            placeholder="Say something…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeChat();
              }
              event.stopPropagation(); // typing must not move the player
            }}
          />
        </form>
      )}
    </div>
  );
}
