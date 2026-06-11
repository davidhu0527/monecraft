import { useEffect, useState } from "react";
import type { DebugInfo } from "@/lib/game/engine/state";

type DebugOverlayProps = {
  debug: DebugInfo | null;
  passiveCount: number;
  hostileCount: number;
  daylightPercent: number;
};

/**
 * F3-style debug readout. Position and daylight come from the engine's
 * throttled snapshot; FPS is counted here with a local rAF loop because it is
 * purely a rendering concern.
 */
export default function DebugOverlay({ debug, passiveCount, hostileCount, daylightPercent }: DebugOverlayProps) {
  const [fps, setFps] = useState(0);

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

  const lines = [
    "Monecraft (F3 to close)",
    `${fps} fps`,
    debug ? `XYZ: ${debug.x.toFixed(1)} / ${debug.y.toFixed(1)} / ${debug.z.toFixed(1)}` : "XYZ: …",
    `Daylight: ${daylightPercent}%${debug ? ` (${debug.daylight.toFixed(2)})` : ""}`,
    `Mobs: ${passiveCount} passive, ${hostileCount} hostile`
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
