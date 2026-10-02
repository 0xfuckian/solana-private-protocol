import { assertNullifiers, assertSealedNote, assertUnits } from "./safety";

export interface ChangeOutput {
  value: number;
  commitment: string;
  sealed: { ephemeral: string; nonce: string; ciphertext: string };
}
export interface SpendInputs {
  nullifiers: string[];
  inputTotal: number;
  change?: ChangeOutput;
}

/** Validates DECLARED values, not note ownership or actual input values.
 * Production must enforce these relationships in the audited circuit.
 */
export function validateSpend(spend: SpendInputs, amount: number): void {
  assertUnits(amount);
  assertUnits(spend.inputTotal, "Declared input total");
  assertNullifiers(spend.nullifiers);
  if (spend.inputTotal < amount) throw new Error("Inputs do not cover the spend.");
  const remainder = spend.inputTotal - amount;
  if (remainder === 0) {
    if (spend.change) throw new Error("Unexpected change for an exact spend.");
  } else {
    if (!spend.change || spend.change.value !== remainder) throw new Error("Change must equal declared inputs minus spend.");
    assertUnits(spend.change.value, "Change");
    if (!/^[a-f0-9]{64}$/.test(spend.change.commitment)) throw new Error("Malformed change commitment.");
    assertSealedNote(spend.change.sealed);
  }
}

export function sealedStatement(sealed: { ephemeral: string; nonce: string; ciphertext: string }): string {
  return JSON.stringify({ ephemeral: sealed.ephemeral, nonce: sealed.nonce, ciphertext: sealed.ciphertext });
}

export function spendStatement(domain: string, spend: SpendInputs): string {
  // Fixed field ordering; never serialize caller-controlled object ordering.
  const change = spend.change;
  return JSON.stringify({ version: 2, domain, inputTotal: spend.inputTotal,
    nullifiers: spend.nullifiers,
    change: change ? { value: change.value, commitment: change.commitment,
      sealed: { ephemeral: change.sealed.ephemeral, nonce: change.sealed.nonce, ciphertext: change.sealed.ciphertext } } : null,
  });
}
