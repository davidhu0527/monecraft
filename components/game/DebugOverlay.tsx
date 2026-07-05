import { useEffect, useState } from "react";
import type { DebugInfo } from "@/lib/game/engine/state";
import type { NetStats, NetworkSession } from "@/lib/net/NetworkSession";

type DebugOverlayProps = {
  debug: DebugInfo | null;
  passiveCount: number;
  hostileCount: number;
  daylightPercent: number;
  /** Online sessions add two connection-stat lines (absent in single-player). */
  net?: NetworkSession | null;
};

/**
 * F3-style debug readout. Position and daylight come from the engine's
 * throttled snapshot; FPS is counted here with a local rAF loop because it is
 * purely a rendering concern; net stats are polled (the session has no
 * subscription surface for them — this is a debug view, not gameplay).
 */
export default function DebugOverlay({ debug, passiveCount, hostileCount, daylightPercent, net }: DebugOverlayProps) {
  const [fps, setFps] = useState(0);
  const [netStats, setNetStats] = useState<NetStats | null>(null);

  useEffect(() => {
    let frames = 0;
    let windowStart = performance.now();
    let raf = 0;
    const tick = () => {
      frames += 1;
      const now = performance.now();
      if (now - windowStart >= 500) {
        setFps(Math.round((frames * 1000) / (now - windowStart)));
        frames = 0;
        windowStart = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!net) return;
    // First readout lands on the first interval tick (sync setState in an
    // effect body is a lint error); a 500 ms blank on a debug overlay is fine.
    const timer = setInterval(() => setNetStats(net.netStats()), 500);
    return () => clearInterval(timer);
  }, [net]);

  const lines = [
    "Monecraft (F3 to close)",
    `${fps} fps`,
    debug ? `XYZ: ${debug.x.toFixed(1)} / ${debug.y.toFixed(1)} / ${debug.z.toFixed(1)}` : "XYZ: …",
    `Daylight: ${daylightPercent}%${debug ? ` (${debug.daylight.toFixed(2)})` : ""}`,
    `Mobs: ${passiveCount} passive, ${hostileCount} hostile`,
    ...(net && netStats
      ? [
          `Net: ${Math.round(netStats.rttMs)} ms rtt, ${Math.round(netStats.jitterMs)} ms jitter, interp ${Math.round(netStats.interpDelayMs)} ms`,
          `Bandwidth: in ${netStats.inKBps.toFixed(1)} KB/s, out ${netStats.outKBps.toFixed(1)} KB/s, pred ${netStats.pendingPredictions}`
        ]
      : [])
  ];

  return (
    <div className="debug-overlay" data-testid="debug-overlay">
      {lines.map((line) => (
        <div key={line} className="debug-line">
          {line}
        </div>
      ))}
    </div>
  );
}
