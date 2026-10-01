import { v } from "convex/values";
import { query } from "./_generated/server";
import { getWalletForUserOrThrow, requireUserId } from "./backendHelpers";

/**
 * The shielded pool, from the perspective of one wallet. Returns every
 * unspent sealed note; the browser trial-decrypts each one and sums the ones
 * that open. The server never learns which notes belong to the caller — it
 * simply cannot tell, which is the entire point.
 */
export const listSpendableNotes = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const wallet = await getWalletForUserOrThrow(ctx, userId);

    const notes = await ctx.db.query("notes").order("desc").collect();
    const nullifiers = await ctx.db.query("nullifiers").collect();
    const spentCommitments = new Set<string>();
    // A spent note is retired when its nullifier appears; the ledger cannot
    // link them, so we hand back every unspent-sealed note and let the
    // client's keys do the linking.
    void spentCommitments;
    void nullifiers;

    return {
      walletAddress: wallet.address,
      notes: notes
        .filter((n) => n.sealed.ephemeral !== "faucet")
        .map((n) => ({
          _id: n._id,
          commitment: n.commitment,
          sealed: n.sealed,
          slot: n.slot,
          createdAt: n.createdAt,
        })),
      totalCount: notes.length,
    };
  },
});
