import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { QueryCtx, MutationCtx, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUserId, ensureProtocolState } from "./backendHelpers";

// ---------------------------------------------------------------------------
// Pre-launch whitelist
//
// No X API — the founder reviews every application manually. An application
// is: follow + repost the announcement, paste the post link, paste the Solana
// wallet. "approved" is what flips a wallet onto the approved mint rate,
// matched by pasted wallet address or by the submitting account.
// ---------------------------------------------------------------------------

/** True when this wallet or its account holds an approved application. */
export async function isWalletWhitelisted(
  ctx: QueryCtx | MutationCtx,
  wallet: Doc<"wallets">,
): Promise<boolean> {
  const byAddress = await ctx.db
    .query("whitelistApplications")
    .withIndex("by_wallet", (q) => q.eq("walletAddress", wallet.address))
    .first();
  if (byAddress?.status === "approved") return true;
  const byUser = await ctx.db
    .query("whitelistApplications")
    .withIndex("by_user", (q) => q.eq("userId", wallet.userId))
    .first();
  return byUser?.status === "approved";
}

async function requireAdmin(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"users">> {
  const userId = await requireUserId(ctx);
  const user = await ctx.db.get(userId);
  if (user?.role !== "admin") {
    throw new Error("Founder access required.");
  }
  return userId;
}

const ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,48}$/;
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const POST_LINK_RE = /^https:\/\/(www\.)?(x|twitter)\.com\/\S+$/i;

/**
 * Submit (or refresh) a whitelist application. One application per wallet;
 * a rejected wallet may reapply with corrected details.
 */
export const submitApplication = mutation({
  args: {
    walletAddress: v.string(),
    xHandle: v.string(),
    postLink: v.string(),
  },
  handler: async (ctx, { walletAddress, xHandle, postLink }) => {
    const userId = await requireUserId(ctx);
    const address = walletAddress.trim();
    if (!ADDRESS_RE.test(address)) {
      throw new Error(
        "That doesn't look like a Solana wallet address — paste the full wallet string.",
      );
    }
    const handle = xHandle.trim().replace(/^@+/, "");
    if (!HANDLE_RE.test(handle)) {
      throw new Error(
        "X handles are up to 15 characters: letters, numbers, underscores.",
      );
    }
    const link = postLink.trim();
    if (!POST_LINK_RE.test(link)) {
      throw new Error(
        "Paste the full https://x.com/... link to your reply or repost.",
      );
    }

    const existing = await ctx.db
      .query("whitelistApplications")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", address))
      .first();
    if (existing) {
      if (existing.userId !== userId) throw new Error("This address has an application owned by another account.");
      if (existing.status === "approved") {
        throw new Error("This wallet is already approved — you're clear.");
      }
      if (existing.status === "pending") {
        // Idempotent re-submit: refresh the details, keep the queue spot.
        await ctx.db.patch(existing._id, {
          xHandle: handle,
          postLink: link,
          userId,
          createdAt: Date.now(),
        });
        return { applicationId: existing._id, status: "pending" as const };
      }
      // Rejected: start a clean application.
      await ctx.db.delete(existing._id);
    }

    const id = await ctx.db.insert("whitelistApplications", {
      walletAddress: address,
      xHandle: handle,
      postLink: link,
      userId,
      status: "pending",
      createdAt: Date.now(),
    });
    return { applicationId: id, status: "pending" as const };
  },
});

/**
 * The caller's application. Matches by account first, then by a connected
 * wallet address — so a returning applicant sees their status either way.
 */
export const getMyApplication = query({
  args: { address: v.optional(v.string()) },
  handler: async (ctx, { address }) => {
    const userId = await getAuthUserId(ctx);
    const found: Doc<"whitelistApplications">[] = [];
    if (userId !== null) {
      found.push(
        ...(await ctx.db
          .query("whitelistApplications")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect()),
      );
    }
    if (address && userId !== null) {
      const byAddress = await ctx.db
        .query("whitelistApplications")
        .withIndex("by_wallet", (q) => q.eq("walletAddress", address))
        .first();
      if (byAddress?.userId === userId) found.push(byAddress);
    }
    if (found.length === 0) return null;
    const latest = found.sort((a, b) => b.createdAt - a.createdAt)[0];
    return {
      _id: latest._id,
      walletAddress: latest.walletAddress,
      xHandle: latest.xHandle,
      postLink: latest.postLink,
      status: latest.status,
      createdAt: latest.createdAt,
      reviewedAt: latest.reviewedAt ?? null,
    };
  },
});

