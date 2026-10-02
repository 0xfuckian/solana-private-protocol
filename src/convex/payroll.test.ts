/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { payrollBatchDomain } from "../lib/payroll";
import { spendStatement } from "../lib/spend";
import { sha256Hex } from "./sha256";
const modules = import.meta.glob("./**/*.ts");
const h = (n: number) => n.toString(16).padStart(64, "0");
const sealed = { ephemeral: "A".repeat(22) + "==", nonce: "A".repeat(16), ciphertext: "A".repeat(683) + "=" };
async function fixture() {
  const t = convexTest(schema, modules);
  const user = await t.run(ctx => ctx.db.insert("users", {}));
  const identity = t.withIdentity({ subject: user });
  const address = "B".repeat(44);
  await identity.mutation(api.protocol.registerWallet, { address, commitment: h(500), fundingLamports: 0 });
  const outputs = [{ payee: "C".repeat(44), amount: 1000, commitment: h(10), sealed }, { payee: "D".repeat(44), amount: 1000, commitment: h(11), sealed }];
  const spend = { nullifiers: [h(1)], inputTotal: 10_000, change: { value: 7980, commitment: h(2), sealed } };
  const statement = spendStatement(payrollBatchDomain(address, outputs), spend);
  const proof = sha256Hex(sha256Hex(statement) + "solzk-circuit-v1");
  return { t, identity, args: { ...spend, outputs, proof } };
}
describe("atomic simulation payroll", () => {
  it("creates recipient and change notes with a one percent conserved token fee", async () => {
    const f = await fixture();
    const receipt = await f.identity.mutation(api.payroll.dispatch, f.args);
    expect(receipt.totalTokens).toBe(2000); expect(receipt.feeTokens).toBe(20);
    const notes = await f.t.run(ctx => ctx.db.query("notes").collect());
    expect(notes.filter(n => n.sealed.ephemeral !== "faucet")).toHaveLength(3);
    const state = await f.t.run(ctx => ctx.db.query("protocolState").first());
    expect(state!.treasuryTokens).toBe(10); expect(state!.vaultFeeTokens).toBe(10); expect(state!.treasuryLamports).toBe(0);
    await expect(f.identity.mutation(api.payroll.dispatch, f.args)).rejects.toThrow("double spend");
  });
  it("rolls back all earlier outputs if a later commitment conflicts", async () => {
    const f = await fixture();
    await f.t.run(ctx => ctx.db.insert("notes", { commitment: h(11), sealed, slot: 0, createdAt: 0 }));
    await expect(f.identity.mutation(api.payroll.dispatch, f.args)).rejects.toThrow("already exists");
    expect(await f.t.run(ctx => ctx.db.query("nullifiers").collect())).toHaveLength(0);
    expect(await f.t.run(ctx => ctx.db.query("payrollBatches").collect())).toHaveLength(0);
    expect(await f.t.run(ctx => ctx.db.query("notes").collect())).toHaveLength(2);
  });
  it("rejects duplicate payees", async () => { const f = await fixture(); f.args.outputs[1].payee = f.args.outputs[0].payee; await expect(f.identity.mutation(api.payroll.dispatch, f.args)).rejects.toThrow("Duplicate"); });
  it("rejects a tampered payroll amount and change relationship", async () => { const f = await fixture(); f.args.outputs[0].amount = 2000; await expect(f.identity.mutation(api.payroll.dispatch, f.args)).rejects.toThrow("Change"); });
});
