# Testnet deployments

Network `qorechain-diana`, EVM chain id 9800. Every hash below is in a file under `deployments/`. The directory and vendor-bundle hashes are in `deployments/prekey-directory.json`, which `npm run deploy:directory` wrote. Each later section names its own file.

## PrekeyDirectory

`0x3d9a5821d0a24220a5f244a63a4a641d2acd9c2d`, deployed by the spike account `0xaC52f45E6787c08E3B22f45e7f35803Fc13e7396`.

| Transaction | Hash | Gas used |
| --- | --- | --- |
| Open the window | `CF5B4B70C6AA866624CC7275C6C3420A825A0B76A635E50672722D6CEBCC1122` | |
| Deploy | `0x68e262aad138342bf1f299d28b4cd2fa01724c6fce69e2c6c4f9f65f11830d76` | 383,084 |
| Close the window | `4D0968D5E2262E28097D3B5913BF0A0C2F1B1F48302339CCE38AD7DC4C1F11C8` | |

The first deploy attempt was refused before it ran. Its window capped value at 1 uqor, and a window's cap also pays gas, which was 43,097 uqor. Nothing was deployed by that attempt.

## The vendor's bundle

`steward-vendor` (`qor17zwvy05e9fzerfzksdkhygm92wvapwusvh4zfv`, `0xf09cc23e992a4591a456836d7223655399d0bb90`) published a bundle of 20 one-time entries. Its identity ML-KEM key is the one in the chain's KEM registry.

| Step | Hash | Gas used |
| --- | --- | --- |
| Fund the vendor, 1 QOR from the spike account | `51178F742538204C30B2DFBB24D17A90147E03FF53FBC55EC19DB1983E8277E3` | |
| Open the window, one transaction, target the directory only | `BCC1F3557A33A566389C82376DA5A03B748816260D88B514EAE3E96DE076EF74` | |
| Publish | `0x1d38945c94ea384f8d0f4c1338d858d6edc7d34fd54cf2cf251242e44e61555e` | 280,769 |
| Close the window | `87D85A5B2FB1CBB5C4D279D08354D01CC107996F024921B64AA9A5529CD931E1` | |

The stored hash is `0x9306826eb46977b32639a004ad992c868c5614d703fbb9a8e8cc08309b13e79f`. `deployments/bundles/steward-vendor.json` hashes to it. `current(vendor)` read back that hash, expiry `1795723898`, and `live = true`.

Inside the same window, before the publish, an `eth_call` of `publish` with one byte of the signature changed reverted with `0x37e8456b`, `SignatureInvalid()`. `scripts/probe-directory.ts` repeats that with a fresh hash and sends nothing.

## A live exchange through the relay

`npm run live` starts the relay on 127.0.0.1 and reads the real chain. `spike` and `steward-vendor` exchange messages through it, and the result is written to `deployments/live-exchange.json`. It sends no transactions.

The first run was on 19 Nov 2026 at 20:47 UTC.

1. A relay that swapped the vendor's bundle for another valid bundle with the same identity KEM key was refused with `BUNDLE_HASH`. Nothing was sealed.
2. `spike` opened conversation `0xea94595b…798d3fcd` on one-time entry 1. The vendor's client read `PrekeyDirectory.current`, the KEM registry, and `pqcKeyStatus` for both accounts before it accepted.
3. The vendor replied, then sent `INV-0007.json`, 84 bytes, as file `0x4a37b897…2662ca2a`. `spike` opened it and the hash matched.
4. `spike` answered.

The vendor's client then erased entry 1's secrets from `~/.haven/courier/steward-vendor.prekeys.json`.

The bundle expires on 26 Nov 2026, 20:11 UTC. That is before judging. Run `npm run renew` (a read-only dry run) to see what is due, then `npm run renew -- --send` before a live demo. It publishes a new bundle for each owner inside the window and appends the new hash to `deployments/renewals.json`, leaving this file's recorded publish untouched. (`npm run deploy:directory` also publishes, but rewrites this file.) The secret half of the bundle is in `~/.haven/courier/steward-vendor.prekeys.json`, mode 0600, outside the repository.

