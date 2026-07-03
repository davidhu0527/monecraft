/**
 * The client↔game-server wire protocol. Versioned as a whole: a client built
 * against a different PROTOCOL_VERSION is refused at the door (its join
 * ticket carries the number), so mid-session format drift can't happen.
 *
 * Phase 4 fills in the message catalog (hello/pose/cmd/chat → welcome/
 * world-sync/tick/…); the version constant lands first because join tickets
 * already stamp it.
 */
export const PROTOCOL_VERSION = 1;
