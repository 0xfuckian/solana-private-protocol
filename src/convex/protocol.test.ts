/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { appendNote, hashPair, TREE_DEPTH, FIELD } from "./merkle";

const modules = import.meta.glob("./**/*.ts");
const commitment = (n: number) => n.toString(16).padStart(64, "0");
const sealed = { ephemeral: "test", nonce: "test", ciphertext: "test" };

describe("persistent Merkle scaffold", () => {
  it("appends leaves and produces a verifiable current path", async () => {
    const t = convexTest(schema, modules);
    for (let n = 1; n <= 4; n++) await t.run(ctx => appendNote(ctx, { commitment: commitment(n), sealed, slot: n, createdAt: n }));
    const path = await t.query(api.merkle.getPath, { commitment: commitment(2) });
    expect(path.siblings).toHaveLength(TREE_DEPTH);
    let hash = (BigInt(`0x${commitment(2)}`) % FIELD).toString();
    for (let i = 0; i < TREE_DEPTH; i++) hash = path.pathIndices[i] ? hashPair(path.siblings[i], hash) : hashPair(hash, path.siblings[i]);
    expect(hash).toBe(path.root);
    expect(path.leafIndex).toBe(1);
  });
  it("retains only the latest 100 roots", async () => {
    const t = convexTest(schema, modules);
    for (let n = 1; n <= 101; n++) await t.run(ctx => appendNote(ctx, { commitment: commitment(n), sealed, slot: n, createdAt: n }));
    const roots = await t.run(ctx => ctx.db.query("merkleRoots").collect());
    expect(roots).toHaveLength(100);
    expect(Math.min(...roots.map(root => root.leafCount))).toBe(2);
  });
  it("rejects commitment replay atomically", async () => {
    const t = convexTest(schema, modules);
    const note = { commitment: commitment(1), sealed, slot: 1, createdAt: 1 };
    await t.run(ctx => appendNote(ctx, note));
    await expect(t.run(ctx => appendNote(ctx, note))).rejects.toThrow("already exists");
    expect(await t.run(ctx => ctx.db.query("notes").collect())).toHaveLength(1);
  });
  it("does not silently index legacy notes", async () => {
    const t = convexTest(schema, modules);
    await t.run(ctx => ctx.db.insert("notes", { commitment: commitment(1), sealed, slot: 1, createdAt: 1 }));
    await expect(t.query(api.merkle.getPath, { commitment: commitment(1) })).rejects.toThrow("migration");
  });
  it("keeps faucet receipts outside the spendable tree", async () => {
    const t = convexTest(schema, modules);
    await t.run(ctx => appendNote(ctx, { commitment: commitment(1), sealed: { ...sealed, ephemeral: "faucet" }, slot: 1, createdAt: 1 }));
    expect(await t.run(ctx => ctx.db.query("merkleState").first())).toBeNull();
  });
});

