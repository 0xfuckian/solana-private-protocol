import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { decodePayLink, encodePayLink, mintFeeSplit, quoteSwapSolForTokens, quoteSwapTokensForSol, LOT_SIZE, TOTAL_LOTS, TOTAL_SUPPLY } from "./protocol";
import { assertNullifiers, assertSealedNote, assertUnits, isSolzkNote, mulDivFloor, relayerFeeTokens } from "./safety";
import { parsePayrollCsv, payrollSummary } from "./payroll";
import { buildEnvelopePayload, buildProof, generateSeedWords, sealNoteFor, tryUnsealNote, validateSeedWords } from "./wallet";
import { proveSpend } from "./groth16";

const address = "A".repeat(44);
describe("integer money math", () => {
  it("conserves mint fees with upward vault rounding", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 1_000_000_000 }), amount => {
      const split = mintFeeSplit(amount);
      expect(split.fee + split.liquidity).toBe(amount);
      expect(split.vaultCut + split.treasuryCut).toBe(split.fee);
      expect(split.vaultCut - split.treasuryCut).toBeGreaterThanOrEqual(0);
      expect(split.vaultCut - split.treasuryCut).toBeLessThanOrEqual(1);
    }));
  });
  it("uses integer products beyond floating point precision", () => expect(mulDivFloor(9_000_000_001, 9_000_000_001, 9_000_000_001)).toBe(9_000_000_001));
  it.each([NaN, Infinity, -1, 0, 0.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid amount %s", amount => expect(() => assertUnits(amount)).toThrow());
  it("calculates dynamic relayer fees", () => { expect(relayerFeeTokens(1000)).toBe(25); expect(relayerFeeTokens(25_001)).toBe(26); expect(relayerFeeTokens(1_000_000)).toBe(1000); });
  it("has consistent supply lots", () => expect(LOT_SIZE * TOTAL_LOTS).toBe(TOTAL_SUPPLY));
});

describe("AMM safety", () => {
  it("SOL input never reduces constant product", () => {
    fc.assert(fc.property(fc.integer({ min: 1000, max: 1_000_000_000 }), fc.integer({ min: 1000, max: 1_000_000_000 }), fc.integer({ min: 1, max: 1_000_000 }), (x, y, input) => {
      const q = quoteSwapSolForTokens(input, x, y);
      if (!q) return;
      expect(BigInt(x + input - q.feeLamports) * BigInt(y - q.outAmount) >= BigInt(x) * BigInt(y)).toBe(true);
      expect(q.outAmount).toBeLessThan(y);
    }));
  });
  it("token input never reduces constant product", () => {
    fc.assert(fc.property(fc.integer({ min: 1000, max: 1_000_000_000 }), fc.integer({ min: 1000, max: 1_000_000_000 }), fc.integer({ min: 1, max: 1_000_000 }), (x, y, input) => {
      const q = quoteSwapTokensForSol(input, x, y);
      if (!q) return;
      expect(BigInt(x - q.outAmount - q.feeLamports) * BigInt(y + input) >= BigInt(x) * BigInt(y)).toBe(true);
    }));
  });
  it("rejects fractional input", () => expect(quoteSwapSolForTokens(1.5, 1000, 1000)).toBeNull());
});

describe("notes and proofs", () => {
  it("rejects empty, duplicated and malformed nullifiers", () => {
    for (const values of [[], ["a"], ["a".repeat(64), "a".repeat(64)]]) expect(() => assertNullifiers(values)).toThrow();
  });
  it("separates mock assets from SOLZK spend selection", () => { expect(isSolzkNote({ memo: "asset:USDC" })).toBe(false); expect(isSolzkNote({ memo: "change" })).toBe(true); });
  it("pads UTF-8 notes to exactly 512 ciphertext bytes", async () => {
    const sealed = await sealNoteFor(address, { value: 100, memo: "日本語 🛡️", r: "test" });
    expect(atob(sealed.ciphertext).length).toBe(512);
    expect(() => assertSealedNote(sealed)).not.toThrow();
    expect((await tryUnsealNote(address, sealed))?.memo).toBe("日本語 🛡️");
  });
  it("rejects ciphertext tampering", async () => {
    const sealed = await sealNoteFor(address, { value: 100, memo: "", r: "test" });
    const bytes = atob(sealed.ciphertext);
    sealed.ciphertext = btoa(String.fromCharCode(bytes.charCodeAt(0) ^ 1) + bytes.slice(1));
    expect(await tryUnsealNote(address, sealed)).toBeNull();
  });
  it("makes the demo confidentiality failure explicit", async () => {
    const sealed = await sealNoteFor(address, { value: 100, memo: "public-address-decryptable", r: "test" });
    expect((await tryUnsealNote(address, sealed))?.value).toBe(100);
  });
  it("produces valid demo seeds with secure randomness", () => { const words = generateSeedWords(); expect(validateSeedWords(words).ok).toBe(true); });
  it("keeps legacy envelopes deterministic", () => { const note = { ephemeral: "a", nonce: "b", ciphertext: "c" }; expect(buildEnvelopePayload("mint", note, 934).length).toBe(1868); });
  it("refuses to hash a statement into a proof", async () => await expect(buildProof("public")).rejects.toThrow("real Groth16 proof"));
  it("refuses Groth16 generation without artifacts", async () => await expect(proveSpend({} as never, { circuitId: "", wasmUrl: "", zkeyUrl: "" })).rejects.toThrow("No simulated proof fallback"));
});

describe("versioned requests and payroll", () => {
  it("roundtrips existing v1 links", () => { const request = { to: address, amount: 100, memo: "invoice" }; expect(decodePayLink(encodePayLink(request))).toEqual(request); });
  it("rejects fractional requested token amounts", () => expect(decodePayLink(encodePayLink({ to: address, amount: 0.5 }))).toBeNull());
  it("rejects unknown codec versions", () => expect(decodePayLink("SOLZK-PAY|v2|anything")).toBeNull());
  it("prepares a batch without collecting a fee", () => { const summary = payrollSummary(parsePayrollCsv(`payee,amount,memo\n${address},101,Salary`)); expect(summary.total).toBe(101); expect(summary.proposedFeeTokens).toBe(2); expect(summary.requests).toHaveLength(1); });
  it("supports quoted commas", () => expect(parsePayrollCsv(`payee,amount,memo\n${address},100,"Salary, October"`)[0].memo).toBe("Salary, October"));
  it("rejects duplicate payees", () => expect(() => parsePayrollCsv(`payee,amount\n${address},100\n${address},200`)).toThrow("duplicate"));
  it("rejects fractional payroll amounts", () => expect(() => parsePayrollCsv(`payee,amount\n${address},0.5`)).toThrow());
  it("rejects empty roster", () => expect(() => parsePayrollCsv("payee,amount\n")).toThrow());
});
