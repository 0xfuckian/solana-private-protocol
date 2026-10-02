import { paginationOptsValidator } from "convex/server";
import { query } from "./_generated/server";

export const listEnvelopes = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const result = await ctx.db.query("envelopes").withIndex("by_created").order("desc").paginate({ ...paginationOpts, numItems: Math.min(100, Math.max(1, paginationOpts.numItems)) });
    const page = await Promise.all(result.page.map(async envelope => {
      const invoice = envelope.invoiceId ? await ctx.db.get(envelope.invoiceId) : null;
      const fee = envelope.feeTokens ?? envelope.feeLamports;
      const vaultCut = Math.ceil(fee / 2);
      return { ...envelope, decodedMint: invoice ? { lots: invoice.lots, priceUnits: invoice.lamports, tier: invoice.tier } : null,
        feeSplit: { vault: vaultCut, treasury: fee - vaultCut },
        feeDenomination: envelope.feeDenomination ?? (envelope.kind === "mint" || envelope.tradeId ? "legacy-sol-units" : "SOLZK"),
      };
    }));
    return { ...result, page };
  },
});