describe("transfer validation boundaries", () => {
  async function fixture() {
    const t = convexTest(schema, modules);
    const user = await t.run(ctx => ctx.db.insert("users", {}));
    const identity = t.withIdentity({ subject: user });
    await identity.mutation(api.protocol.registerWallet, { address: "B".repeat(44), commitment: commitment(600), fundingLamports: 1_000_000 });
    const args = { nullifiers: ["a".repeat(64)], receiver: "C".repeat(44), amount: 1000, receiverCommitment: commitment(700), sealedNote: { ephemeral: "A".repeat(22) + "==", nonce: "A".repeat(16), ciphertext: "A".repeat(683) + "=" }, changeNote: { ephemeral: "none", nonce: "none", ciphertext: "none" }, changeCommitment: "", proof: "invalid" };
    return { t, identity, args };
  }
  it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects unsafe transfer value %s without spending", async amount => {
    const { t, identity, args } = await fixture();
    await expect(identity.mutation(api.protocol.sendPrivate, { ...args, amount })).rejects.toThrow();
    expect(await t.run(ctx => ctx.db.query("nullifiers").collect())).toHaveLength(0);
  });
  it.each([{ values: [] as string[] }, { values: ["invalid"] }, { values: ["a".repeat(64), "a".repeat(64)] }])("rejects invalid input nullifiers $values", async ({ values: nullifiers }) => {
    const { identity, args } = await fixture();
    await expect(identity.mutation(api.protocol.sendPrivate, { ...args, nullifiers })).rejects.toThrow();
  });
  it("keeps a spent nullifier invalid across slots", async () => {
    const { t, identity, args } = await fixture();
    await t.run(ctx => ctx.db.insert("nullifiers", { value: args.nullifiers[0], slot: 1 }));
    await expect(identity.mutation(api.protocol.sendPrivate, args)).rejects.toThrow("double spend");
  });
  it("rejects malformed ciphertext before publishing outputs", async () => {
    const { t, identity, args } = await fixture();
    await expect(identity.mutation(api.protocol.sendPrivate, { ...args, sealedNote: { ...args.sealedNote, nonce: "bad" } })).rejects.toThrow("Malformed sealed");
    expect(await t.run(ctx => ctx.db.query("envelopes").collect())).toHaveLength(0);
  });
  it("rejects malformed tree commitments atomically", async () => {
    const t = convexTest(schema, modules);
    await expect(t.run(ctx => appendNote(ctx, { commitment: "bad", sealed, slot: 1, createdAt: 1 }))).rejects.toThrow("Malformed commitment");
    expect(await t.run(ctx => ctx.db.query("notes").collect())).toHaveLength(0);
  });
});

describe("operational safety", () => {
  it("allows an admin to pause, blocks ledger mutations, and allows resume", async () => {
    const t = convexTest(schema, modules);
    const admin = await t.run(ctx => ctx.db.insert("users", { role: "admin" }));
    const identity = t.withIdentity({ subject: admin });
    await identity.mutation(api.protocol.registerWallet, { address: "B".repeat(44), commitment: commitment(500), fundingLamports: 1000 });
    await identity.mutation(api.operations.setPaused, { paused: true });
    expect((await t.query(api.operations.getStatus, {})).paused).toBe(true);
    await expect(identity.mutation(api.protocol.faucet, { lamports: 100 })).rejects.toThrow("emergency pause");
    await identity.mutation(api.operations.setPaused, { paused: false });
    expect((await t.query(api.operations.getStatus, {})).paused).toBe(false);
  });
  it("rejects non-admin pause controls", async () => {
    const t = convexTest(schema, modules);
    const user = await t.run(ctx => ctx.db.insert("users", {}));
    await expect(t.withIdentity({ subject: user }).mutation(api.operations.setPaused, { paused: true })).rejects.toThrow("Admin");
  });
});

describe("whitelist ownership boundaries", () => {
  it("does not reveal application personal data to arbitrary address lookups", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.run(ctx => ctx.db.insert("users", { name: "Owner" }));
    const address = "A".repeat(44);
    await t.run(ctx => ctx.db.insert("whitelistApplications", { userId: owner, walletAddress: address, xHandle: "private", postLink: "https://x.com/private/status/1", status: "pending", createdAt: 1 }));
    expect(await t.query(api.whitelist.getMyApplication, { address })).toBeNull();
    const stranger = t.withIdentity({ subject: "stranger" });
    expect(await stranger.query(api.whitelist.getMyApplication, { address })).toBeNull();
    const mine = t.withIdentity({ subject: owner });
    expect((await mine.query(api.whitelist.getMyApplication, {}))?.xHandle).toBe("private");
  });
  it("prevents another account from overwriting an application", async () => {
    const t = convexTest(schema, modules);
    const [owner, stranger] = await t.run(async ctx => [await ctx.db.insert("users", {}), await ctx.db.insert("users", {})]);
    const args = { walletAddress: "A".repeat(44), xHandle: "owner", postLink: "https://x.com/owner/status/1" };
    await t.withIdentity({ subject: owner }).mutation(api.whitelist.submitApplication, args);
    await expect(t.withIdentity({ subject: stranger }).mutation(api.whitelist.submitApplication, { ...args, xHandle: "hijacked" })).rejects.toThrow("another account");
  });
});
