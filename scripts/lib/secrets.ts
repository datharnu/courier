import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function havenDir(): string {
  return process.env.HAVEN_SECRETS_DIR ?? join(homedir(), ".haven");
}

function secretPath(name: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(name)) throw new Error("bad account name");
  return join(havenDir(), `${name}.env`);
}

export function readMnemonic(name: string): string {
  const text = readFileSync(secretPath(name), "utf8");
  const match = text.match(/^MNEMONIC=(?:"([^"]+)"|(\S+))\s*$/m);
  const mnemonic = match?.[1] ?? match?.[2];
  if (!mnemonic) throw new Error(`no MNEMONIC for ${name}`);
  return mnemonic;
}

/** Prekey secrets live beside the mnemonics, never in the repository. */
export function prekeyPath(name: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(name)) throw new Error("bad account name");
  return join(havenDir(), "courier", `${name}.prekeys.json`);
}

export function writePrivate(path: string, contents: string): void {
  const dir = join(path, "..");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  writeFileSync(path, contents, { mode: 0o600 });
  chmodSync(path, 0o600);
}
