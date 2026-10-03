/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
const modules = import.meta.glob("./**/*.ts");

describe("agent integration reads", () => {
  it("poolState reports the open mint price, fees and data source", async () => {
    const t = convexTest(schema, modules);
    const s = await t.query(api.termix.poolState, {});
    expect(s.source).toBe("convex-ledger");
    expect(s.mintRateLamportsPerLot).toBe(3_500_000);
    expect(s.walletCapLots).toBe(1_000);
    expect(s.feesBps).toEqual({ mint: 500, transfer: 200, swap: 30 });
    expect(s.assets.length).toBeGreaterThan(0);
  });
  it("agentReputation reports unknown wallets without inventing scores", async () => {
    const t = convexTest(schema, modules);
    const r = await t.query(api.termix.agentReputation, { address: "Z".repeat(44) });
    expect(r.known).toBe(false);
    expect(r.payrollBatches).toBe(0);
  });
  it("aspCheck reports absence honestly", async () => {
    const t = convexTest(schema, modules);
    const r = await t.query(api.termix.aspCheck, { commitment: "0".repeat(64) });
    expect(r.commitmentFound).toBe(false);
    expect(r.selfAsserted).toBe(true);
  });
});
