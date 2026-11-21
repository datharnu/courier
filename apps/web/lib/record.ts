export type Viewpoint = "relay" | "spike" | "vendor" | "carol";
export type ThreadKey = "group" | "direct" | "memo";

export type LiveGroup = {
  ok: boolean;
  ranAt: string;
  relay: string;
  directory: string;
  deliveryReceipts: string;
  groupId: string;
  fileIds: string[];
  receipt: {
    conversationId: string;
    counter: number;
    ciphertextHash: string;
    recordHash: string;
    gasUsed: number;
    readBack: { submitter: string; recordedAt: number };
    refusedTamperedSignature: string;
    refusedDuplicate: string;
  };
  members: {
    admin: { name: string; evm: string };
    member: { name: string; evm: string };
    removed: { name: string; evm: string };
  };
};

export type LiveExchange = {
  ok: boolean;
  ranAt: string;
  directory: string;
  bundleHashOnChain: string;
  bundleExpiry: number;
  conversationId: string;
  fileId: string;
};

export type MemoPayment = {
  ranAt: string;
  memoPay: string;
  token: string;
  payer: string;
  payee: string;
  amount: string;
  invoiceId: string;
  memoHash: string;
  ciphertextHash: string;
  conversationId: string;
  payHash: string;
};

export type Row = {
  id: string;
  from: string;
  epoch?: 1 | 2;
  kind?: "state" | "text" | "file" | "receipt" | "payment" | "refusal";
  meta?: { label: string; value: string; copy?: boolean };
  views: Record<Viewpoint, { tone: "open" | "cipher" | "refused" | "absent"; title: string; body: string }>;
};

export type RecordFacts = {
  ok: boolean;
  ranAt: string;
  directory: string;
  deliveryReceipts: string;
  groupId: string;
  fileIds: string[];
  recordHash: string;
  gasUsed: number;
  tampered: string;
  duplicate: string;
  submitter: string;
  recordedAt: number;
  exchange: {
    conversationId: string;
    bundleHash: string;
    fileId: string;
    ranAt: string;
  } | null;
  memo: {
    memoPay: string;
    amount: string;
    invoiceId: string;
    memoHash: string;
    ciphertextHash: string;
    payHash: string;
    ranAt: string;
  } | null;
};

export function factsOf(
  group: LiveGroup,
  exchange?: LiveExchange | null,
  memo?: MemoPayment | null,
): RecordFacts {
  return {
    ok: group.ok,
    ranAt: group.ranAt,
    directory: group.directory,
    deliveryReceipts: group.deliveryReceipts,
    groupId: group.groupId,
    fileIds: group.fileIds,
    recordHash: group.receipt.recordHash,
    gasUsed: group.receipt.gasUsed,
    tampered: group.receipt.refusedTamperedSignature,
    duplicate: group.receipt.refusedDuplicate,
    submitter: group.receipt.readBack.submitter,
    recordedAt: group.receipt.readBack.recordedAt,
    exchange:
      exchange && exchange.ok
        ? {
            conversationId: exchange.conversationId,
            bundleHash: exchange.bundleHashOnChain,
            fileId: exchange.fileId,
            ranAt: exchange.ranAt,
          }
        : null,
    memo: memo
      ? {
          memoPay: memo.memoPay,
          amount: memo.amount,
          invoiceId: memo.invoiceId,
          memoHash: memo.memoHash,
          ciphertextHash: memo.ciphertextHash,
          payHash: memo.payHash,
          ranAt: memo.ranAt,
        }
      : null,
  };
}

export const SAFETY_NUMBER =
  "63690 98402 10244 24502 51612 68035 72615 14375 30442 07313 35177 45415";

