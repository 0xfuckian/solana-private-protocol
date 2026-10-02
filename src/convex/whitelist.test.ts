/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

const WALLET_A = "A".repeat(44);
const WALLET_B = "B".repeat(44);

async function user(t: ReturnType<typeof convexTest>) {
  return await t.run((ctx) => ctx.db.insert("users", {}));
}

describe("whitelist application validation", () => {
  it("rejects malformed wallet addresses", async () => {
    const t = convexTest(schema, modules);
    const uid = await user(t);
    const id = t.withIdentity({ subject: uid });
    for (const bad of [
      "short",
      "0".repeat(44), // 0 not in base58
      "O".repeat(44),
      "I".repeat(44),
      "l".repeat(44),
      "",
      "A".repeat(31), // too short
      "A".repeat(49), // too long
    ]) {
      await expect(
        id.mutation(api.whitelist.submitApplication, {
          walletAddress: bad,
          xHandle: "alice",
          postLink: "https://x.com/alice/status/123",
        }),
      ).rejects.toThrow(/wallet/i);
    }
  });

  it("rejects malformed X handles and post links", async () => {
    const t = convexTest(schema, modules);
    const uid = await user(t);
    const id = t.withIdentity({ subject: uid });
    // handle too long / bad chars
    for (const badHandle of ["a".repeat(16), "has-hyphen", "", "@@@"]) {
      await expect(
        id.mutation(api.whitelist.submitApplication, {
          walletAddress: WALLET_A,
          xHandle: badHandle,
          postLink: "https://x.com/alice/status/123",
        }),
      ).rejects.toThrow(/handle/i);
    }
    // post link must be x.com / twitter.com https
    for (const badLink of [
      "http://x.com/alice/status/123",
      "https://example.com/post",
      "not a url",
      "",
    ]) {
      await expect(
        id.mutation(api.whitelist.submitApplication, {
          walletAddress: WALLET_A,
          xHandle: "alice",
          postLink: badLink,
        }),
      ).rejects.toThrow(/link/i);
    }
  });

  it("accepts twitter.com links and @-prefixed handles", async () => {
    const t = convexTest(schema, modules);
    const uid = await user(t);
    const id = t.withIdentity({ subject: uid });
    const r = await id.mutation(api.whitelist.submitApplication, {
      walletAddress: WALLET_A,
      xHandle: "@alice_123",
      postLink: "https://twitter.com/alice/status/123",
    });
    expect(r.status).toBe("pending");
  });

  it("keeps queue spot on idempotent pending resubmit", async () => {
    const t = convexTest(schema, modules);
    const uid = await user(t);
    const id = t.withIdentity({ subject: uid });
    const first = await id.mutation(api.whitelist.submitApplication, {
      walletAddress: WALLET_A,
      xHandle: "alice",
      postLink: "https://x.com/alice/status/1",
    });
    const second = await id.mutation(api.whitelist.submitApplication, {
      walletAddress: WALLET_A,
      xHandle: "alice2",
      postLink: "https://x.com/alice/status/2",
    });
    expect(second.applicationId).toEqual(first.applicationId);
    const apps = await t.run((ctx) => ctx.db.query("whitelistApplications").collect());
    expect(apps).toHaveLength(1);
    expect(apps[0].xHandle).toBe("alice2");
  });

  it("blocks a second account from claiming the same address", async () => {
    const t = convexTest(schema, modules);
    const u1 = await user(t);
    const u2 = await user(t);
    await t
      .withIdentity({ subject: u1 })
      .mutation(api.whitelist.submitApplication, {
        walletAddress: WALLET_A,
        xHandle: "alice",
        postLink: "https://x.com/alice/status/1",
      });
    await expect(
      t.withIdentity({ subject: u2 }).mutation(api.whitelist.submitApplication, {
        walletAddress: WALLET_A,
        xHandle: "bob",
        postLink: "https://x.com/bob/status/1",
      }),
    ).rejects.toThrow(/another account/);
  });

  it("lets rejected wallets reapply cleanly, blocks approved resubmit", async () => {
    const t = convexTest(schema, modules);
    const uid = await user(t);
    const admin = await user(t);
    await t.run((ctx) => ctx.db.patch(admin, { role: "admin" }));
    const me = t.withIdentity({ subject: uid });
    const boss = t.withIdentity({ subject: admin });

    const app = await me.mutation(api.whitelist.submitApplication, {
      walletAddress: WALLET_A,
      xHandle: "alice",
      postLink: "https://x.com/alice/status/1",
    });
    // non-admin cannot review
    await expect(
      me.mutation(api.whitelist.reviewApplication, {
        applicationId: app.applicationId,
        approve: true,
      }),
    ).rejects.toThrow(/Founder/);

    await boss.mutation(api.whitelist.reviewApplication, {
      applicationId: app.applicationId,
      approve: false,
    });
    // reapply after reject creates a fresh application
    const re = await me.mutation(api.whitelist.submitApplication, {
      walletAddress: WALLET_A,
      xHandle: "alice",
      postLink: "https://x.com/alice/status/2",
    });
    expect(re.status).toBe("pending");

    await boss.mutation(api.whitelist.reviewApplication, {
      applicationId: re.applicationId,
      approve: true,
    });
    await expect(
      me.mutation(api.whitelist.submitApplication, {
        walletAddress: WALLET_A,
        xHandle: "alice",
        postLink: "https://x.com/alice/status/3",
      }),
    ).rejects.toThrow(/already approved/);
  });

  it("reports counts without leaking personal data", async () => {
    const t = convexTest(schema, modules);
    const u1 = await user(t);
    const u2 = await user(t);
    const admin = await user(t);
    await t.run((ctx) => ctx.db.patch(admin, { role: "admin" }));
    const a = await t
      .withIdentity({ subject: u1 })
      .mutation(api.whitelist.submitApplication, {
        walletAddress: WALLET_A,
        xHandle: "alice",
        postLink: "https://x.com/alice/status/1",
      });
    await t.withIdentity({ subject: u2 }).mutation(api.whitelist.submitApplication, {
      walletAddress: WALLET_B,
      xHandle: "bob",
      postLink: "https://x.com/bob/status/1",
    });
    await t
      .withIdentity({ subject: admin })
      .mutation(api.whitelist.reviewApplication, {
        applicationId: a.applicationId,
        approve: true,
      });
    const stats = await t.query(api.whitelist.getWhitelistStats, {});
    expect(stats).toEqual({ pending: 1, approved: 1, rejected: 0 });
    expect(JSON.stringify(stats)).not.toContain("alice");
  });
});

describe("mint invoice caps", () => {
  it("enforces per-wallet caps across invoices", async () => {
    const t = convexTest(schema, modules);
    const uid = await user(t);
    const me = t.withIdentity({ subject: uid });
    await me.mutation(api.protocol.registerWallet, {
      address: "C".repeat(44),
      commitment: "0".repeat(64),
      fundingLamports: 10_000_000_000,
    });
    // open rate cap is 1000 lots; single tx limit is smaller — exceed tx limit first
    await expect(
      me.mutation(api.protocol.openInvoice, {
        lots: 5000,
        tier: "open",
        commitment: "1".repeat(64),
        noteR: "r1",
      }),
    ).rejects.toThrow();
    // valid small invoice opens
    const r = await me.mutation(api.protocol.openInvoice, {
      lots: 1,
      tier: "open",
      commitment: "2".repeat(64),
      noteR: "r2",
    });
    expect(r.tier).toBe("open");
  });
});
