/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { sha256Hex } from "./sha256";
import { spendStatement, sealedStatement, type SpendInputs } from "../lib/spend";
import { consumeSpend } from "./spend";
import { routeTokenFee } from "./backendHelpers";

const modules = import.meta.glob("./**/*.ts");
const sealed = { ephemeral: "A".repeat(22) + "==", nonce: "A".repeat(16), ciphertext: "A".repeat(683) + "=" };
const hash = (n: number) => n.toString(16).padStart(64, "0");
const proofFor = (statement: string) => sha256Hex(sha256Hex(statement) + "solzk-circuit-v1");
const spend: SpendInputs = { nullifiers: [hash(1)], inputTotal: 10_000, change: { value: 9000, commitment: hash(2), sealed } };

describe("atomic change accounting (declared demo values)", () => {
  it("spends once and appends excess value as change", async () => {
    const t = convexTest(schema, modules);
    await t.run(ctx => consumeSpend(ctx, spend, 1000, "test", proofFor(spendStatement("test", spend)), 1));
    const notes = await t.run(ctx => ctx.db.query("notes").collect());
    expect(notes).toHaveLength(1);
    expect(notes[0].commitment).toBe(hash(2));
    expect(await t.run(ctx => ctx.db.query("nullifiers").collect())).toHaveLength(1);
    await expect(t.run(ctx => consumeSpend(ctx, spend, 1000, "test", proofFor(spendStatement("test", spend)), 2))).rejects.toThrow("double spend");
  });
  it("rejects tampered change without retiring inputs", async () => {
    const t = convexTest(schema, modules);
    const tampered = { ...spend, change: { ...spend.change!, commitment: hash(3) } };
    await expect(t.run(ctx => consumeSpend(ctx, tampered, 1000, "test", proofFor(spendStatement("test", spend)), 1))).rejects.toThrow("mismatch");
    expect(await t.run(ctx => ctx.db.query("nullifiers").collect())).toHaveLength(0);
  });
  it("rejects missing excess change", async () => {
    const t = convexTest(schema, modules);
    await expect(t.run(ctx => consumeSpend(ctx, { ...spend, change: undefined }, 1000, "test", "bad", 1))).rejects.toThrow("Change");
  });
  it("rolls back spent inputs if change commitment is already published", async () => {
    const t = convexTest(schema, modules);
    await t.run(ctx => ctx.db.insert("notes", { commitment: hash(2), sealed, slot: 1, createdAt: 1 }));
    await expect(t.run(ctx => consumeSpend(ctx, spend, 1000, "test", proofFor(spendStatement("test", spend)), 2))).rejects.toThrow("already exists");
    expect(await t.run(ctx => ctx.db.query("nullifiers").collect())).toHaveLength(0);
  });
});

async function marketFixture() {
  const t = convexTest(schema, modules);
  const [sellerUser, buyerUser] = await t.run(async ctx => [await ctx.db.insert("users", {}), await ctx.db.insert("users", {})]);
  const seller = t.withIdentity({ subject: sellerUser });
  const buyer = t.withIdentity({ subject: buyerUser });
  const sellerWallet = await seller.mutation(api.protocol.registerWallet, { address: "B".repeat(44), commitment: hash(100), fundingLamports: 0 });
  const buyerWallet = await buyer.mutation(api.protocol.registerWallet, { address: "C".repeat(44), commitment: hash(101), fundingLamports: 1_000_000 });
  await t.run(async ctx => { const state = await ctx.db.query("protocolState").first(); await ctx.db.patch(state!._id, { marketOpen: true }); });
  const orderId = await seller.mutation(api.market.placeOrder, { side: "sell", amountTokens: 1000, priceLamportsPerKilo: 10_000 });
  const fill = await buyer.mutation(api.market.takeOrder, { orderId, amountTokens: 1000 });
  return { t, seller, buyer, sellerWallet, buyerWallet, orderId, fill };
}

describe("market settlement", () => {
  it("consumes seller nullifiers, returns change and conserves SOL escrow", async () => {
    const f = await marketFixture();
    const output = hash(200);
    const domain = `trade:${f.fill.tradeId}:${output}:${sealedStatement(sealed)}`;
    await f.seller.mutation(api.market.settleTrade, { tradeId: f.fill.tradeId, commitment: output, sealedNote: sealed, ...spend, proof: proofFor(spendStatement(domain, spend)) });
    const records = await f.t.run(async ctx => ({ seller: await ctx.db.get(f.sellerWallet), buyer: await ctx.db.get(f.buyerWallet), state: await ctx.db.query("protocolState").first(), pool: await ctx.db.query("vaultPool").first(), order: await ctx.db.get(f.orderId), nullifiers: await ctx.db.query("nullifiers").collect() }));
    expect(records.seller!.fundingLamports).toBe(10_000);
    expect(records.buyer!.fundingLamports).toBe(989_800);
    expect(records.state!.treasuryLamports + records.pool!.feePoolLamports + records.seller!.fundingLamports + records.buyer!.fundingLamports).toBe(1_000_000);
    expect(records.order!.status).toBe("filled");
    expect(records.nullifiers).toHaveLength(1);
    const book = await f.t.query(api.market.getBook, {});
    expect(book.asks).toHaveLength(0);
    expect(book.lastPrice).toBe(10_000);
  });
  it("does not report pending fills as settled prices", async () => { const f = await marketFixture(); expect((await f.t.query(api.market.getBook, {})).lastPrice).toBeNull(); });
  it("prevents buyers from authorizing seller spends", async () => {
    const f = await marketFixture();
    await expect(f.buyer.mutation(api.market.settleTrade, { tradeId: f.fill.tradeId, commitment: hash(200), sealedNote: sealed, ...spend, proof: "bad" })).rejects.toThrow("Only the seller");
  });
});

describe("token fee denomination", () => {
  it("never credits SOL treasury or SOL vault for token fees", async () => {
    const f = await marketFixture();
    await f.t.run(async ctx => { const state = (await ctx.db.query("protocolState").first())!; await routeTokenFee(ctx, state, 21); });
    const state = await f.t.run(ctx => ctx.db.query("protocolState").first());
    expect(state!.treasuryTokens).toBe(10);
    expect(state!.vaultFeeTokens).toBe(11);
    expect(state!.treasuryLamports).toBe(0);
    expect(await f.t.run(ctx => ctx.db.query("vaultPool").first())).toBeNull();
  });
});
