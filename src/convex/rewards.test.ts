/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { routeFee, routeTokenFee, ensureVaultPool } from "./backendHelpers";
import { recordTestProof } from "./testProof";
import { sealedStatement, spendStatement } from "../lib/spend";
import { REWARD_SCALE } from "../lib/rewards";

const modules = import.meta.glob("./**/*.ts");
const sealed = { ephemeral: "A".repeat(22) + "==", nonce: "A".repeat(16), ciphertext: "A".repeat(683) + "=" };
const h = (n: number) => n.toString();

async function fixture() {
  const t = convexTest(schema, modules);
  const user = await t.run(ctx => ctx.db.insert("users", {}));
  const identity = t.withIdentity({ subject: user });
  const address = "B".repeat(44);
  const walletId = await identity.mutation(api.protocol.registerWallet, { address, commitment: h(500), fundingLamports: 1000 });
  return { t, identity, address, walletId };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
const withProof = (f: Fixture, statement: string) => f.t.run(ctx => recordTestProof(ctx, statement));

async function deposit(f: Fixture, amountTokens: number, n: number, staking = false) {
  const inputs = { nullifiers: [h(n)], inputTotal: amountTokens };
  const domain = `${staking ? "stake" : "deposit"}:${f.address}:${amountTokens}`;
  const proof = await withProof(f, spendStatement(domain, inputs));
  const args = { ...inputs, amountTokens, proof };
  if (staking) await f.identity.mutation(api.staking.stake, args);
  else await f.identity.mutation(api.vault.deposit, args);
}

async function fees(f: Fixture, amount: number, tokens = false) {
  await f.t.run(async ctx => {
    const state = (await ctx.db.query("protocolState").first())!;
    if (tokens) await routeTokenFee(ctx, state, amount);
    else await routeFee(ctx, state, await ensureVaultPool(ctx), amount);
  });
}

describe("fixed-point vault accounting", () => {
  it("does not erase pending rewards when adding shares", async () => {
    const f = await fixture();
    await deposit(f, 3, 1);
    await fees(f, 6);
    await deposit(f, 3, 2);
    expect((await f.identity.query(api.vault.getMyPosition, {}))?.claimableLamports).toBe(3);
    await f.identity.mutation(api.vault.claimFees, {});
    expect((await f.identity.query(api.vault.getMyPosition, {}))?.claimableLamports).toBe(0);
  });
  it("pays pending fees on withdrawal instead of deleting them", async () => {
    const f = await fixture();
    await deposit(f, 10, 1);
    await fees(f, 20);
    const statement = `withdraw:${f.address}:10:10:${h(30)}:${sealedStatement(sealed)}`;
    const proof = await withProof(f, statement);
    const result = await f.identity.mutation(api.vault.withdraw, { shares: 10, expectedTokensOut: 10, commitment: h(30), sealedNote: sealed, proof });
    expect(result.claimedLamports).toBe(10);
    expect((await f.t.run(ctx => ctx.db.get(f.walletId)))?.fundingLamports).toBe(1010);
    expect((await f.identity.query(api.vault.getMyPosition, {}))?.shares).toBe(0);
  });
  it("retains fractional entitlements through claims", async () => {
    const f = await fixture();
    await deposit(f, 3, 1);
    await fees(f, 4);
    await f.identity.mutation(api.vault.claimFees, {});
    const position = await f.t.run(ctx => ctx.db.query("vaultDeposits").first());
    expect(BigInt(position!.pendingRewardScaled!)).toBeGreaterThan(0n);
    expect(BigInt(position!.pendingRewardScaled!)).toBeLessThan(REWARD_SCALE);
    await fees(f, 4);
    const result = await f.identity.mutation(api.vault.claimFees, {});
    expect(result.claimedLamports).toBe(2);
  });
  it("rejects stale withdrawal outputs without spending shares", async () => {
    const f = await fixture(); await deposit(f, 10, 1);
    await expect(f.identity.mutation(api.vault.withdraw, { shares: 10, expectedTokensOut: 9, commitment: h(30), sealedNote: sealed, proof: "bad" })).rejects.toThrow("quote changed");
    expect((await f.identity.query(api.vault.getMyPosition, {}))?.shares).toBe(10);
  });
  it("does not manufacture unfunded rewards when a pool is closed", async () => {
    const f = await fixture(); await deposit(f, 10, 1);
    await f.t.run(async ctx => { const state = (await ctx.db.query("protocolState").first())!; await ctx.db.patch(state._id, { mintOpen: false, marketOpen: true }); });
    await expect(f.identity.mutation(api.vault.claimFees, {})).rejects.toThrow("No whole-unit");
    expect((await f.identity.query(api.vault.getPool, {})).feePoolLamports).toBe(0);
  });
});

describe("staking pool", () => {
  it("locks principal, discounts fees and previews governance weight", async () => {
    const f = await fixture(); await deposit(f, 1000, 1, true);
    const status = await f.identity.query(api.staking.getStatus, {});
    expect(status.amount).toBe(1000); expect(status.feeBps).toBe(100); expect(status.dailyLimitSol).toBe(100); expect(status.governanceWeight).toBe(1000);
    await expect(f.identity.mutation(api.staking.unstake, { amountTokens: 1000, commitment: h(30), sealedNote: sealed, proof: "bad" })).rejects.toThrow("locked");
  });
  it("funds rewards only from actual routed token fees", async () => {
    const f = await fixture(); await deposit(f, 1000, 1, true);
    expect((await f.identity.query(api.staking.getStatus, {})).claimableTokens).toBe(0);
    await fees(f, 100, true);
    expect((await f.identity.query(api.staking.getStatus, {})).claimableTokens).toBe(50);
    const rewardStatement = `staking-reward:${f.address}:50:${h(30)}:${sealedStatement(sealed)}`;
    const proof = await withProof(f, rewardStatement);
    await f.identity.mutation(api.staking.claimRewards, { expectedTokens: 50, commitment: h(30), sealedNote: sealed, proof });
    const pool = await f.t.run(ctx => ctx.db.query("stakingPool").first());
    expect(pool!.rewardTokens).toBe(0); expect(pool!.rewardsPaid).toBe(50);
    await expect(f.identity.mutation(api.staking.claimRewards, { expectedTokens: 50, commitment: h(31), sealedNote: sealed, proof: "bad" })).rejects.toThrow("quote changed");
  });
  it("returns principal after expiry and preserves pending rewards", async () => {
    const f = await fixture(); await deposit(f, 1000, 1, true); await fees(f, 100, true);
    await f.t.run(async ctx => { const position = (await ctx.db.query("stakingPositions").first())!; await ctx.db.patch(position._id, { lockedUntil: 0 }); });
    const unstakeStatement = `unstake:${f.address}:1000:${h(30)}:${sealedStatement(sealed)}`;
    const proof = await withProof(f, unstakeStatement);
    await f.identity.mutation(api.staking.unstake, { amountTokens: 1000, commitment: h(30), sealedNote: sealed, proof });
    const status = await f.identity.query(api.staking.getStatus, {});
    expect(status.amount).toBe(0); expect(status.claimableTokens).toBe(50); expect(status.feeBps).toBe(200);
  });
});
