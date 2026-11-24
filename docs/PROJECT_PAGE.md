# Courier: project page copy

Paste-ready text for the hackathon project page. Every address and hash below is copied from `README.md` and `deployments/`.

## About (under 150 words)

Courier delivers encrypted invoices and documents between QoreChain addresses, and ties each one to its payment and its delivery receipt on chain. Before encrypting, the sender checks the recipient's prekey bundle against `PrekeyDirectory`, where the recipient bound it with an ML-DSA-87 signature, so an untrusted relay cannot swap in its own key: it is refused with `BUNDLE_HASH` before a byte is sealed. Files and messages are sealed on the device with X25519 and ML-KEM-1024, then a double ratchet (XChaCha20-Poly1305). The invoice is paid through `MemoPay`, which stores only `keccak256(ciphertext)`, and the recipient's ML-DSA-87 delivery receipt is checked on chain by `DeliveryReceipts`. Steward's `CourierInboxAdapter` reads the invoices Courier delivered. Try it in a browser at `/app/try`: catch a lying relay, using two public demo identities whose keys are deliberately published and hold nothing.

## Demo URLs

- Video (2:32): https://drive.google.com/file/d/1P5WucUYNApsJwSpqOjGl3RPNHud-PMBK/view
- Try it: catch a lying relay (client and vendor in one page, protocol runs in the browser): https://courier-fawn-psi.vercel.app/app/try
  - The two identities on this page (`courier-demo-vendor`, `courier-demo-client`) are public demo keys, committed on purpose in `apps/web/fixtures/demo/identities.json`. They hold nothing.
  - Demo vendor `qor1ee5ypk25qvppjs7hqk7fcvf354rkcc9sqcak0u` / `0xce6840d95403021943d705bc9c3131a5476c60b0`; demo client `qor1t5parjalqguchl9aptfw4wd5wwn9uhahusfkdu` / `0x5d03d1cbbf02398bfcbd0ad2eab9b473a65e5fb7`.
  - The page checks the demo vendor's bundle hash on chain: `0x0f13517a19a3a1df5a333553b0bff2384cb577cd076deac06a988a6fee4a4175`, live until 30 November 2026, 12:22 UTC, then renewed with `npm run renew -- --send` (next run before that time). If it has expired, the page says so.
  - Every run uses the vendor's last-resort prekey: the keys are public, so a one-time prekey could not stay one-time.
  - Read from chain by the page: the bundle hash (`PrekeyDirectory`), the vendor's registered ML-KEM-1024 key (KEM registry, via a same-origin read-only rewrite), and both ML-DSA-87 keys (`pqcKeyStatus`). The vendor's X25519 key is not stored on chain; it comes in a recipient card that must verify under the vendor's on-chain ML-DSA-87 key. A swapped bundle is refused with `BUNDLE_HASH`, a swapped card key with `CARD`.
- Verify the recorded bundles and receipt live against QoreChain Diana: https://courier-fawn-psi.vercel.app/app/receipt
- Home: https://courier-fawn-psi.vercel.app
- Code (Apache-2.0): https://github.com/datharnu/courier

## Contracts on `qorechain-diana` (EVM chain ID 9800)

| Contract | Address |
| --- | --- |
| `PrekeyDirectory` | `0x3d9a5821d0a24220a5f244a63a4a641d2acd9c2d` |
| `MemoPay` | `0x0fef978df64a5516e9f52ba1f4b2bbea6b7bd98c` |
| `DeliveryReceipts` | `0x06b52afc4a151b0efa260e2adcdf2d477632cb56` |

## Key transactions

| What | Hash |
| --- | --- |
| Vendor bundle publish (ML-DSA-87 checked by `pqcVerify`) | `0x1d38945c94ea384f8d0f4c1338d858d6edc7d34fd54cf2cf251242e44e61555e` |
| `MemoPay.pay`, 10,000 fUSD base units, only the ciphertext hash on chain | `0xad3500fd93af8d5b95e51da69fe683382d2679c4291871ada7d7f06a31e245c4` |
| Group delivery receipt on `DeliveryReceipts` | `0x3dfdb6bdf8a11a81792129083642f706a9b4547a62d4d8ebbe3eceb645566a89` |
| Haven Escrow carry receipt on `DeliveryReceipts` | `0x95a37e72f573830a73e491de42d0f7da7ad33713c80ed35d8626103c90391452` |
| `/app/try` demo vendor bundle publish | `0x823fea9cbc7db2deac4fbbad47871f10766a378d1447f700aeaa8c21d6d7b08d` |
