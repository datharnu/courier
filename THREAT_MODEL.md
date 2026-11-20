# Threat model

Courier carries messages and files between QoreChain addresses. The question is what a relay, a proxy, or a later thief can still open.

## What is protected

Message and file contents are readable only by the recipient's current device. Every published key is bound to the owner's on-chain ML-DSA-87 key. The handshake names which one-time entry was used. The memo behind a MemoPay payment stays off chain: the contract stores only keccak256 of the ciphertext. Group membership is the set the admin wrote.

## Who it protects against

A relay that lies, delays, drops, or swaps a bundle, a card, or a key. A REST proxy that swaps a KEM key. A passive network observer, and someone harvesting ciphertext now to decrypt it later: the handshake uses ML-KEM-1024 and X25519. Someone who later steals the long-term keys cannot open earlier messages or files. A removed group member gets no later keys. A stranger posting into an inbox is refused unless the post is signed, or it passes the conversation's AEAD.

## Not protected

The relay sees who messages whom, when, and the sizes. A device that is compromised now can read what that device can already open. The limits in the README's Limitations section still apply:

- If the ratchet slips, forward secrecy comes only from one-time prekeys that have already been used up.
- One dropped message stalls that direction of the conversation for good.
- If one side keeps sending and the other never replies, no ML-KEM step completes.
- The relay keeps its state in memory.
- A removed member keeps every message and file they already opened.
- A forwarded invoice still verifies.
- Safety numbers use SHA-256 and are not compatible with Signal.

The relay can drop everything, so availability is not protected. Nothing here has been audited.
