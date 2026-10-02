import { v } from "convex/values";
import type { TableNames } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { requireUserId } from "./backendHelpers";

/**
 * Ledger/demo tables wiped by `resetSimulation`. `users` is never touched;
 * `wallets` is handled separately so a tester can keep their registration.
 */
const LEDGER_TABLES: readonly TableNames[] = [
  "operationEvents",
  "transferUsage",
  "payrollBatches",
  "stakingPositions",
  "stakingPool",
  "merkleTreeNodes",
  "merkleRoots",
  "merkleState",
  "invoices",
  "envelopes",
  "notes",
  "nullifiers",
  "orders",
  "trades",
  "vaultDeposits",
  "vaultPool",
  "burnEvents",
  "swapEvents",
  "assetEvents",
  "assetWallets",
  "feeClaims",
  "aspLabels",
  "whitelistApplications",
  "protocolState",
];

/** Delete every row in a table in small batches so a single mutation never
 *  trips the read/write limits. */
async function clearTable(ctx: MutationCtx, table: TableNames) {
  for (;;) {
    const rows = await ctx.db.query(table).take(128);
    if (rows.length === 0) return;
    for (const row of rows) await ctx.db.delete(row._id);
  }
}

export const founderDiagnostics = query({
  args: {},
  handler: async ctx => {
    const users = await ctx.db.query("users").collect();
    const admins = users.filter(u => u.role === "admin");
    const wallets = await ctx.db.query("wallets").collect();
    const state = await ctx.db.query("protocolState").withIndex("by_key", q => q.eq("key", "global")).unique();
    const counts: Record<string, number> = {};
    for (const t of ["notes", "nullifiers", "envelopes", "invoices", "orders", "trades", "burnEvents", "swapEvents", "assetEvents", "feeClaims", "merkleTreeNodes", "merkleRoots"] as const) {
      counts[t] = (await ctx.db.query(t).collect()).length;
    }
    return {
      users: users.length,
      admins: admins.length,
      hasAdmin: admins.length > 0,
      adminEmails: admins.map(a => a.email ?? "(no email)"),
      wallets: wallets.length,
      mintedTokens: state?.mintedTokens ?? 0,
      resetTokenConfigured: !!process.env.SOLZK_DEV_RESET_TOKEN,
      rowCounts: counts,
    };
  },
});

export const getStatus = query({
  args: {},
  handler: async ctx => {
    const state = await ctx.db.query("protocolState").withIndex("by_key", q => q.eq("key", "global")).unique();
    return { mode: "simulation" as const, paused: state?.emergencyPaused ?? false, productionReady: false };
  },
});

export const setPaused = mutation({
  args: { paused: v.boolean() },
  handler: async (ctx, { paused }) => {
    const userId = await requireUserId(ctx);
    const user = await ctx.db.get(userId);
    if (user?.role !== "admin") throw new Error("Admin access required.");
    const state = await ctx.db.query("protocolState").withIndex("by_key", q => q.eq("key", "global")).unique();
    if (!state) throw new Error("Initialize the simulation before changing pause status.");
    await ctx.db.patch(state._id, { emergencyPaused: paused });
    await ctx.db.insert("operationEvents", { userId, kind: paused ? "pause" : "resume", createdAt: Date.now() });
    return { paused };
  },
});

/**
 * Testing only: wipe the simulation back to zero so mint counts, supply,
 * notes, nullifiers, invoices, the Merkle tree and every other ledger feed
 * start clean. Admin-only and simulation-only — never a production control.
 *
 * - `includeWallets: false` (default) keeps each account's wallet record but
 *   zeroes its counters and restores its faucet grant, so testers can re-mint
 *   without re-registering.
 * - `includeWallets: true` also deletes wallet records and their registration,
 *   so a fresh registration flow can be tested from the same account.
 */
export const resetSimulation = mutation({
  args: { includeWallets: v.optional(v.boolean()) },
  handler: async (ctx, { includeWallets }) => {
    const userId = await requireUserId(ctx);
    const user = await ctx.db.get(userId);
    if (user?.role !== "admin") throw new Error("Admin access required.");

    for (const table of LEDGER_TABLES) await clearTable(ctx, table);

    if (includeWallets) {
      await clearTable(ctx, "wallets");
    } else {
      const wallets = await ctx.db.query("wallets").collect();
      for (const wallet of wallets) {
        await ctx.db.patch(wallet._id, {
          lotsMinted: 0,
          burnedTokens: 0,
          fundingLamports: wallet.faucetTotalLamports,
        });
      }
    }

    await ctx.db.insert("operationEvents", { userId, kind: "reset", createdAt: Date.now() });
    return { reset: true as const, walletsCleared: includeWallets === true };
  },
});
