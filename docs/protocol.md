# Courier protocol

The directory, the handshake, the ratchet, file keys, the relay, the client, and MemoPay are in `src/`. Groups, delivery receipts, and the web app are not. The directory and MemoPay are on testnet. The hashes are in `docs/deployments.md`.

A message is readable only by the recipient's current device. The relay stores ciphertext. A key published later cannot open messages sent earlier.

## What is signed, and by which key

| Object | Key | Checked where |
| --- | --- | --- |
| ML-KEM-1024 identity key | The account, via `MsgRegisterKEMKey` | The chain's KEM registry |
| Recipient card (that KEM key, plus X25519) | The account's ML-DSA-87 key | The sender, against `pqcKeyStatus`, before sealing |
| Prekey bundle | The account's ML-DSA-87 key, over `(chainid, directory, owner, keccak256(bundle), expiry)` | `PrekeyDirectory` calls `pqcVerify` at publish. The relay's copy is kept only if it hashes to the stored value |
| First message of a conversation | The sender's ML-DSA-87 key, via QoreSign | The recipient, against the sender's on-chain key |
| Later messages | The ratchet's MAC, inside the AEAD | The recipient. A bad tag is a drop, not a decrypt |
| Invoice | The vendor's ML-DSA-87 key, over `VendorSig.encode` `(chainid, gate, vendor, payee, token, amount, invoiceId, dueDate, memoHash)` | The recipient, against the vendor's on-chain key, before the invoice is payable |
| Memo payment | Nothing. The payer spends their own tokens. The memo's integrity is keccak256 of the Courier ciphertext | `MemoPay` stores that hash. It does not see the memo |

The bundle signature uses the same shape `BundleSpike.publish` already ran on testnet.

## Bundle

A bundle is canonical JSON, keys sorted, no undefined values. Its hash is keccak256 of those bytes. That is the hash stored on chain.

The bundle contains:

- the identity ML-KEM-1024 public key, which must equal the registry
- one signed X25519 prekey
- one signed last-resort ML-KEM-1024 prekey, used when no one-time KEM key is left
- 20 one-time entries, each an ML-KEM-1024 public key and an X25519 public key, numbered 0 to 19
- an expiry, unix seconds, at most 7 days ahead

The relay holds the bundle exactly as signed. It never edits it. The chain's state holds the hash and the expiry. `pqcVerify` checks the signature at publish, and the signature stays in the transaction and the `Published` event rather than in storage: it is 4,627 bytes. A bundle that hashes to something else is refused before a handshake starts. An expired bundle is refused. A failed signature, or a first message whose tag fails, does not consume the one-time entry.

Consuming a one-time entry does not change the bundle. The relay answers a fetch with the whole signed bundle plus the index of an entry it has not handed out yet. The sender checks the hash, then uses that entry. The relay can lie about which entries are left. If it hands one entry to two senders, the recipient accepts the first handshake, deletes that entry's secret keys, and refuses the second. The second sender starts again with a new index, or with the last-resort prekey. A refused reuse is never decrypted with a weaker key.

The owner publishes a new bundle, and a new on-chain hash, when the entries run low or a week has passed. The signed X25519 prekey and the last-resort ML-KEM prekey change with every bundle, so neither is a long-term key.

## Handshake

Modelled on PQXDH, with the same four X25519 terms as X3DH. The shared secret is HKDF-SHA-256 over the concatenation of:

1. X25519 between the sender's identity X25519 key (from its card) and the recipient's signed prekey
2. X25519 between the sender's ephemeral key and the recipient's identity X25519 key
3. X25519 between the sender's ephemeral key and the recipient's signed prekey
4. X25519 between the sender's ephemeral key and the one-time X25519 key of the chosen entry, when an entry is used
5. ML-KEM-1024 from the sender to the one-time KEM key of the chosen entry, or to the last-resort prekey when none is left

The identity ML-KEM key is never an encapsulation target. Its job is to bind the bundle to the registry. A message sealed to it would open for anyone who later stole that key.

The first message carries the ephemeral X25519 public key, the KEM ciphertext, which one-time keys were used, and an ML-DSA-87 signature over the handshake transcript. The recipient verifies that signature against the sender's current on-chain key before deriving the secret.

## Ratchet

Each message gets a new symmetric key from HKDF, then the old one is deleted. The AEAD is XChaCha20-Poly1305 from `@noble/ciphers`. The nonce is random, 24 bytes, and is stored with the ciphertext. The AAD is `sender | recipient | conversationId | counter`, plus the KEM public key and ciphertext when the message carries them. A wrong counter, a swapped sender, or a reordered message fails the tag.

The KEM ratchet uses keys made for that step alone, modelled on Signal's sparse post-quantum ratchet. Long-term keys are not used, so stealing them later does not open messages already sent. Each direction has its own root and chain. A step in one direction never touches the other, so messages already in flight the other way still open.

1. A offers a fresh ML-KEM-1024 public key (1,568 bytes) with a message.
2. B's next message encapsulates to it (a 1,568-byte ciphertext). That message, and every later one from B, uses a new B-to-A root and chain. A's secret key is deleted when that message opens.
3. Because A's offer carried no ciphertext, B's message also carries a counter-offer.
4. A's next message encapsulates to B's key and rekeys A-to-B the same way. That message carries a ciphertext, so it does not start another round.

