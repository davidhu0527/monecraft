type TreasureCompassProps = {
  /** Bearing/distance to the nearest unlooted buried treasure, or null when no map is held (or none remain). */
  treasure: { bearingDegrees: number; distanceBlocks: number } | null;
};

/** Top-center compass pill shown while a treasure map is held — points at the buried hoard. */
export default function TreasureCompass({ treasure }: TreasureCompassProps) {
  if (!treasure) return null;

  return (
    <div
      className="treasure-compass"
      role="status"
      aria-label={`Buried treasure: ${treasure.distanceBlocks} blocks away, bearing ${treasure.bearingDegrees} degrees`}
    >
      <span className="treasure-pointer" style={{ transform: `rotate(${treasure.bearingDegrees}deg)` }} aria-hidden="true" />
      <span>Buried treasure: {treasure.distanceBlocks} blocks</span>
    </div>
  );
}
