import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUserId } from "./backendHelpers";

export const getStatus = query({
  args: {},
  handler: async ctx => {
    const state = await ctx.db.query("protocolState").withIndex("by_key", q => q.eq("key", "global")).unique();
    return { mode: "ledger" as const, paused: state?.emergencyPaused ?? false, productionReady: false };
  },
});

export const setPaused = mutation({
  args: { paused: v.boolean() },
  handler: async (ctx, { paused }) => {
    const userId = await requireUserId(ctx);
    const user = await ctx.db.get(userId);
    if (user?.role !== "admin") throw new Error("Admin access required.");
    const state = await ctx.db.query("protocolState").withIndex("by_key", q => q.eq("key", "global")).unique();
    if (!state) throw new Error("Initialize the ledger before changing pause status.");
    await ctx.db.patch(state._id, { emergencyPaused: paused });
    await ctx.db.insert("operationEvents", { userId, kind: paused ? "pause" : "resume", createdAt: Date.now() });
    return { paused };
  },
});
