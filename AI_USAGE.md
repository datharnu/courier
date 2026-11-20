# How this was written

19–20 November 2026.

## Workflow

Cursor agent sessions (Claude), working from the shared Haven context and the Courier prompt (Prompt 3). The human pasted both.

Commits `97c05cc` to `f16c4dd` are the spike, `PrekeyDirectory`, the handshake, the ratchet, the relay, the client, `MemoPay`, and the relay restart fix.

A second Cursor chat on 20 Nov wrote groups, delivery receipts, safety numbers, the vectors, and `docs/DEMO.md`, and reworked the forward-secrecy test after review.

This session (Claude Opus 5.5) wrote the REST-proxy test, the `DeliveryReceipts` deploy, the live group run, and these documents.

The human approved every step that touched the network or GitHub, and every commit and push.

## What the human decided

- Fail closed.
- Counters must match exactly. Courier keeps no skipped-message keys.
- `MemoPay` stays separate from Steward's PayGate.
- A forwarded invoice is labelled in the web app. The protocol does not change for it.
- `haven-pq-kit` is used by tag `v0.1.0`.
- `steward-agent` stays out of Courier.
- The group demo uses a new account, `courier-carol`.

## What the agent chose, open to change

- `npm run deploy:directory -- <name>` publishes a bundle for an account other than the vendor. It writes that account's own report, `deployments/prekeys-<name>.json`, and never edits `deployments/prekey-directory.json`. A rerun with a live bundle publishes nothing, so it cannot burn entries.
- `npm run fund -- <name>` sends exactly 3 QOR from spike, and does nothing when the account already holds 2 QOR.
- `npm run live:group` refuses to run when its report exists. If it fails after a member has opened a handshake, it still writes the report with `ok: false`, so a rerun cannot use more one-time entries.
- In the live group, Carol posts after her removal through a new handshake with the vendor, because her device never received the removal. That used a second vendor entry.

Choices made in earlier sessions: not recorded.

## Mistakes the agent made and fixed

- A restarted relay could hand out an entry that had already been used. The owner now signs the `spent` list when the bundle is published again.
- A client kept its old cursor after a relay restart and skipped a message. Each relay run has an instance id, and a new id makes the client read from the start.
- The first forward-secrecy test failed on the bundle hash, not on the cryptography. It was rewritten.
- The first swapped-key test used a stubbed reader instead of the real proxy. It was rewritten to send the lie through haven-pq-kit's `createRestProxy`.
