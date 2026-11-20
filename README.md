# Courier

Post-quantum messages between QoreChain addresses. A message is readable only by the recipient's current device. The relay will hold ciphertext. A key is accepted only when the owner's ML-DSA-87 key has bound it.

`PrekeyDirectory` stores the keccak256 of a canonical prekey bundle and checks an ML-DSA-87 signature over `(chainid, directory, owner, hash, expiry)`, the same message `BundleSpike` already published on testnet. The handshake is four X25519 agreements plus ML-KEM-1024 to a one-time key, or to the last-resort prekey when none is left. The identity ML-KEM key is never an encapsulation target. Later messages use a symmetric ratchet, XChaCha20-Poly1305 and HKDF-SHA-256. Each direction has its own root, so a KEM step one way never breaks messages in flight the other way. Every 20 messages a party sends, and on the next message after a device says it may have been copied, it offers a fresh ML-KEM key. The reply encapsulates to that key and makes a counter-offer, so both directions are rekeyed after one round trip.

If one side keeps sending and the other never answers, no step completes. Those messages rely on the symmetric chain only, so a stolen ratchet state opens them until a reply arrives. A copy made before the offering secret existed cannot open the reply. A copy that already holds that secret can finish that one step, and stops at the next secret created after the copy.

A file has its own 32-byte key. That key travels inside a ratchet message. It is never sealed to a long-term key.

The relay holds ciphertext and public keys, and is never trusted for either. Every bundle and card it returns is checked against the chain before anything is sealed. An inbox opens only to its owner, signed in with SIWQ and an ML-DSA-87 signature. The relay keeps state in memory in this version.

`MemoPay` sends fUSD and stores the keccak256 of a Courier ciphertext. The memo is an `invoice` message: the vendor-signed invoice Steward already understands, encrypted in the ratchet. The contract never sees the memo. Paying there does not mark the invoice used in Steward's PayGate, which holds a different balance. It is on testnet at `0x0fef978df64a5516e9f52ba1f4b2bbea6b7bd98c`. `npm run pay:memo` paid 10,000 base units. The hash is in `docs/deployments.md`.

`PrekeyDirectory` is on testnet at `0x3d9a5821d0a24220a5f244a63a4a641d2acd9c2d`, with one real bundle published by `steward-vendor`. `npm run live` ran `spike` and `steward-vendor` through the relay against the real chain. A swapped bundle was refused, then four messages and an invoice file went through. The hashes are in `docs/deployments.md`.

Groups, delivery receipts and safety numbers are built and tested. `npm run live:group` ran a three-member group on testnet between `spike`, `steward-vendor` and `courier-carol`: a message and a file, a delivery receipt recorded in `DeliveryReceipts` at `0x06b52afc4a151b0efa260e2adcdf2d477632cb56`, a removal, and the removed member's post refused. The hashes are in `docs/deployments.md`. Not built yet: the web app (`apps/web`), Playwright tests, the share link and the fest directory. The spike results are in `docs/spikes.md`. Nothing here is audited.

## Limitations

- If the ratchet slips, forward secrecy comes only from one-time prekeys that have already been used up. Each used one-time entry's secrets are erased when its handshake opens. The last-resort prekey is not erased, so a handshake sealed to it is protected only until that prekey is rotated with the next bundle.
- Counters must match exactly. A replayed or skipped message is refused, and Courier keeps no skipped-message keys, so one dropped message stalls that direction of the conversation for good. The conversation has to be started again.
- If one side keeps sending and the other never replies, no ML-KEM step completes. Those messages rely on the symmetric chain only, so a stolen ratchet state opens them until a reply arrives.
- The relay keeps its state in memory. A restart loses inboxes and files. It is not the stateless `relay/` service the design describes.
- Group membership is decided by the group's admin, and each member's device keeps its own copy. A removed member keeps every message and file they already opened.
- A forwarded invoice still verifies, because the vendor's signature does not name who sent the message. The money is still locked to the signed payee.
- Safety numbers are modelled on Signal's numeric fingerprints but use SHA-256, not SHA-512. They are not compatible with Signal.

## Run it

```bash
git clone --recurse-submodules https://github.com/datharnu/courier && cd courier
npm ci
npm test            # the TypeScript tests and forge test, no chain needed
npm run relay       # a relay on 127.0.0.1:8787 that reads qorechain-diana
```

`npm run live`, `npm run deploy:directory`, `npm run deploy:memopay`, `npm run deploy:receipts`, `npm run fund -- <name>`, `npm run pay:memo`, and `npm run live:group` need the accounts in `~/.haven`.

## Tests

`npm run test:ts` covers the handshake, the ratchet, the relay, the client, invoices, groups, delivery receipts, safety numbers and pinned byte vectors in `vectors/protocol.json`. Most of the relay tests are a relay lying: it swaps a bundle or a card, hands one entry to two senders, or delivers a forged or tampered message. `npm run test:sol` covers `PrekeyDirectory`, `MemoPay` and `DeliveryReceipts`, with invariant suites for the directory and MemoPay, including an invariant that MemoPay never holds tokens.

Apache-2.0.
