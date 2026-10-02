import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { advanceRewardIndex, pendingRewards, REWARD_SCALE, wholeRewards } from "./rewards";
import { transferFeeTokens } from "./protocol";
import { commitmentFor, noteMatchesCommitment } from "./wallet";

describe("bigint reward conservation", () => {
  it("never pays more than funded across arbitrary share splits", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 1_000_000 }), fc.integer({ min: 1, max: 1_000_000 }), fc.integer({ min: 0, max: 1_000_000_000 }), (a, b, funded) => {
      const index = advanceRewardIndex(0n, funded, a + b);
      const left = wholeRewards(pendingRewards({ shares: a, rewardCheckpoint: "0" }, index));
      const right = wholeRewards(pendingRewards({ shares: b, rewardCheckpoint: "0" }, index));
      expect(left + right).toBeLessThanOrEqual(funded);
    }));
  });
  it("retains sub-unit credit without number conversion", () => {
    const index = advanceRewardIndex(0n, 1, 3);
    const pending = pendingRewards({ shares: 1, rewardCheckpoint: "0" }, index);
    expect(pending).toBe(REWARD_SCALE / 3n);
    expect(wholeRewards(pending)).toBe(0);
  });
  it("rounds staker discounted fees upward using exact integer products", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 1_000_000_000 }), amount => {
      const expected = Number((BigInt(amount) * 100n * 7500n + 99_999_999n) / 100_000_000n);
      expect(transferFeeTokens(amount, 2500, 100)).toBe(expected);
    }));
  });
  it("rejects plaintext that does not match the published commitment", async () => {
    const note = { value: 1000, r: "randomness" };
    const owner = "A".repeat(44);
    const commitment = await commitmentFor(note.value, note.r, owner);
    expect(await noteMatchesCommitment(owner, note, commitment)).toBe(true);
    expect(await noteMatchesCommitment(owner, { ...note, value: 1001 }, commitment)).toBe(false);
  });
});
