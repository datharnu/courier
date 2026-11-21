# Kits and libraries

Versions are the pins in `package.json`. A file path is an import in this repository. A hash is a recorded transaction in `deployments/`. A test is a file that runs without the chain.

## QoreChain kits

| Package | Version | File | Evidence |
| --- | --- | --- | --- |
| `@qorechain/sdk` | 0.14.0 | `scripts/lib/chain.ts` imports `EthNativeSigner`, `openEvmWindowMsg`, `closeEvmWindowMsg`, `fetchEvmWindow`, and `deriveUnifiedAccount`. `src/ts/chain.ts` imports `evmToQor` and `qorToEvm` | Directory deploy open `CF5B4B70C6AA866624CC7275C6C3420A825A0B76A635E50672722D6CEBCC1122` in `deployments/prekey-directory.json` |
| `@qorechain/pqc` | 0.2.3 | `src/ts/handshake.ts`, `src/ts/session.ts`, and `src/ts/bundle.ts` import `mlkem1024`. `apps/web/lib/check.ts` imports `mldsa87` and calls `verify` | `test/ts/protocol.test.ts` and `test/ts/vectors.test.ts` run without the chain. On 21 November 2026 the receipt checker read the vendor publish, Carol's publish, and receipt `0x3dfdb6bdf8a11a81792129083642f706a9b4547a62d4d8ebbe3eceb645566a89`. All three signatures passed. It sends nothing |
| `@qorechain/qoreseal` | 0.1.0 | `src/ts/client.ts` imports `signRecipientCard` and `verifyRecipientCard`. `src/ts/handshake.ts` imports `x25519Agree`. `scripts/deploy-directory.ts` imports `fetchKemKey` from `@qorechain/qoreseal/network` | Vendor publish `0x1d38945c94ea384f8d0f4c1338d858d6edc7d34fd54cf2cf251242e44e61555e` in `deployments/prekey-directory.json` |
| `@qorechain/qoresign` | 0.1.0 | `src/ts/receipt.ts` and `src/ts/handshake.ts` import `pqSign` and `pqVerify`. `src/ts/client.ts` imports `signSiwq` | Receipt record `0x3dfdb6bdf8a11a81792129083642f706a9b4547a62d4d8ebbe3eceb645566a89` in `deployments/live-group.json` |
| `@qorechain/mcp` | 0.1.1 | `scripts/evidence.ts` calls the `get_transaction` and `get_pq_status` tools in-process. It does not rewrite `deployments/` | `npm run evidence` passed 30 and failed 0 on 21 November 2026. It sends nothing |
| `@qorechain/qorescan` | 0.1.0 | `scripts/cbom.ts` runs `node_modules/.bin/qorescan` and refuses any contract cryptography outside Keccak and ML-DSA through `pqcVerify` or `pqcKeyStatus` | `npm run cbom:check` passed on 21 November 2026, including the `ecrecover` fixture (4 findings). It is the CI step in `.github/workflows/test.yml` |
| `haven-pq-kit` | v0.1.0 | `src/PrekeyDirectory.sol` and `src/DeliveryReceipts.sol` import `PqAuth`. `src/ts/invoice.ts` imports `encodeInvoice` | Publish `0x1d38945c94ea384f8d0f4c1338d858d6edc7d34fd54cf2cf251242e44e61555e`. The kit stays at the pinned submodule |

`VendorSig` is in the kit. Courier does not import it. Steward's PayGate does. That is a different repository.

## Network features

| Feature | File | Evidence |
| --- | --- | --- |
| Scoped EVM window | `scripts/lib/chain.ts` `withEvmWindow`, used by the directory, MemoPay, and receipt deploys | The open and close hashes in `deployments/prekey-directory.json`, `deployments/memo-pay.json`, and `deployments/delivery-receipts.json` |
| `pqcVerify` at `0x…0a01` | `lib/haven-pq-kit/src/PqAuth.sol`, called by `publish` and `record`. `src/BundleSpike.sol` calls it directly | Tampered directory signature was an `eth_call` and reverted `0x37e8456b`. `deployments/prekey-directory.json` records that text and no transaction for it |
| `pqcKeyStatus` at `0x…0a02` | `lib/haven-pq-kit/src/PqAuth.sol`. `src/ts/chain.ts` reads the same key through `haven-pq-kit/keydir` | `deployments/live-exchange.json` lists `pqcKeyStatus` for both accounts. That run sent no transaction |
| ML-KEM key registry | `scripts/spike-seal.ts` and `scripts/deploy-directory.ts` call `fetchKemKey`. The identity KEM key is checked and is not an encapsulation target | KEM registration `21C0F931CDAAD36BE49FD6BC348EF0025124DAE3FF76167B1F57C84976633790` in `deployments/spike-seal.json`, when that file's key was not already registered |
| Faucet fUSD | `scripts/pay-memo.ts` can swap pool 2 and then convert. The recorded payment did that. Escrow does not | Swap `89BC9AABF4F23F63D5D5A2BB3E651BF5DCEF20DA843C8EEB36C2320A9AE1C38D` and convert `576ACFBDE5A8AB4288F6043A15B5CABE18F71D33DFF74FB1E5D00A705767EBCC` in `deployments/memo-payment.json` |

## Not used, and why

- `@qorechain/evm`. It is not in `package.json`. The chain object is `qorechainDiana` from `haven-pq-kit/network`.
- `@qorechain/qore-cli`. It is not in this `package.json`. `npm run evidence` calls MCP in-process.
- `create-qorechain-dapp`. It is not in `package.json`.
- `@qorechain/wallet-adapter` and `@qorechain/qorex-types`. They are not in `package.json`. The replay site sends nothing.
- A contract call from HavenEscrow into Courier. `src/` does not name HavenEscrow. HavenEscrow does not read PrekeyDirectory, MemoPay, or DeliveryReceipts. One practice receipt is in `deployments/courier-pays.json`. Courier carried that file. The page, not HavenEscrow, read `receipt()`.
