import { paginationOptsValidator } from "convex/server";
import { query } from "./_generated/server";

export const listEnvelopes = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const result = await ctx.db.query("envelopes").withIndex("by_created").order("desc").paginate({ ...paginationOpts, numItems: Math.min(100, Math.max(1, paginationOpts.numItems)) });
    const page = await Promise.all(result.page.map(async envelope => {
      const invoice = envelope.invoiceId ? await ctx.db.get(envelope.invoiceId) : null;
      const vaultCut = Math.ceil(envelope.feeLamports / 2);
      return { ...envelope, decodedMint: invoice ? { lots: invoice.lots, priceUnits: invoice.lamports, tier: invoice.tier } : null,
        feeSplit: { vault: vaultCut, treasury: envelope.feeLamports - vaultCut },
        feeDenomination: envelope.kind === "mint" || envelope.tradeId ? "legacy-sol-units" : "SOLZK",
      };
    }));
    return { ...result, page };
  },
});
