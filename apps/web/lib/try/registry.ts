/**
 * The chain's ML-KEM key registry over REST. The REST API sends no CORS headers, so the page reads it
 * through a same-origin, read-only rewrite in next.config.ts that allows only this one route.
 */
export const KEM_PROXY_PREFIX = "/chain-rest/kem/";
export const ML_KEM_1024_ALGORITHM = 2;
export const ML_KEM_1024_PUBLIC_BYTES = 1568;
const QOR_ADDRESS = /^qor1[02-9ac-hj-np-z]{38}$/;

export type RegistryRead = { ok: true; kem: string | null } | { ok: false; reason: string };

/** `{ found, key: { algorithm_id, public_key (base64) } }` → lowercase 0x hex, or null when nothing is registered. */
export function parseKemReply(body: unknown, address: string): RegistryRead {
  const reply = body as { found?: unknown; key?: { address?: unknown; algorithm_id?: unknown; public_key?: unknown } } | null;
  if (!reply || typeof reply !== "object") return { ok: false, reason: "The KEM registry reply was not JSON." };
  if (reply.found === false) return { ok: true, kem: null };
  const key = reply.key;
  if (reply.found !== true || !key || typeof key.public_key !== "string") return { ok: false, reason: "The KEM registry reply had no key." };
  if (key.address !== undefined && key.address !== address) return { ok: false, reason: `The KEM registry answered for ${String(key.address)}, not ${address}.` };
  if (Number(key.algorithm_id) !== ML_KEM_1024_ALGORITHM) return { ok: false, reason: `The registered key is algorithm ${String(key.algorithm_id)}, not ML-KEM-1024.` };
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(key.public_key), (char) => char.charCodeAt(0));
  } catch {
    return { ok: false, reason: "The registered key was not base64." };
  }
  if (bytes.length !== ML_KEM_1024_PUBLIC_BYTES) return { ok: false, reason: `The registered key is ${bytes.length} bytes, not ${ML_KEM_1024_PUBLIC_BYTES}.` };
  let hex = "0x";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return { ok: true, kem: hex };
}

export async function readRegistryKem(address: string, fetcher: typeof fetch = fetch): Promise<RegistryRead> {
  if (!QOR_ADDRESS.test(address)) return { ok: false, reason: `${address} is not a qor1 address.` };
  let response: Response;
  try {
    response = await fetcher(`${KEM_PROXY_PREFIX}${address}`, { headers: { accept: "application/json" } });
  } catch {
    return { ok: false, reason: "Could not reach the KEM registry." };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: `The KEM registry answered HTTP ${response.status} without JSON.` };
  }
  if (!response.ok && (body as { found?: unknown })?.found !== false) return { ok: false, reason: `The KEM registry answered HTTP ${response.status}.` };
  return parseKemReply(body, address);
}
