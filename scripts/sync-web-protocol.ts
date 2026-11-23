import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Copies the browser-safe protocol files from `src/ts` into `apps/web/lib/protocol`. The only change is
 * the `.js` suffix on relative imports (`from "./bytes.js"` becomes `from "./bytes"`): Next's Turbopack
 * does not map `./bytes.js` to `bytes.ts` the way tsc and tsx do. Everything else is byte for byte.
 *
 *   npm run web:sync           # copy
 *   npm run web:sync -- --check  # exit 1 if a copy differs (test/ts/web-protocol.test.ts runs the same check in CI)
 *
 * The web app is deployed on its own (its own package.json and lockfile), so it cannot import `../../src/ts`.
 * These six files import only @qorechain/pqc, @qorechain/qoreseal, @qorechain/qoresign, @noble/* and viem,
 * which are pure JavaScript. chain.ts (REST and haven-pq-kit), relay-store.ts (node:fs), client.ts and relay.ts
 * are not copied: /app/try does not use them.
 */
export const WEB_PROTOCOL_FILES = ["bytes.ts", "crypto.ts", "bundle.ts", "handshake.ts", "session.ts", "file.ts"] as const;
export const SOURCE_DIR = "src/ts";
export const WEB_DIR = "apps/web/lib/protocol";

/** The web copy of a source file: relative `.js` import suffixes dropped, nothing else touched. */
export function webCopy(source: string): string {
  return source.replace(/(from\s+"\.{1,2}\/[^"]+)\.js"/g, '$1"');
}

export function differing(root = process.cwd()): string[] {
  return WEB_PROTOCOL_FILES.filter((file) => {
    let copy: string;
    try {
      copy = readFileSync(join(root, WEB_DIR, file), "utf8");
    } catch {
      return true;
    }
    return copy !== webCopy(readFileSync(join(root, SOURCE_DIR, file), "utf8"));
  });
}

if (process.argv[1]?.endsWith("sync-web-protocol.ts")) {
  if (process.argv.includes("--check")) {
    const stale = differing();
    if (stale.length > 0) {
      console.error(`apps/web/lib/protocol differs from src/ts: ${stale.join(", ")}. Run npm run web:sync.`);
      process.exit(1);
    }
    console.log(`apps/web/lib/protocol matches src/ts (${WEB_PROTOCOL_FILES.length} files).`);
  } else {
    mkdirSync(WEB_DIR, { recursive: true });
    for (const file of WEB_PROTOCOL_FILES) writeFileSync(join(WEB_DIR, file), webCopy(readFileSync(join(SOURCE_DIR, file), "utf8")));
    console.log(`copied ${WEB_PROTOCOL_FILES.join(", ")} to ${WEB_DIR}`);
  }
}
