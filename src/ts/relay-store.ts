import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";

import type { RelaySnapshot, RelayStore } from "./relay.js";

/**
 * Keeps relay state in one JSON file. Each save writes a temporary file beside it, flushes it,
 * and renames it over the old one, so a crash mid-write leaves the previous state, never half a file.
 * The file holds ciphertext and public keys only; it is still written 0600.
 * A file that does not parse is an error, not an empty relay: starting empty would overwrite it.
 */
export function fileStore(path: string): RelayStore {
  const temp = `${path}.${process.pid}.tmp`;
  return {
    load() {
      if (!existsSync(path)) return undefined;
      const text = readFileSync(path, "utf8");
      let parsed: RelaySnapshot;
      try {
        parsed = JSON.parse(text) as RelaySnapshot;
      } catch {
        throw new Error(`relay state ${path} is not JSON; move it aside to start empty`);
      }
      if (parsed?.version !== 1) throw new Error(`relay state ${path} has an unknown version`);
      return parsed;
    },
    save(snapshot) {
      const fd = openSync(temp, "w", 0o600);
      try {
        writeSync(fd, JSON.stringify(snapshot));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      try {
        renameSync(temp, path);
      } catch (error) {
        if (existsSync(temp)) unlinkSync(temp);
        throw error;
      }
    },
  };
}
