import { getAuthUserId } from "@convex-dev/auth/server";
import { MutationCtx, QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { TICKER, TOTAL_SUPPLY, LOT_SIZE } from "../lib/protocol";

export async function requireUserId(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("Not signed in");
  }
  return userId;
}

export async function getWalletForUser(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<Doc<"wallets"> | null> {
  return ctx.db
    .query("wallets")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
}

export async function getWalletForUserOrThrow(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Doc<"wallets">> {
  const wallet = await getWalletForUser(ctx as QueryCtx, userId);
  if (!wallet)
    throw new Error("No S404 wallet found — create one on the mint page.");
  return wallet;
}

/** Read-only: queries use this. Returns null when the singleton doesn't exist yet. */
export async function readProtocolState(
  ctx: QueryCtx,
): Promise<Doc<"protocolState"> | null> {
  return ctx.db
    .query("protocolState")
    .withIndex("by_key", (q) => q.eq("key", "global"))
    .unique();
}

/** Mutations use this: creates the singleton on first touch. */
export async function ensureProtocolState(
  ctx: MutationCtx,
): Promise<Doc<"protocolState">> {
  const existing = await readProtocolState(ctx as unknown as QueryCtx);
  if (existing) return existing;
  const id = await ctx.db.insert("protocolState", {
    key: "global",
    ticker: TICKER,
    totalSupply: TOTAL_SUPPLY,
    lotSize: LOT_SIZE,
    mintedTokens: 0,
    mintOpen: true,
    marketOpen: false,
    genesisMs: Date.now(),
    feeLamportsCollected: 0,
  });
  return (await ctx.db.get(id))!;
}

/** Query-side helper: state or sensible defaults before first mint. */
export type ProtocolStateLike = {
  ticker: string;
  totalSupply: number;
  lotSize: number;
  mintedTokens: number;
  mintOpen: boolean;
  marketOpen: boolean;
  genesisMs: number;
  feeLamportsCollected: number;
};

export async function protocolStateOrDefault(
  ctx: QueryCtx,
): Promise<ProtocolStateLike & { _id?: Id<"protocolState"> }> {
  const state = await readProtocolState(ctx);
  if (state) return state;
  return {
    ticker: TICKER,
    totalSupply: TOTAL_SUPPLY,
    lotSize: LOT_SIZE,
    mintedTokens: 0,
    mintOpen: true,
    marketOpen: false,
    genesisMs: Date.now(),
    feeLamportsCollected: 0,
  };
}
