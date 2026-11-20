import { randomBytes } from "@noble/ciphers/utils.js";
import { bytesToHex, type Hex } from "viem";

import { CourierError } from "./bytes.js";
import { toEvm } from "./chain.js";

const WORD = /^0x[0-9a-f]{64}$/;

/**
 * A group is a set of pairwise ratcheted conversations.
 * Removing a member excludes them from all future messages and future file keys.
 * Files and messages they already opened remain readable — Courier makes no claim to claw them back.
 */
export type GroupInfo = {
  id: Hex;
  name: string;
  admin: string;
  epoch: number;
  members: string[];
};

export type GroupTextPayload = {
  t: "group.text";
  groupId: Hex;
  epoch: number;
  body: string;
};

export type GroupFilePayload = {
  t: "group.file";
  groupId: Hex;
  epoch: number;
  id: string;
  key: string;
  hash: string;
  name: string;
  size: number;
};

export type GroupStatePayload = {
  t: "group.state";
  groupId: Hex;
  name: string;
  admin: string;
  epoch: number;
  members: string[];
  removed?: string;
};

export type GroupPayload = GroupTextPayload | GroupFilePayload | GroupStatePayload;

export function newGroupId(): Hex {
  return bytesToHex(randomBytes(32));
}

export function normalizeMembers(addresses: string[]): string[] {
  const unique = new Set<string>();
  for (const addr of addresses) unique.add(toEvm(addr));
  const sorted = [...unique].sort();
  if (sorted.length < 2) throw new CourierError("GROUP", "a group needs at least two members");
  return sorted;
}

export function checkGroupId(groupId: string): Hex {
  if (typeof groupId !== "string" || !WORD.test(groupId)) {
    throw new CourierError("GROUP", "groupId must be 32-byte lowercase hex");
  }
  return groupId as Hex;
}

export function checkGroupPayload(payload: GroupPayload): void {
  checkGroupId(payload.groupId);
  if (!Number.isSafeInteger(payload.epoch) || payload.epoch < 1) {
    throw new CourierError("GROUP", "group epoch must be a positive integer");
  }
  if (payload.t === "group.text") {
    if (typeof payload.body !== "string") throw new CourierError("GROUP", "group text body must be a string");
    return;
  }
  if (payload.t === "group.file") {
    if (
      typeof payload.id !== "string" ||
      typeof payload.key !== "string" ||
      typeof payload.hash !== "string" ||
      typeof payload.name !== "string" ||
      !Number.isSafeInteger(payload.size) ||
      payload.size < 0
    ) {
      throw new CourierError("GROUP", "invalid group file payload");
    }
    return;
  }
  if (payload.t === "group.state") {
    if (typeof payload.name !== "string" || payload.name.length === 0 || payload.name.length > 128) {
      throw new CourierError("GROUP", "group name must be 1..128 characters");
    }
    const admin = toEvm(payload.admin);
    if (!Array.isArray(payload.members) || payload.members.length < 2) {
      throw new CourierError("GROUP", "group state needs at least two members");
    }
    const members = normalizeMembers(payload.members);
    if (!members.includes(admin)) throw new CourierError("GROUP", "group admin must be a member");
    if (payload.removed !== undefined) {
      const removed = toEvm(payload.removed);
      if (removed === admin) throw new CourierError("GROUP", "group admin cannot be removed");
      if (members.includes(removed)) throw new CourierError("GROUP", "removed member is still in members");
    }
    return;
  }
  throw new CourierError("GROUP", "unknown group payload");
}
