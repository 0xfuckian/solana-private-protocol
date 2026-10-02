import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { ensureProtocolState, getWalletForUserOrThrow, requireUserId, routeTokenFee } from "./backendHelpers";
import { consumeSpend, spendArgs } from "./spend";
import { appendNote } from "./merkle";
import { assertUnits, assertSealedNote } from "../lib/safety";
import { payrollBatchDomain, payrollDispatchSummary } from "../lib/payroll";
import { LAMPORTS_PER_SOL, REDEEM_LAMPORTS_PER_TOKEN } from "../lib/protocol";

export const dispatch = mutation({
  args: { nullifiers: v.array(v.string()), ...spendArgs, proof: v.string(), outputs: v.array(v.object({ payee: v.string(), amount: v.number(), commitment: v.string(), sealed: v.object({ ephemeral: v.string(), nonce: v.string(), ciphertext: v.string(), epk: v.optional(v.string()) }) })) },
  handler: async (ctx, args) => {
    const wallet = await getWalletForUserOrThrow(ctx, await requireUserId(ctx));
    const state = await ensureProtocolState(ctx);
    if (args.outputs.length < 1 || args.outputs.length > 20) throw new Error("Dispatch between 1 and 20 payments per atomic batch.");
    const payees = new Set<string>();
    const commitments = new Set<string>();
    for (const output of args.outputs) {
      assertUnits(output.amount);
      assertSealedNote(output.sealed);
      if (!/^[1-9A-HJ-NP-Za-km-z]{44}$/.test(output.payee)) throw new Error("Invalid payee address.");
      if (!/^[a-f0-9]{64}$/.test(output.commitment)) throw new Error("Malformed output commitment.");
      if (payees.has(output.payee) || commitments.has(output.commitment)) throw new Error("Duplicate payee or commitment.");
      payees.add(output.payee); commitments.add(output.commitment);
    }
    const { total, fee, debit } = payrollDispatchSummary(args.outputs);
    const day = Math.floor(Date.now() / 86_400_000);
    const staking = await ctx.db.query("stakingPositions").withIndex("by_wallet", q => q.eq("walletId", wallet._id)).unique();
    const limit = (staking && staking.amount > 0 ? 100 : 10) * LAMPORTS_PER_SOL;
    const valuation = debit * REDEEM_LAMPORTS_PER_TOKEN;
    assertUnits(valuation, "Payroll valuation");
    const usage = await ctx.db.query("transferUsage").withIndex("by_wallet_day", q => q.eq("walletId", wallet._id).eq("day", day)).unique();
    if ((usage?.valueUnits ?? 0) + valuation > limit) throw new Error("Payroll exceeds your remaining daily simulation transfer allowance.");
    const slot = Math.floor((Date.now() - state.genesisMs) / 400);
    await consumeSpend(ctx, args, debit, payrollBatchDomain(wallet.address, args.outputs), args.proof, slot);
    for (const output of args.outputs) await appendNote(ctx, { commitment: output.commitment, sealed: output.sealed, slot, createdAt: Date.now() });
    await routeTokenFee(ctx, state, fee);
    if (usage) await ctx.db.patch(usage._id, { valueUnits: usage.valueUnits + valuation });
    else await ctx.db.insert("transferUsage", { walletId: wallet._id, day, valueUnits: valuation });
    const batchId = await ctx.db.insert("payrollBatches", { walletId: wallet._id, recipients: args.outputs.length, totalTokens: total, feeTokens: fee, slot, createdAt: Date.now() });
    return { batchId, recipients: args.outputs.length, totalTokens: total, feeTokens: fee, slot };
  },
});