A step starts every 20 messages a party sends, and on the next message after a device says it may have been copied (`markCopied`). Each direction is rekeyed only when the other side sends. If one side keeps sending and the other never answers, no step completes. Those messages rely on the symmetric chain only, so a stolen ratchet state opens them until a reply arrives.

Within a direction, messages are applied in counter order. A copy of A made before A's offering secret existed cannot open B's message that completes the step, or anything after it. A copy that already holds that secret can finish that one step, and stops at the next secret created after the copy.

## Files and groups

A file gets its own random 32-byte key. The file is AEAD'd with that key and stored on the relay. The key and the file's hash travel inside an ordinary ratchet message to each recipient. The file key is never sealed to a long-term key, so a key stolen later opens no file sent earlier.

A group is a set of pairwise conversations. A group message is encrypted once per member, through that member's own ratchet, with a group id in the AAD. A large file is stored once, and only the 32-byte key is sent per member. Removing someone means they are left out of later messages and get no later file keys. Files and messages they already opened stay opened. There is no claim otherwise. The demo group has three members.

## Relay

The relay stores ciphertext under the recipient address. It never sees a key or a plaintext. Reading an inbox needs a Sign In With QoreChain token. The sign-in must carry an ML-DSA-87 signature that verifies under the account's on-chain key, and its nonce works once, for the address it was issued to. A read of someone else's inbox is refused.

Anyone can post to an inbox. A first message must be ML-DSA-signed by its sender, and a later one must pass its conversation's AEAD, so a stranger's post is refused, not read. The relay caps a message at 64 KiB, a file at 4 MiB, and an inbox at 1,000 items. That is the only spam control in this version.

The relay checks what it stores, so honest clients are not handed junk. A bundle must hash to `PrekeyDirectory.current`. A recipient card must verify under the chain's ML-DSA key and name the registry KEM key. A file's id must be the keccak256 of its ciphertext. Those checks do not make the relay trusted. The client repeats every one against the chain itself.

The relay is allowed to lie, delay and drop. The client treats a bundle whose hash is not the on-chain hash as a lie. It treats a card that the chain's keys do not verify, or that names a KEM key other than the registry's, as a lie. It shows that refusal and does not fall back to what was offered. If one entry is handed to two senders, the first handshake opens and the second is refused.

The relay in this version keeps state in memory. A restart loses inboxes and files, and forgets which entries it has handed out. A forgotten entry can then be handed out twice. The recipient still refuses the second handshake.

An optional delivery receipt is an ML-DSA signature by the recipient over `(conversationId, counter, ciphertext hash)`. The sender can store it. The demo records one.

## What a test has to refuse

- An outsider, holding neither device key, opens nothing.
- A KEM key swapped by the REST proxy is refused, and the real key from a direct read still works.
- A bundle whose bytes do not hash to the chain is refused.
- A one-time entry handed to two senders opens the first handshake and refuses the second.
- A replayed message and a message with a skipped counter are refused.
- An AAD with the sender and recipient swapped fails.
- After N messages, the identity ML-KEM key, the identity X25519 key, and the ML-DSA key together are not enough to open messages 1..N, or any file sent with them.
- A copy made before the offering secret existed cannot open the reply that completes the step, or anything after it. A copy that already holds that secret can finish that one step, and cannot follow a later secret it does not hold.
- An invoice whose memo text does not hash to `memoHash`, or whose vendor signature does not match the vendor's on-chain key, is refused.
- `MemoPay` refuses a zero hash, a zero amount, a payment to the payer, to itself, or to the token, a second record of the same ciphertext by the same payer, and a token that does not move the exact amount from the payer to the payee.

## Memo payment

`MemoPay` sends fUSD from the payer to the payee and stores the keccak256 of a Courier ciphertext. That ciphertext is the encrypted memo. The contract has no function that accepts the memo, the ciphertext, or an invoice. The call is four words: token, payee, amount, hash.

The memo is a Courier message of type `invoice`. It carries the vendor-signed invoice Steward already verifies: vendor, payee, token, amount, invoice id, due date, the keccak256 of the memo text, and the ML-DSA-87 signature. The recipient checks that hash against the memo text, then checks the signature against the vendor's current on-chain key. A mismatch is refused. The plaintext stays on the device that can open the ratchet.

The same payer cannot record the same ciphertext twice. Another payer can commit to the same hash, because the record is keyed by the payer and the hash. The contract never holds the tokens. The payee's balance must rise by the amount, the payer's must fall by the amount, and `MemoPay`'s own balance must not change. A token that does anything else is refused.

This payment does not mark the invoice used in Steward's PayGate. The gate holds a different balance and still requires its own check. An invoice paid here can still be paid there until Steward's adapter skips it.

The hash commits to the ciphertext, not to the words inside it. Someone who has not opened the message can confirm the hash and nothing more.

## Not in this draft

Groups, delivery receipts, and the web app.
