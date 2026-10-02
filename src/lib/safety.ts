export function assertUnits(value: number, label = "Amount", allowZero = false): void {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`${label} must be a ${allowZero ? "non-negative" : "positive"} safe integer.`);
  }
}

export function assertNullifiers(values: string[]): void {
  if (values.length === 0 || values.length > 16) throw new Error("Select between 1 and 16 input notes.");
  if (values.some((value) => !/^[a-f0-9]{64}$/.test(value))) throw new Error("Malformed nullifier.");
  if (new Set(values).size !== values.length) throw new Error("Duplicate nullifier in transaction.");
}

export function assertSealedNote(note: { ephemeral: string; nonce: string; ciphertext: string }): void {
  // Shape validation is NOT ownership, encryption correctness, or a ZK proof.
  if (!/^[A-Za-z0-9+/]{22}==$/.test(note.ephemeral) ||
      !/^[A-Za-z0-9+/]{16}$/.test(note.nonce) ||
      !/^[A-Za-z0-9+/]{683}=$/.test(note.ciphertext)) {
    throw new Error("Malformed sealed note: expected 16-byte ephemeral, 12-byte nonce and 512-byte ciphertext.");
  }
}

export function mulDivFloor(a: number, b: number, divisor: number): number {
  assertUnits(a, "Operand", true);
  assertUnits(b, "Operand", true);
  assertUnits(divisor, "Divisor");
  const result = BigInt(a) * BigInt(b) / BigInt(divisor);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Integer result exceeds safe range.");
  return Number(result);
}

export function relayerFeeTokens(amount: number): number {
  assertUnits(amount);
  return Math.max(25, Number((BigInt(amount) + 999n) / 1000n));
}

export function isSolzkNote(note: { memo: string }): boolean {
  // Legacy simulation classification only. Production asset IDs must be in the commitment/circuit.
  return !note.memo.startsWith("asset:");
}
