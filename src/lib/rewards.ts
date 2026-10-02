import { assertUnits } from "./safety";

export const REWARD_SCALE = 1_000_000_000_000_000_000n;
export interface RewardPosition { shares: number; rewardCheckpoint?: string; pendingRewardScaled?: string; accumulatedFees?: number }
export interface RewardIndex { rewardIndex?: string; feePerShare?: number }

/** Legacy numeric indices cannot recover already-lost precision. This converts
 * the stored legacy snapshot once; new accrual uses decimal bigint strings.
 */
export function readRewardIndex(pool: RewardIndex): bigint {
  if (pool.rewardIndex !== undefined) return BigInt(pool.rewardIndex);
  const legacy = pool.feePerShare ?? 0;
  if (!Number.isFinite(legacy) || legacy < 0) throw new Error("Invalid legacy reward index.");
  return BigInt(Math.trunc(legacy)) * (REWARD_SCALE / 1_000_000_000_000n);
}

export function pendingRewards(position: RewardPosition, index: bigint): bigint {
  assertUnits(position.shares, "Shares", true);
  if (position.rewardCheckpoint === undefined) {
    // Existing accumulatedFees is a historical whole-unit debt, not pending.
    const debt = position.accumulatedFees ?? 0;
    assertUnits(debt, "Legacy reward debt", true);
    const accrued = BigInt(position.shares) * index - BigInt(debt) * REWARD_SCALE;
    return accrued > 0n ? accrued : 0n;
  }
  const checkpoint = BigInt(position.rewardCheckpoint);
  if (index < checkpoint) throw new Error("Reward index moved backwards.");
  return BigInt(position.pendingRewardScaled ?? "0") + BigInt(position.shares) * (index - checkpoint);
}

export function wholeRewards(scaled: bigint): number {
  const whole = scaled / REWARD_SCALE;
  if (scaled < 0n || whole > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Reward value outside safe range.");
  return Number(whole);
}

export function advanceRewardIndex(index: bigint, amount: number, shares: number): bigint {
  assertUnits(amount, "Reward funding", true);
  assertUnits(shares, "Shares", true);
  return shares > 0 ? index + BigInt(amount) * REWARD_SCALE / BigInt(shares) : index;
}
