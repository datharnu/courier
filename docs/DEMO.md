# Courier Demo (`qorechain-diana`)

Every step below maps directly to the five demo shots in the hackathon track brief.

## Prerequisites

- Dependencies installed: `npm ci`
- Accounts and prekeys in `~/.haven` (see `docs/deployments.md`)
- Note: `steward-vendor`'s bundle expires on **26 Nov 2026, 20:11 UTC** — re-run `npm run deploy:directory` if expired.

---

## 1. Capture conversation ciphertext from the relay

Start the relay locally and run a live exchange between `spike` and `steward-vendor`:

```bash
npm run live
```

Inspect `deployments/live-exchange.json` (and the relay's stored inbox/file records). The relay only ever holds:
- XChaCha20-Poly1305 ciphertexts and 24-byte nonces
- Public prekey bundles and ML-DSA-signed recipient cards
- Encrypted file blobs keyed by `keccak256(ciphertext)`

No plaintext, file key, or ratchet state appears anywhere in the relay's storage.

---

## 2. Steal the recipient's long-term key — old messages stay closed

After `N` ratcheted messages and a file exchange:
- Even with the recipient's long-term identity ML-KEM-1024 secret, identity X25519 secret, and ML-DSA-87 secret, none of messages `1..N` or the file can be decrypted because:
  - One-time prekey secrets are wiped immediately upon handshake acceptance (`~/.haven/courier/steward-vendor.prekeys.json`).
  - The identity ML-KEM key is never an encapsulation target.
  - Each message advances the symmetric chain and wipes the previous key; periodic ML-KEM steps heal after ratchet-state compromise.

Run the automated proof:

```bash
node --import tsx --test --test-name-pattern="forward secrecy: Bob's stolen long-term keys and device storage open none of messages 1..N or the file" test/ts/features.test.ts
```

---

## 3. A lying proxy swaps a key — the sender refuses it

During `npm run live`, the first call routes through a proxy that swaps `steward-vendor`'s prekey bundle for a different valid bundle. The client checks `bundleHash(bundle)` against `PrekeyDirectory.current(vendor)` on chain, refuses immediately with `BUNDLE_HASH`, and seals nothing.

The swapped-key test sends the lie through haven-pq-kit's `createRestProxy`. The sender refuses it and nothing reaches the recipient, then the same proxy honest and a direct read both work.

```bash
node --import tsx --test --test-name-pattern="lying REST proxy" test/ts/features.test.ts
```

---

## 4. Pay an invoice with an encrypted memo

Run the live testnet memo payment:

```bash
npm run pay:memo
```

What happens on chain (`MemoPay` at `0x0fef978df64a5516e9f52ba1f4b2bbea6b7bd98c`):
1. `steward-vendor` sends a Steward-compatible ML-DSA-87-signed `invoice` payload inside the encrypted Courier ratchet.
2. `spike` verifies the invoice's `memoHash` and vendor ML-DSA-87 signature against the vendor's on-chain key.
3. `spike` calls `MemoPay.pay(fUSD, payee, amount, keccak256(ciphertext))` — 132 bytes of calldata containing only the ciphertext hash, never the memo text or invoice fields.
4. Recorded transaction hashes are in `docs/deployments.md` and `deployments/memo-payment.json`.

---

## 5. Verify safety numbers (and delivery receipts)

Both parties derive the same 60-digit (`12 × 5`) safety number from their on-chain ML-DSA-87 public keys (`client.safetyNumber(peer)`). If a MITM or lying endpoint substitutes either key, the safety number changes immediately.

Recipients can also sign an ML-DSA-87 delivery receipt (`client.ack(received)`) over `(conversationId, counter, ciphertextHash)`, which the sender verifies against the chain and keeps (`client.receiptFor(conversationId, counter)`), and can optionally record on chain via `DeliveryReceipts.sol`.

```bash
npm run safety
```

Both devices show `63690 98402 10244 24502 51612 68035 72615 14375 30442 07313 35177 45415`.

`npm run live:group` recorded one receipt on chain. The hashes are in `deployments/live-group.json`.

```bash
node --import tsx --test --test-name-pattern="safety numbers|delivery receipts" test/ts/features.test.ts
```
