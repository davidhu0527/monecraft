"use client";

import { useEffect, useState } from "react";
import type { NetStatus, NetworkSession } from "@/lib/net/NetworkSession";

/**
 * The online HUD corner: ping while healthy, a banner while degraded, and a
 * modal when the connection is gone (the world keeps rendering underneath —
 * the player leaves through the button, never a dead-end).
 */
export default function ConnectionStatus({ session, onLeave }: { session: NetworkSession; onLeave: () => void }) {
  const [status, setStatus] = useState<NetStatus>(session.status());
  const [rtt, setRtt] = useState(0);

  useEffect(() => {
    const unsubscribe = session.subscribeStatus(setStatus);
    const timer = window.setInterval(() => setRtt(Math.round(session.rttMs())), 1000);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [session]);

  if (status === "closed") {
    return (
      <div className="net-modal" role="alertdialog" aria-label="Disconnected">
        <div className="net-modal-box">
          <p>Disconnected from the server.</p>
          <button type="button" className="mc-button" onClick={onLeave}>
            Back to worlds
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="net-status" aria-live="off">
      {status === "online" ? `${rtt} ms` : status}
    </div>
  );
}