## MemoPay

`0x0fef978df64a5516e9f52ba1f4b2bbea6b7bd98c`, deployed by the spike account. The token is fUSD, `0x97143B771D34ddb9130b807b135Ae675A5a963CA`. Every hash below is in `deployments/memo-pay.json` and `deployments/memo-payment.json`.

| Transaction | Hash | Gas used |
| --- | --- | --- |
| Open the deploy window | `BCF8641F1840C83DBB5E41305348FA20BEEA81F7597EFB91E67F61B3BC67A932` | |
| Deploy | `0x09200f2613ea03f0b72a4c96a197ce511e170be268af66ceae9ae0f636919145` | 429,809 |
| Close the deploy window | `C3A763F72BF23C102E7FFBF2355B49D4A93CE28ABEF5CFFDBB8AC1F25A7DA918` | |

Spike held no fUSD. `npm run pay:memo` bought some from pool 2, spending at most 400,000 uqor, and converted it to the ERC-20. The swap is `89BC9AABF4F23F63D5D5A2BB3E651BF5DCEF20DA843C8EEB36C2320A9AE1C38D`. The conversion is `576ACFBDE5A8AB4288F6043A15B5CABE18F71D33DFF74FB1E5D00A705767EBCC`.

The vendor then sent an invoice through the relay. The memo names INV-0007 and the registered payout. Its text hash is `0x72e49759675f787b7d1e922a5e77134e70b1a569dad6f1c59e75ea4af86f9430`. That is not the hash on chain. The chain hash is keccak256 of the ciphertext, `0x588d5e7381c6e9412ab5b37063931fbc57ce930c26c1cfbc0d26d5d344e1eb6b`. The ciphertext is in `deployments/memo-payment.json`. The payment calldata is 132 bytes: token, payee, 10,000, hash. It does not contain the memo.

| Step | Hash | Gas used |
| --- | --- | --- |
| Open the window, two transactions, fUSD and MemoPay only | `AE0EB1E3C4F1768794F8420006E9EC2110E71D116311C2E6D7A662424C53D27B` | |
| Approve 10,000 | `0xb417daf32271680307666daa7d80d745a8acddac3c6d6857eadedc56dcf5777f` | |
| Pay | `0xad3500fd93af8d5b95e51da69fe683382d2679c4291871ada7d7f06a31e245c4` | 161,541 |
| Close the window | `B15D3AAFB4DC64454042D5050FB842F1FD5976B76B91978A6EA593759D63B162` | |

`payment(spike, ciphertextHash)` read back the vendor, fUSD, 10,000, and timestamp `1795122861` (19 Nov 2026, 21:14 UTC). Spike holds 2,000 fUSD after the payment. The vendor holds 45,000, which is the 35,000 already there from Steward plus these 10,000. PayGate was not called, so this invoice is not marked paid there. Another one-time entry was used, and its secrets were erased from the vendor's prekey file.

## DeliveryReceipts

`0x06b52afc4a151b0efa260e2adcdf2d477632cb56`, deployed by the spike account `0xaC52f45E6787c08E3B22f45e7f35803Fc13e7396`. Every hash below is in `deployments/delivery-receipts.json`.

| Transaction | Hash | Gas used |
| --- | --- | --- |
| Open the window | `55EE81BB9B349C7A536CF0D6A5D04D2C75F81A19C9957BF90EE36DC305B4C04B` | |
| Deploy | `0x5a337df9f24a0e8cae648c3fe2d145f4ce4182a3602184efcb172f8f86e1bc07` | 443,818 |
| Close the window | `6A13C6A213400930D79A361990806040F058C9F49CAC317DCB03C1445D8A0E35` | |

## Live group

`npm run live:group` ran on 20 Nov 2026 at 12:05 UTC. The relay was in-process, real HTTP on 127.0.0.1, with its state in memory. The result is `deployments/live-group.json`. Carol's bundle publish is in `deployments/prekeys-courier-carol.json`.

