# Courier

Post-quantum messages between QoreChain addresses. A message is readable only by the recipient's current device. The relay will hold ciphertext. A key is accepted only when the owner's ML-DSA-87 key has bound it.

`PrekeyDirectory` stores the keccak256 of a canonical prekey bundle and checks an ML-DSA-87 signature over `(chainid, directory, owner, hash, expiry)`, the same message `BundleSpike` already published on testnet. The handshake is four X25519 agreements plus ML-KEM-1024 to a one-time key, or to the last-resort prekey when none is left. The identity ML-KEM key is never an encapsulation target. Later messages use a symmetric ratchet, XChaCha20-Poly1305 and HKDF-SHA-256. Each direction has its own root, so a KEM step one way never breaks messages in flight the other way. Every 20 messages a party sends, and on the next message after a device says it may have been copied, it offers a fresh ML-KEM key. The reply encapsulates to that key and makes a counter-offer, so both directions are rekeyed after one round trip.

If one side keeps sending and the other never answers, no step completes. Those messages rely on the symmetric chain only, so a stolen ratchet state opens them until a reply arrives. A copy made before the offering secret existed cannot open the reply. A copy that already holds that secret can finish that one step, and stops at the next secret created after the copy.

A file has its own 32-byte key. That key travels inside a ratchet message. It is never sealed to a long-term key.

`PrekeyDirectory` is on testnet at `0x3d9a5821d0a24220a5f244a63a4a641d2acd9c2d`, with one real bundle published by `steward-vendor`. The hashes are in `docs/deployments.md`.

Not built yet: the relay, groups, the web app, and MemoPay. The spike results are in `docs/spikes.md`. Nothing here is audited.

## Tests

`npm run test:ts` covers the handshake and the ratchet. `npm run test:sol` covers the directory.

Apache-2.0.
