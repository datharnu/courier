# Courier

**A message is readable only by the recipient's current device. A key is accepted only when that person's ML-DSA-87 key has bound it.**

Track: Encrypted Apps, [Build Before Q-Day](https://build.qorechain.io/). Repository: https://github.com/datharnu/courier. Licence: Apache-2.0.

Network `qorechain-diana`, EVM chain id 9800. The directory, the memo payment, and the delivery receipt are on testnet. The message contents are not. The relay in this version keeps its state in memory on the machine that runs it. Nothing here has been through the dashboard audit.

The site in this repository replays the recorded run. It does not send a message. The public copy is https://courier-fawn-psi.vercel.app.

The relay will hold ciphertext. It is never trusted for a key. Every bundle and card it returns is checked against the chain before anything is sealed.

## Judge it without our keys

1. Read [What was measured](#what-was-measured). The hashes are copied from [docs/deployments.md](docs/deployments.md), which is the long form.
2. The contracts and the protocol tests need no chain:

```bash
git clone --recurse-submodules https://github.com/datharnu/courier
cd courier
npm ci
npm test
```

`npm test` is `npm run test:ts` and then `forge test`. The TypeScript tests include a relay that lies: it swaps a bundle or a card, hands one entry to two senders, or delivers a forged or tampered message.

3. The site replays the recorded group run and does not send a message:

```bash
npm run web
```

`npm run live` and `npm run live:group` talk to the real chain and need the accounts in `~/.haven`. They are not the judge path. Their reports are already in `deployments/`.

The receipt page checks the two published bundles and receipt `0x3dfdb6bdf8a11a81792129083642f706a9b4547a62d4d8ebbe3eceb645566a89`. Verify this step reads the signature from that transaction. It does not call the relay and it does not sign. The standing line states the recorded expiry, 26 November 2026, 20:11 UTC for the vendor and 27 November 2026, 11:45 UTC for Carol. Only the check result says whether `current()` is live or expired. The signature can still be checked after the expiry.

## On the web

Import the repository on Vercel with the root directory set to `apps/web`. The install is `npm ci` and the build is `npm run build`. There is no environment variable. The page holds no key. The recorded files are also copied under `apps/web/fixtures/deployments/` so the build does not need the parent folder. Do not set a root `vercel.json`.

The public copy is https://courier-fawn-psi.vercel.app. Opened on 21 November 2026. **Verify all** on `/app/receipt` finished at 390px and at 1440px. The vendor bundle, Carol's bundle, and the delivery receipt each passed fetched, decoded, key read, signature verified, and recorded. `current()` was live for both bundles. The standing lines stated the recorded expiry. Horizontal overflow was 0. No step said "Could not reach the testnet".

Two published bundles expire before or around judging. The vendor bundle expires at Unix time 1795723898, 26 November 2026, 20:11 UTC. Carol's expires at 1795779952, 27 November 2026, 11:45 UTC. The recorded hashes do not. The secret half of a bundle is in `~/.haven`, mode 0600, and is not in the repository.

## Live through judging

The recorded exchange, the memo payment, and the group receipt stay valid. They do not expire.

A judge's two identities publish their own bundles in the browser at the start of a visit. That page is not built yet. Those identities are not the vendor and not Carol.

The project's own bundles are renewed on this calendar, and not before a person says go. The contract allows at most 7 days, so one publish cannot last until 15 December.

| Run | Command | Account |
| --- | --- | --- |
| 26 November 2026, after 20:11 UTC | `npm run deploy:directory` | vendor `qor17zwvy05e9fzerfzksdkhygm92wvapwusvh4zfv` |
| 27 November 2026, after 11:45 UTC | `npm run deploy:directory courier-carol` | Carol `qor1tacy6fv8x0jveznhdmyrqc2yep83awk07v3tf4` |
| 3 December 2026 | `npm run deploy:directory` | vendor |
| 4 December 2026, after the expiry set on 27 November | `npm run deploy:directory courier-carol` | Carol |
| 9 December 2026 | `npm run deploy:directory` | vendor |
| 10 December 2026, after the expiry set on 4 December | `npm run deploy:directory courier-carol` | Carol |

Carol's command returns the old file and does not broadcast while that file is still live. The vendor command publishes even if the old bundle is still live. The fee for each publish is an open and a close at 180000 uqor, plus the EVM gas. The last publishes used 280769 gas (vendor) and 280805 gas (Carol).

## What was measured

| What was measured | Result | Where |
| --- | --- | --- |
| A swapped bundle | Refused with `BUNDLE_HASH` before anything was sealed. The relay had substituted another valid bundle with the same identity KEM key | `deployments/live-exchange.json`, 19 November 2026, 20:47 UTC. No transaction |
| A one-time handshake, a reply, and a file | Conversation `0xea94595b…798d3fcd`. File `0x4a37b897…2662ca2a`, 84 bytes, hash matched. Entry 1's secrets were then erased | The same report. The vendor's client read the directory, the KEM registry, and `pqcKeyStatus` before it accepted |
| A directory publish with one signature byte changed | `eth_call` reverted `SignatureInvalid` (`0x37e8456b`). Nothing was sent | Before the vendor publish. `scripts/probe-directory.ts` repeats it with a fresh hash and still sends nothing |
| MemoPay | 10,000 fUSD base units to the vendor. The chain stores keccak256 of the ciphertext, not the invoice | Pay `0xad3500fd93af8d5b95e51da69fe683382d2679c4291871ada7d7f06a31e245c4`. Ciphertext hash `0x588d5e7381c6e9412ab5b37063931fbc57ce930c26c1cfbc0d26d5d344e1eb6b` |
| A three-person group | A message, a file, a delivery receipt, a removal, and the removed member's next post refused | `deployments/live-group.json`, 20 November 2026, 12:05 UTC |
| A receipt with one signature byte changed | `eth_call` reverted `0x37e8456b` before the real `record` | Then `0x3dfdb6bdf8a11a81792129083642f706a9b4547a62d4d8ebbe3eceb645566a89` |

> **The chain binds the key. The device opens the message.** A relay that returns a different bundle fails the hash check. A relay that returns the right bundle still cannot read the ciphertext.

| What has been observed | Where the boundary is |
| --- | --- |
| The identity ML-KEM key is never an encapsulation target | The handshake uses four X25519 agreements plus ML-KEM-1024 to a one-time key, or to the last-resort prekey when none is left |
| One side talking alone does not rekey | If the other side never answers, no ML-KEM step completes. Those messages rely on the symmetric chain. A stolen ratchet state opens them until a reply arrives |
| A removed member keeps what they already opened | Membership is a set the admin wrote, copied onto each device. Removal stops later keys. It does not reach back |
| MemoPay does not mark a Steward invoice paid | PayGate holds a different balance. Paying the memo does not call it |
| The relay forgets on restart | State is in memory. A restart loses inboxes and files. This is not the stateless relay the design describes |

## What the track asks for

The category requirements on the [Prizes](https://build.qorechain.io/prizes) page are ML-KEM-1024 encryption, registered recipient keys, ML-DSA key binding, and client-side encryption and decryption. The jury's point weights are not published.

| Requirement | Where it holds | Limit |
| --- | --- | --- |
| ML-KEM-1024 | The handshake encapsulates to a one-time prekey, or to the last-resort prekey. A file key travels inside a ratchet message and is never sealed to a long-term key | The identity KEM key is published so a card can be checked. It is not an encapsulation target |
| Registered recipient keys | `PrekeyDirectory` stores keccak256 of a canonical bundle. `current(owner)` is read back after publish | The vendor bundle expires 26 November 2026. Carol's expires 27 November 2026. After that, `current` is no longer live until a new publish |
| ML-DSA key binding | `publish` checks an ML-DSA-87 signature over `(chainid, directory, owner, hash, expiry)`. A flipped byte reverts `SignatureInvalid` | The check is on the bundle hash, not on the message contents. Message contents never touch this contract |
| Client-side encryption and decryption | The clients seal and open. The relay stores ciphertext. MemoPay stores a hash of ciphertext. The payment calldata is 132 bytes and does not contain the memo | Safety numbers use SHA-256. They are not Signal safety numbers. Groups have no server-side membership proof beyond the admin's signed state |

## Contents

1. [The problem](#the-problem)
2. [The rule](#the-rule)
3. [What this does not claim](#what-this-does-not-claim)
4. [Addresses](#addresses)
5. [Evidence](#evidence)
6. [Limits that are still true](#limits-that-are-still-true)
7. [Decisions](#decisions)
8. [Stack](#stack)
9. [Getting started](#getting-started)
10. [Repo map](#repo-map)
11. [What works today](#what-works-today)
12. [Credits](#credits)

## The problem

Two QoreChain accounts want to send a message, a file, or an invoice. A relay is useful, and a relay can be anyone. The recipient should be able to reject a key the sender's ML-DSA key did not publish. A copy of an old device should not open what the new device says afterwards.

Courier is that check, plus a ratchet. It is not a general messenger with accounts, and it is not Steward. Steward pays an invoice. Courier can carry the invoice as ciphertext. The payment contract stores the hash of that ciphertext and never sees the text.

## The rule

> **Publish the hash. Sign it with ML-DSA-87. Seal only to a key whose hash the chain still calls live. Open on the device that holds the ratchet.**

- **Directory** (`src/PrekeyDirectory.sol`). One current bundle per owner. The signature covers the chain, the directory, the owner, the hash, and the expiry.
- **Handshake.** Four X25519 agreements plus ML-KEM-1024. The identity ML-KEM key is never the target.
- **Ratchet.** Each direction has its own root. A KEM step one way does not break messages already in flight the other way. Every 20 messages a party sends, and on the next message after a device says it may have been copied, that party offers a fresh ML-KEM key. The reply encapsulates to it and makes a counter-offer.
- **Files.** A file has its own 32-byte key. That key travels inside a ratchet message.
- **Inbox.** Opens only to its owner, signed in with SIWQ and an ML-DSA-87 signature. A stranger's post is refused unless it is signed or it passes the conversation's AEAD.
- **MemoPay** (`src/MemoPay.sol`). Sends fUSD and stores keccak256 of a Courier ciphertext. The memo is an `invoice` message: the vendor-signed invoice Steward already understands, encrypted in the ratchet.
- **Groups.** Tested with three members. The admin writes the set. A removed member's later post is refused. Delivery receipts are an ML-DSA signature over the ciphertext hash, recorded in `DeliveryReceipts`.

The byte layout is [docs/protocol.md](docs/protocol.md). The attacker list is [THREAT_MODEL.md](THREAT_MODEL.md).

## What this does not claim

| Claim we do not make | What is true instead |
| --- | --- |
| The relay is durable | It keeps state in memory. A restart loses inboxes and files |
| One dropped message can be skipped | Counters must match. Courier keeps no skipped-message keys. That direction has to be started again |
| A silent peer still gets fresh KEM steps | No reply, no step. The symmetric chain is all those messages have |
| Removal deletes history | A removed member keeps every message and file they already opened |
| A forwarded invoice fails | The vendor's signature does not name who sent the message. The money is still locked to the signed payee |
| Signal-compatible safety numbers | The shape is Signal's. The hash is SHA-256, not SHA-512 |
| This payment marks the Steward invoice used | PayGate was not called. The vendor's 10,000 from MemoPay sit beside the Steward balance, not inside it |
| An audit, or a public relay | No dashboard audit. The relay a juror runs is on 127.0.0.1 |

## Addresses

| What | Address |
| --- | --- |
| PrekeyDirectory | `0x3d9a5821d0a24220a5f244a63a4a641d2acd9c2d` |
| MemoPay | `0x0fef978df64a5516e9f52ba1f4b2bbea6b7bd98c` |
| DeliveryReceipts | `0x06b52afc4a151b0efa260e2adcdf2d477632cb56` |
| fUSD, 6 decimals | `0x97143B771D34ddb9130b807b135Ae675A5a963CA` |
| spike, deployer and group admin | `qor143f0ghn8slqguwez73087dvq8lqnuuukqdu9fl` / `0xaC52f45E6787c08E3B22f45e7f35803Fc13e7396` |
| steward-vendor | `qor17zwvy05e9fzerfzksdkhygm92wvapwusvh4zfv` / `0xf09cc23e992A4591A456836D7223655399D0BB90` |
| courier-carol, removed in the group run | `qor1tacy6fv8x0jveznhdmyrqc2yep83awk07v3tf4` / `0x5f704d258733e4cc8a776ec8306144c84f1ebacf` |

The vendor bundle hash is `0x9306826eb46977b32639a004ad992c868c5614d703fbb9a8e8cc08309b13e79f`, expiry 1795723898, read back `live = true` at publish. Carol's bundle hash is `0x157c35bd5c1ffd5eb7606d33bc93183096184fc438155048e5d5bd5f07dbf6f0`, expiry 1795779952.

## Evidence

### Directory

Deployed by spike. Gas used 383,084. Deploy `0x68e262aad138342bf1f299d28b4cd2fa01724c6fce69e2c6c4f9f65f11830d76`.

The first deploy attempt was refused before it ran. Its window capped value at 1 uqor, and a window's cap also pays gas, which was 43,097 uqor. Nothing was deployed by that attempt.

The vendor published 20 one-time entries. Publish `0x1d38945c94ea384f8d0f4c1338d858d6edc7d34fd54cf2cf251242e44e61555e`, gas used 280,769. Carol's publish `0x994a39fc67a0082ac29cb0932ce95e1e4d8f1df0893325b808d4fb89b835adf0`, gas used 280,805.

### The exchange

`npm run live` starts a relay on 127.0.0.1 and reads the real chain. It sends no transactions.

1. A swapped bundle was refused with `BUNDLE_HASH`.
2. spike opened a conversation on one-time entry 1.
3. The vendor replied, then sent `INV-0007.json`. spike opened it and the hash matched.
4. spike answered.

The vendor's client then erased entry 1's secrets from the prekey file outside the repo.

### MemoPay

Deploy `0x09200f2613ea03f0b72a4c96a197ce511e170be268af66ceae9ae0f636919145`, gas used 429,809.

Spike held no fUSD. `npm run pay:memo` bought some from pool 2, spending at most 400,000 uqor, and converted it. Swap `89BC9AABF4F23F63D5D5A2BB3E651BF5DCEF20DA843C8EEB36C2320A9AE1C38D`. Conversion `576ACFBDE5A8AB4288F6043A15B5CABE18F71D33DFF74FB1E5D00A705767EBCC`.

| Step | Hash |
| --- | --- |
| Approve 10,000 | `0xb417daf32271680307666daa7d80d745a8acddac3c6d6857eadedc56dcf5777f` |
| Pay | `0xad3500fd93af8d5b95e51da69fe683382d2679c4291871ada7d7f06a31e245c4` |

`payment(spike, ciphertextHash)` read back the vendor, fUSD, 10,000, and timestamp 1795122861 (19 November 2026, 21:14 UTC). The memo's own text hash is `0x72e49759675f787b7d1e922a5e77134e70b1a569dad6f1c59e75ea4af86f9430`. That is not the hash on chain. The chain hash is the ciphertext hash above. After the payment, spike held 2,000 fUSD and the vendor held 45,000, which is 35,000 already there from Steward plus these 10,000.

### The group

Group id `0x4d3a0e94e5f4dbeb76d18d970f439fe5a96974109db08e8c3924b288fe3314c0`. Run on 20 November 2026 at 12:05 UTC. The relay was in-process, real HTTP on 127.0.0.1.

1. Spike creates the group. Vendor and Carol each got the state.
2. Spike sends a group message. Both got it.
3. Spike sends a group file. Both opened it and the hash matched.
4. The vendor signs a receipt and spike records it.
5. Spike removes Carol.
6. Spike sends a message and a file after the removal. The vendor opened the file.
7. Carol posts after being removed. Spike and the vendor each got `refused GROUP`.

The receipt record is `0x3dfdb6bdf8a11a81792129083642f706a9b4547a62d4d8ebbe3eceb645566a89`, gas used 288,262. `receipt(...)` read back submitter spike and `recordedAt` 1795176375 (20 November 2026, 12:06 UTC). A second `record` of the same receipt reverted.

The files and conversation ids are in [docs/deployments.md](docs/deployments.md). Used one-time entries in that report: steward-vendor `0, 1, 2, 3` and courier-carol `0`. The earlier exchange had already used vendor entry 1.

## Limits that are still true

- If the ratchet slips, forward secrecy comes only from one-time prekeys that have already been used up. Each used one-time entry's secrets are erased when its handshake opens. The last-resort prekey is not erased, so a handshake sealed to it is protected only until that prekey is rotated with the next bundle.
- Counters must match exactly. A replayed or skipped message is refused, and Courier keeps no skipped-message keys, so one dropped message stalls that direction for good.
- If one side keeps sending and the other never replies, no ML-KEM step completes. A stolen ratchet state opens those messages until a reply arrives. A copy made before the offering secret existed cannot open the reply. A copy that already holds that secret can finish that one step, and stops at the next secret created after the copy.
- The relay keeps its state in memory.
- A removed member keeps every message and file they already opened.
- A forwarded invoice still verifies. The money is still locked to the signed payee.
- Safety numbers use SHA-256 and are not compatible with Signal.
- The relay can drop everything. Availability is not protected.

## Decisions

| Decision | Why |
| --- | --- |
| The identity KEM key is not an encapsulation target | A long-term key that opens messages is the key a later thief wants. One-time keys are erased after use. The last-resort key is the exception, and the limit is stated above |
| Each direction has its own root | A rekey one way must not invalidate a message already on the way back |
| The chain stores a hash, not a memo | MemoPay's calldata cannot leak the invoice. The hash is keccak256 of the ciphertext, so it also does not match the plaintext hash |
| No skipped-message keys | A gap is a stall, not a silent skip. The cost is in the limits section |
| Groups are admin-signed state on each device | There is no chain membership contract. Removal is a new state the remaining members accept. It does not wipe their history |
| The site does not send | Open App replays the group run. Sending would need the keys in `~/.haven` |

## Stack

Solidity on Foundry. TypeScript on Node 22. `@noble/ciphers` and `@noble/hashes`. `@qorechain/pqc` 0.2.3, `qoreseal` 0.1.0, `qoresign` 0.1.0, `sdk` 0.14.0, `mcp` 0.1.1. `@qorechain/qorescan` 0.1.0 checks the contracts. haven-pq-kit v0.1.0. viem 2.47.6. The site is in `apps/web`. The kit map is [docs/kits.md](docs/kits.md).

`BundleSpike` is the earlier contract that published the same signed message shape. `PrekeyDirectory` checks that shape.

## Getting started

```bash
git clone --recurse-submodules https://github.com/datharnu/courier
cd courier
npm ci
npm test
npm run relay     # 127.0.0.1:8787, reads qorechain-diana
npm run web       # the replay
```

These send transactions or need `~/.haven`: `npm run live`, `npm run deploy:directory`, `npm run deploy:memopay`, `npm run deploy:receipts`, `npm run fund -- <name>`, `npm run pay:memo`, and `npm run live:group`. Do not re-run `npm run live:group` to "refresh" the report. The recorded file is the evidence.

Pinned protocol bytes are in `vectors/protocol.json`.

## Repo map

| Path | What it is |
| --- | --- |
| `src/PrekeyDirectory.sol` | The bundle hash and the ML-DSA check |
| `src/MemoPay.sol` | fUSD plus a ciphertext hash |
| `src/DeliveryReceipts.sol` | One recorded receipt per ciphertext |
| `src/BundleSpike.sol` | The earlier signed-bundle spike |
| `src/ts/` | Handshake, ratchet, client |
| `scripts/relay.ts` | The in-memory relay |
| `scripts/live-exchange.ts` | spike and the vendor, through the relay, against the chain |
| `scripts/live-group.ts` | The three-member run |
| `apps/web` | Replay of that run. It does not send |
| `test/` | Foundry for the three contracts, including invariants on the directory and on MemoPay |
| `test/ts/` | Handshake, ratchet, a lying relay, invoices, groups, receipts, safety numbers |
| `docs/protocol.md` | The byte layout |
| `docs/deployments.md` | Every hash, with gas and the read-backs |
| `docs/DEMO.md` | How to show it |
| `docs/spikes.md` | The early spikes |
| `docs/kits.md` | Which QoreChain kits this repository uses |
| `scripts/cbom.ts` | The contract cryptography check |
| `scripts/evidence.ts` | Re-reads the recorded transaction hashes |
| `THREAT_MODEL.md` | Who can still open a message |
| `AI_USAGE.md` | What was generated, and what a person decided |
| `vectors/protocol.json` | The pinned bytes |

MemoPay's invariant includes that the contract never holds tokens. The payment is a transfer to the payee in the same call. The hash is what remains.

## What works today

- A directory on testnet, with two published bundles.
- A live exchange that refused a swapped bundle, then carried three texts and one invoice file.
- A memo payment of 10,000 base units whose chain data is a ciphertext hash.
- A three-member group: message, file, receipt, removal, and a refused post from the removed member.
- A public site at https://courier-fawn-psi.vercel.app. On 21 November 2026, **Verify all** on `/app/receipt` checked the vendor publish, Carol's publish, and receipt `0x3dfdb6bdf8a11a81792129083642f706a9b4547a62d4d8ebbe3eceb645566a89`. All three signatures passed, and `current()` was live for both bundles. The relay was not called.
- Contract tests and protocol tests, including a relay that lies.
- `npm run cbom:check` passed on 21 November 2026. It refuses `ecrecover` and any contract cryptography outside Keccak and ML-DSA through the two precompiles. `npm run evidence` re-read the recorded transaction hashes the same day: 30 passed, 0 failed. It sends nothing.

Not built, and not claimed:

- A Haven family line. No practice receipt is recorded in `deployments/`.
- A share link and a fest directory.
- A relay that survives a restart.
- Skipped-message recovery.
- A dashboard audit.
- Project bundles that stay live through 15 December on their own. The calendar is in [Live through judging](#live-through-judging). A publish lasts at most 7 days.

## Credits

Written during the fest, November 2026. It builds on:

- **QoreChain kits:** `@qorechain/sdk`, `@qorechain/pqc`, `@qorechain/qoreseal`, `@qorechain/qoresign`, `@qorechain/mcp`. `@qorechain/qorescan` checks the contracts.
- **haven-pq-kit v0.1.0:** https://github.com/datharnu/haven-pq-kit. The `PqAuth` and `PqQuorum` interface follows the public design of [qore-pq-kit](https://github.com/Adityaakr/qore-pq-kit) by Adityaakr, Apache-2.0. The implementation, tests, `VendorSig`, and recipient-card checks were written for Haven.
- **Other libraries:** `@noble/ciphers`, `@noble/hashes`, viem, `@cosmjs/stargate`, forge-std, and TypeScript.

The handshake is the X3DH shape plus ML-KEM-1024, and the ratchet is the double-ratchet shape. The code was written for QoreChain accounts and for an ML-DSA binding. It is not a copy of Signal, and the safety numbers are not compatible with Signal.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