| Account | Cosmos | EVM |
| --- | --- | --- |
| spike, the admin | `qor143f0ghn8slqguwez73087dvq8lqnuuukqdu9fl` | `0xac52f45e6787c08e3b22f45e7f35803fc13e7396` |
| steward-vendor | `qor17zwvy05e9fzerfzksdkhygm92wvapwusvh4zfv` | `0xf09cc23e992a4591a456836d7223655399d0bb90` |
| courier-carol, removed | `qor1tacy6fv8x0jveznhdmyrqc2yep83awk07v3tf4` | `0x5f704d258733e4cc8a776ec8306144c84f1ebacf` |

Carol published bundle `0x157c35bd5c1ffd5eb7606d33bc93183096184fc438155048e5d5bd5f07dbf6f0`. The directory read back the same hash, expiry `1795779952` (27 Nov 2026, 11:45 UTC), and `live = true`.

| Step | Hash | Gas used |
| --- | --- | --- |
| Open the window, one transaction, target the directory only | `38610C76C6C777DCBD1AF75512207C953E980621A62166FB816E723BE76B2A9C` | |
| Publish | `0x994a39fc67a0082ac29cb0932ce95e1e4d8f1df0893325b808d4fb89b835adf0` | 280,805 |
| Close the window | `067A4144D4C8A9B4EE42CA8B708DA775E6E7187F5BD449FEFD99C0CBBC265FE8` | |

The group id is `0x4d3a0e94e5f4dbeb76d18d970f439fe5a96974109db08e8c3924b288fe3314c0`. Spike's conversation with Carol is `0x0fa07424344bb0746d5901f65a6c1551bbb543f1790c47dedb13ad161326b730`. Spike's conversation with the vendor is `0xee9e929e97f3b026bd1c537e98d628c60005d8d522b74a4104d94055012cb714`. The two files are `0xc52b4782b82ef146616dc66fcefe984287c636494f7239e2c04c30098436e907` and `0xb8c1a0f8c51f32949d8a8b258aad0e0ee090422d64e5d76b32a7c98675b15658`.

The report's result lines:

1. Spike creates the group. Vendor and Carol each got `group.state 0x4d3a0e94`.
2. Spike sends a group message. Both got `group.text 0x4d3a0e94`.
3. Spike sends a group file. Both got `opened, hash matches`.
4. The vendor signs a receipt and spike records it. Spike got `receipt #1`.
5. Spike removes Carol. The vendor got `group.state 0x4d3a0e94`.
6. Spike sends a message and a file after the removal. The vendor got `opened, hash matches`.
7. Carol posts after being removed. Spike and the vendor each got `refused GROUP`.

The receipt is conversation `0xee9e929e97f3b026bd1c537e98d628c60005d8d522b74a4104d94055012cb714`, counter 1, ciphertext hash `0xfc27eb2fe70148486add26083d5b15ccdbd8e5a2ad9b913280fe9349fb4e6e4f`, recipient `0xf09cc23e992a4591a456836d7223655399d0bb90`. Before the transaction, an `eth_call` with one signature byte changed reverted with `0x37e8456b`. A second `record` of the same receipt reverted with `0x05a64c20fcc38f7349ad17d9a3856ce1534b8785596f0bc0b5e10b25c781451bd65c8e37`.

| Transaction | Hash | Gas used |
| --- | --- | --- |
| Open the window, one transaction, target DeliveryReceipts only | `B794E7BF8F7E88E2F5BA19CB08767E2849D14AAE2AA435E96A62FABEE43CEC51` | |
| Record | `0x3dfdb6bdf8a11a81792129083642f706a9b4547a62d4d8ebbe3eceb645566a89` | 288,262 |
| Close the window | `19899043358A3BA0E192B52728EB0A80A184564A4C3D5379DA4A59E8E9C6D536` | |

`receipt(...)` read back submitter `0xac52f45e6787c08e3b22f45e7f35803fc13e7396` and `recordedAt` `1795176375` (20 Nov 2026, 12:06 UTC).

The report's used one-time entries are steward-vendor `0, 1, 2, 3` and courier-carol `0`. `deployments/live-exchange.json` had already recorded vendor entry 1.
