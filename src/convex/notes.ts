import { query } from "./_generated/server";
import { getWalletForUser, requireUserId } from "./backendHelpers";

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
    const wallet = await getWalletForUser(ctx, userId);
    if (!wallet) {
      // Registered wallet is created on the mint page; until then the pool
      // simply has nothing of the caller's to scan.
      return { walletAddress: null, notes: [], totalCount: 0 };
    }
    const notes = await ctx.db.query("notes").order("desc").collect();
    // Published nullifiers are public — the client computes the nullifier of
    // each note it can open and skips the ones already retired. The server
    // never learns which notes opened, because it never sees the keys.
    const nullifiers = await ctx.db.query("nullifiers").collect();

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
      publishedNullifiers: nullifiers.map((n) => n.value),
    };
  },
});
