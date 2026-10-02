import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUserId, getWalletForUserOrThrow } from "./backendHelpers";
import { ADDRESS_LEN } from "../lib/protocol";

/**
 * Association sets (ASP slice).
 *
 * On the real chain an Association Set Provider publishes Merkle roots of
 * labelled addresses; the join-split circuit takes an optional ASP root as
 * a public input, and labels propagate inside the shielded pool until an
 * exit forces a choice: taint the change or ragequit into the tainted
 * output. In this devnet build, the registry is the public label store:
 * anyone may assert a label for any shielded address, senders resolve the
 * payee's label before paying (breaking the same-address heuristic), and
 * the label set for an address is what a compliance-aware sender sees.
 *
 * Labels are assertions, not verdicts — the ledger still links nothing.
 */
export const registerLabel = mutation({
  args: { address: v.string(), label: v.string() },
  handler: async (ctx, { address, label }) => {
    await requireUserId(ctx);
    const trimmed = label.trim();
    if (address.length !== ADDRESS_LEN) {
      throw new Error("Shielded address looks invalid.");
    }
    if (trimmed.length < 2 || trimmed.length > 32) {
      throw new Error("Label must be 2–32 characters.");
    }
    const existing = await ctx.db
      .query("aspLabels")
      .withIndex("by_address", (q) => q.eq("address", address))
      .collect();
    if (existing.some((l) => l.label === trimmed)) {
      return { address, label: trimmed, alreadyRegistered: true };
    }
    await ctx.db.insert("aspLabels", {
      address,
      label: trimmed,
      createdAt: Date.now(),
    });
    return { address, label: trimmed, alreadyRegistered: false };
  },
});

/** Every label asserted for one address — what a sender resolves before paying. */
export const getLabels = query({
  args: { address: v.string() },
  handler: async (ctx, { address }) => {
    return ctx.db
      .query("aspLabels")
      .withIndex("by_address", (q) => q.eq("address", address))
      .collect();
  },
});

/** Addresses under one label — the association set itself. */
export const getAddressesForLabel = query({
  args: { label: v.string() },
  handler: async (ctx, { label }) => {
    return ctx.db
      .query("aspLabels")
      .withIndex("by_label", (q) => q.eq("label", label))
      .collect();
  },
});

/**
 * The caller's own address with any public labels attached — the dashboard's
 * "how the pool sees you" panel.
 */
export const getMyLabels = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);
    const labels = await ctx.db
      .query("aspLabels")
      .withIndex("by_address", (q) => q.eq("address", wallet.address))
      .collect();
    return { address: wallet.address, labels };
  },
});

/** Recent registry activity — the public ASP feed. */
export const listRecentLabels = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("aspLabels").collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
  },
});
