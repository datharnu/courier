# Spikes

19 November 2026, qorechain-diana. These are the three checks Courier had to pass before any protocol code.

## 1. ML-KEM-1024 registry

The sender already had a key. The recipient did not, so this run published one and read it back.

| | Address | Key |
| --- | --- | --- |
| Sender (`spike`) | `qor143f0ghn8slqguwez73087dvq8lqnuuukqdu9fl` | 1,568 bytes, already on chain |
| Recipient (`steward-vendor`) | `qor17zwvy05e9fzerfzksdkhygm92wvapwusvh4zfv` | 1,568 bytes |

`MsgRegisterKEMKey` for the recipient: `21C0F931CDAAD36BE49FD6BC348EF0025124DAE3FF76167B1F57C84976633790`, code 0, height 10390401, gas wanted 600,000, gas used 268,160.

`GET /qorechain/pqc/v1/kem/{recipient}` then returned `found=true`, algorithm `mlkem1024`, and the same 1,568 bytes that QoreSeal derived from that account. The library's own length constant is 1,568. Nothing here disagreed with it.

## 2. Seal and open

One hybrid QoreSeal envelope, purpose `courier.spike.v1`, from the sender to the recipient. The recipient was resolved with `sealToAddresses`: the ML-KEM key came from the registry, and the X25519 key came from a recipient card signed by the recipient's ML-DSA-87 key.

| | Bytes |
| --- | --- |
| Plaintext | 44 |
| Envelope | 1,764 |
| `envelopeSize({ hybrid, 1 recipient, 44 })` | 1,764 |
| `qoreseal:` text form | 2,361 |

The formula in QoreSeal is `56 + recipients * 1664 + plaintext` for hybrid mode. 56 + 1664 + 44 = 1,764. The bytes matched.

The recipient opened it and the plaintext matched. The sender's own keys could not open it.

## 3. Gas to store a signed bundle hash

`BundleSpike` at `0xea1ca181ca3cc636df65eb68af4921275dfbcad9` stores one hash. `publish` checks the caller's ML-DSA-87 key with `pqcKeyStatus` and `pqcVerify`, over `abi.encode(chainid, contract, caller, bundleHash, expiry)`, then writes the hash.

| Transaction | Hash | Gas |
| --- | --- | --- |
| Open the window | `BCAAEA63156CDDF1592F9BA60CBD901664DB3656D570C515583688611F93846C` | |
| Deploy | `0x8a88fe4c6c55e3df14e2e6a84197df0c62b25810cc97df884623cce37c11633e` | 312,801 |
| Publish | `0x83b37bf6c8e8d177558ecddf1371d5fcc74dffb5aa03b87e6fd85bac32d4093f` | 241,603 |
| Close the window | `8E8B5AE73EE5D09472366CE3C165C082A757D91D819D8B7D71B78153E795DF53` | |

241,603 is the whole `publish` transaction, including the key lookup, the ML-DSA check and the store. A bare `pqcVerify` of a longer message, measured earlier by the kit, was about 321,000. This call is cheaper because the signed message is one ABI encoding, not a 256-byte probe.

The stored hash is `0x182f99e4aefceeb5579e9ebe38842fa91f560bf0526e4ae0bf4f3c4898d7cb38`.