/** Public counts for the whitelist page. No personal data. */
export const getWhitelistStats = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("whitelistApplications").collect();
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    for (const a of all) {
      if (a.status === "pending") pending++;
      else if (a.status === "approved") approved++;
      else rejected++;
    }
    return { pending, approved, rejected };
  },
});

/** Founder console feed — newest applications first. */
export const listApplications = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const apps = await ctx.db.query("whitelistApplications").collect();
    const sorted = apps.sort((a, b) => b.createdAt - a.createdAt);
    return Promise.all(
      sorted.map(async (a) => {
        const user = a.userId ? await ctx.db.get(a.userId) : null;
        return {
          _id: a._id,
          walletAddress: a.walletAddress,
          xHandle: a.xHandle,
          postLink: a.postLink,
          status: a.status,
          createdAt: a.createdAt,
          accountEmail: user?.email ?? null,
        };
      }),
    );
  },
});

/** The founder's manual review. */
export const reviewApplication = mutation({
  args: {
    applicationId: v.id("whitelistApplications"),
    approve: v.boolean(),
  },
  handler: async (ctx, { applicationId, approve }) => {
    await requireAdmin(ctx);
    const app = await ctx.db.get(applicationId);
    if (!app) throw new Error("Application not found.");
    await ctx.db.patch(applicationId, {
      status: approve ? "approved" : "rejected",
      reviewedAt: Date.now(),
    });
    return { status: approve ? "approved" : "rejected" };
  },
});

/**
 * The pre-launch gate. While `open` is false the whitelist application page
 * is the only page the site serves — every other route bounces here. The
 * founder opens the whitelist from the founder console when applications
 * should be live.
 */
export const getGate = query({
  args: {},
  handler: async (ctx) => {
    const state = await ctx.db
      .query("protocolState")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();
    return { open: state?.whitelistOpen ?? false };
  },
});

/** Founder control: open (or re-close) the whitelist phase. */
export const setWhitelistOpen = mutation({
  args: { open: v.boolean() },
  handler: async (ctx, { open }) => {
    const userId = await requireUserId(ctx);
    const user = await ctx.db.get(userId);
    if (user?.role !== "admin") {
      throw new Error("Founder access required.");
    }
    const state = await ensureProtocolState(ctx);
    await ctx.db.patch(state._id, { whitelistOpen: open });
    return { open };
  },
});

/**
 * Founder bootstrap: on a deployment with no admin yet, the first account to
 * claim becomes the admin, which unlocks the reset/review console. Once an
 * admin exists, claiming is closed — the existing admin can still call it
 * idempotently. This does not depend on being the oldest user account, so it
 * stays reachable even if earlier test accounts exist or were removed.
 */
export const claimFounder = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const user = await ctx.db.get(userId);
    if (user?.role === "admin") return { claimed: true as const, reason: "already_admin" as const };

    const admins = await ctx.db
      .query("users")
      .filter(q => q.eq(q.field("role"), "admin"))
      .collect();

    // A real founder must be a claimable account. An anonymous / email-less
    // stub (e.g. a stale test session) is not a permanent owner, so a signed-in
    // account may supersede it. Once a real, email-bearing admin exists,
    // claiming is closed for everyone else.
    const realAdmin = admins.find(a => !!a.email);
    if (realAdmin) return { claimed: false as const, reason: "admin_exists" as const };

    for (const a of admins) await ctx.db.patch(a._id, { role: "user" });
    await ctx.db.patch(userId, { role: "admin" });
    return { claimed: true as const, reason: admins.length ? ("superseded_stub" as const) : ("claimed" as const) };
  },
});