export function short(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

export function rows(facts?: RecordFacts | null): Row[] {
  const file1 = facts?.fileIds?.[0] ?? "";
  const file2 = facts?.fileIds?.[1] ?? "";
  return [
    {
      id: "open",
      from: "spike",
      epoch: 1,
      kind: "state",
      views: {
        relay: { tone: "cipher", title: "group.state", body: "Ciphertext to the vendor and to Carol. The relay cannot read the member list." },
        spike: { tone: "open", title: "Haven demo", body: "You created the group. Epoch 1, three members." },
        vendor: { tone: "open", title: "Haven demo", body: "You joined. Epoch 1, three members: spike, you, Carol." },
        carol: { tone: "open", title: "Haven demo", body: "You joined. Epoch 1, three members: spike, the vendor, you." },
      },
    },
    {
      id: "text",
      from: "spike",
      epoch: 1,
      kind: "text",
      views: {
        relay: { tone: "cipher", title: "group.text", body: "One ciphertext each, sealed to that member's ratchet." },
        spike: { tone: "open", title: "Sent", body: "Milestone 1 is ready for review." },
        vendor: { tone: "open", title: "Opened", body: "Milestone 1 is ready for review." },
        carol: { tone: "open", title: "Opened", body: "Milestone 1 is ready for review." },
      },
    },
    {
      id: "file",
      from: "spike",
      epoch: 1,
      kind: "file",
      meta: file1 ? { label: "File ID", value: file1, copy: true } : undefined,
      views: {
        relay: { tone: "cipher", title: "file", body: "The file blob is stored once. Only the 32-byte key travels inside each ratchet message." },
        spike: { tone: "open", title: "milestone-1.json", body: "Sent. The receivers' hashes matched the original." },
        vendor: { tone: "open", title: "milestone-1.json", body: "Opened. The hash matches." },
        carol: { tone: "open", title: "milestone-1.json", body: "Opened. The hash matches. Carol keeps this copy after she is removed." },
      },
    },
    {
      id: "receipt",
      from: "steward-vendor",
      epoch: 1,
      kind: "receipt",
      meta: facts?.recordHash ? { label: "Tx hash", value: facts.recordHash, copy: true } : undefined,
      views: {
        relay: { tone: "cipher", title: "receipt", body: "A signed acknowledgement, ciphertext, addressed to spike." },
        spike: { tone: "open", title: "Receipt #1 · Recorded on chain", body: "Kept, then recorded in DeliveryReceipts. A tampered signature and a second record were both refused." },
        vendor: { tone: "open", title: "Receipt #1 · Signed", body: "You signed this over the message, its counter, and the ciphertext hash." },
        carol: { tone: "absent", title: "No receipt", body: "Receipts go to the sender of the message, not to every member." },
      },
    },
    {
      id: "remove",
      from: "spike",
      epoch: 2,
      kind: "state",
      views: {
        relay: { tone: "cipher", title: "group.state", body: "One ciphertext, to the vendor only." },
        spike: { tone: "open", title: "Epoch 2 · Carol removed", body: "You removed Carol. Later keys are not sealed to her." },
        vendor: { tone: "open", title: "Epoch 2 · Carol removed", body: "Carol is no longer a member." },
        carol: { tone: "absent", title: "Nothing arrived", body: "The removal is not sent to the person being removed." },
      },
    },
    {
      id: "after",
      from: "spike",
      epoch: 2,
      kind: "file",
      meta: file2 ? { label: "File ID", value: file2, copy: true } : undefined,
      views: {
        relay: { tone: "cipher", title: "group.text · file", body: "Both sealed to the vendor. Carol's inbox has neither." },
        spike: { tone: "open", title: "Sent after the removal", body: "Carol has left. milestone-2.json went with it." },
        vendor: { tone: "open", title: "Opened · milestone-2.json", body: "Carol has left. milestone-2.json opened and the hash matches." },
        carol: { tone: "absent", title: "Nothing arrived", body: "A removed member gets no later message and no later file key." },
      },
    },
    {
      id: "refused",
      from: "courier-carol",
      epoch: 2,
      kind: "refusal",
      views: {
        relay: { tone: "cipher", title: "group.text", body: "Carol posted ciphertext to spike and to the vendor. The relay still stores it." },
        spike: { tone: "refused", title: "Refused · GROUP", body: "I am still here. Carol is not in epoch 2, so the plaintext stays sealed." },
        vendor: { tone: "refused", title: "Refused · GROUP", body: "I am still here. Same refusal. Her device still believes she is a member." },
        carol: { tone: "open", title: "Sent", body: "I am still here. Your device was not told about the removal, so it sent this. The others refused it." },
      },
    },
  ];
}

export function directRows(facts?: RecordFacts | null): Row[] {
  const fileId = facts?.exchange?.fileId ?? "";
  return [
    {
      id: "swap",
      from: "relay",
      kind: "refusal",
      meta: facts?.exchange?.bundleHash ? { label: "On-chain hash", value: facts.exchange.bundleHash, copy: true } : undefined,
      views: {
        relay: { tone: "cipher", title: "Swapped bundle offered", body: "Returned a different valid bundle with the same identity ML-KEM key." },
        spike: { tone: "refused", title: "Refused · BUNDLE_HASH", body: "Checked PrekeyDirectory.current(vendor). Hash did not match. Sealed nothing." },
        vendor: { tone: "absent", title: "Nothing arrived", body: "Spike refused the relay's lie before starting a handshake." },
        carol: { tone: "absent", title: "Not in this thread", body: "Direct conversation between spike and steward-vendor." },
      },
    },
    {
      id: "hello",
      from: "spike",
      kind: "text",
      views: {
        relay: { tone: "cipher", title: "handshake · counter 0", body: "ML-KEM-1024 ciphertext, ephemeral X25519 key, ML-DSA-87 signature, and AEAD ciphertext." },
        spike: { tone: "open", title: "Sent · One-time entry #1", body: "Invoice INV-0007 is ready. Reply to confirm the payee." },
        vendor: { tone: "open", title: "Opened · Entry #1 wiped", body: "Invoice INV-0007 is ready. Reply to confirm the payee." },
        carol: { tone: "absent", title: "Not in this thread", body: "Direct conversation between spike and steward-vendor." },
      },
    },
    {
      id: "confirm",
      from: "steward-vendor",
      kind: "text",
      views: {
        relay: { tone: "cipher", title: "message · counter 0", body: "XChaCha20-Poly1305 ciphertext on vendor→spike chain." },
        spike: { tone: "open", title: "Opened", body: "Confirmed. Pay the registered payout address." },
        vendor: { tone: "open", title: "Sent", body: "Confirmed. Pay the registered payout address." },
        carol: { tone: "absent", title: "Not in this thread", body: "Direct conversation between spike and steward-vendor." },
      },
    },
    {
      id: "inv-file",
      from: "steward-vendor",
      kind: "file",
      meta: fileId ? { label: "File ID", value: fileId, copy: true } : undefined,
      views: {
        relay: { tone: "cipher", title: "file · 84 bytes", body: "Encrypted blob stored once. Random 32-byte file key travels inside the ratchet." },
        spike: { tone: "open", title: "INV-0007.json · 84 bytes", body: "Opened and verified. Plaintext hash matched the sender's commitment." },
        vendor: { tone: "open", title: "INV-0007.json · Sent", body: "File sealed with a random 32-byte key and sent over the ratchet." },
        carol: { tone: "absent", title: "Not in this thread", body: "Direct conversation between spike and steward-vendor." },
      },
    },
    {
      id: "queued",
      from: "spike",
      kind: "text",
      views: {
        relay: { tone: "cipher", title: "message · counter 1", body: "XChaCha20-Poly1305 ciphertext on spike→vendor chain." },
        spike: { tone: "open", title: "Sent", body: "Received. Queued for payment." },
        vendor: { tone: "open", title: "Opened", body: "Received. Queued for payment." },
        carol: { tone: "absent", title: "Not in this thread", body: "Direct conversation between spike and steward-vendor." },
      },
    },
  ];
}

export function memoRows(facts?: RecordFacts | null): Row[] {
  const memo = facts?.memo;
  return [
    {
      id: "invoice",
      from: "steward-vendor",
      kind: "payment",
      meta: memo ? { label: "Ciphertext hash", value: memo.ciphertextHash, copy: true } : undefined,
      views: {
        relay: { tone: "cipher", title: "invoice · ciphertext", body: "Encrypted Steward invoice struct. The relay sees only ciphertext and size." },
        spike: { tone: "open", title: "Verified invoice · 10,000 fUSD", body: "INV-0007 verified against vendor's on-chain ML-DSA-87 key and memoHash." },
        vendor: { tone: "open", title: "Signed invoice sent", body: "Signed with VendorSig.encode (chain 9800) and sealed inside the ratchet." },
        carol: { tone: "absent", title: "Not in this thread", body: "Private invoice payment between spike and steward-vendor." },
      },
    },
    {
      id: "memopay",
      from: "spike",
      kind: "receipt",
      meta: memo ? { label: "Pay tx", value: memo.payHash, copy: true } : undefined,
      views: {
        relay: { tone: "cipher", title: "On-chain MemoPay.pay", body: "132 bytes of calldata: token, payee, 10,000, and keccak256(ciphertext). No plaintext memo." },
        spike: { tone: "open", title: "Paid 10,000 base units fUSD", body: "Committed keccak256(ciphertext) on MemoPay. Contract balance stayed 0." },
        vendor: { tone: "open", title: "Received 10,000 base units fUSD", body: "Payment matched the ciphertext hash of your encrypted invoice." },
        carol: { tone: "absent", title: "Not in this thread", body: "Private invoice payment between spike and steward-vendor." },
      },
    },
  ];
}
