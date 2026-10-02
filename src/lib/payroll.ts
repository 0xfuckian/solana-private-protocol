import { ADDRESS_LEN, encodePayLink } from "./protocol";
import { sealedStatement } from "./spend";
import { assertUnits, mulDivFloor } from "./safety";

export interface PayrollRow { payee: string; amount: number; memo: string }

/** CSV supports quoted fields and escaped quotes; deliberately rejects multiline fields. */
function fields(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i++; }
      else quoted = !quoted;
    } else if (c === "," && !quoted) { result.push(current.trim()); current = ""; }
    else current += c;
  }
  if (quoted) throw new Error("Unclosed quote or multiline CSV field.");
  result.push(current.trim());
  return result;
}

export function parsePayrollCsv(csv: string): PayrollRow[] {
  if (csv.length > 100_000) throw new Error("CSV is too large (100 KB maximum).");
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  const header = fields(lines.shift() ?? "").map(value => value.toLowerCase());
  if (header.join(",") !== "payee,amount" && header.join(",") !== "payee,amount,memo") throw new Error("Use the header payee,amount or payee,amount,memo.");
  if (lines.length < 1 || lines.length > 100) throw new Error("Include between 1 and 100 payees.");
  const seen = new Set<string>();
  return lines.map((line, index) => {
    const cells = fields(line);
    if (cells.length !== header.length) throw new Error(`Row ${index + 2}: wrong column count.`);
    const [payee, rawAmount, memo = ""] = cells;
    if (payee.length !== ADDRESS_LEN || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(payee)) throw new Error(`Row ${index + 2}: invalid shielded address.`);
    if (seen.has(payee)) throw new Error(`Row ${index + 2}: duplicate payee.`);
    seen.add(payee);
    if (!/^\d+$/.test(rawAmount)) throw new Error(`Row ${index + 2}: amount must be whole SOLZK tokens.`);
    const amount = Number(rawAmount);
    assertUnits(amount);
    if (new TextEncoder().encode(memo).length > 120) throw new Error(`Row ${index + 2}: memo exceeds 120 bytes.`);
    return { payee, amount, memo };
  });
}

export function payrollDispatchSummary(rows: { amount: number }[]) {
  const total = rows.reduce((sum, row) => { assertUnits(row.amount); return sum + row.amount; }, 0);
  assertUnits(total);
  const fee = Number((BigInt(total) + 99n) / 100n);
  const debit = total + fee;
  assertUnits(debit);
  return { total, fee, debit };
}

export function payrollBatchDomain(sender: string, outputs: { payee: string; amount: number; commitment: string; sealed: { ephemeral: string; nonce: string; ciphertext: string } }[]) {
  return `payroll:${sender}:${JSON.stringify(outputs.map(output => ({ payee: output.payee, amount: output.amount, commitment: output.commitment, sealed: sealedStatement(output.sealed) })))}`;
}

export function payrollSummary(rows: PayrollRow[]) {
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  assertUnits(total);
  // Design quote only: no fee is collected for request creation.
  const fee = mulDivFloor(total, 100, 10_000) + (total % 100 === 0 ? 0 : 1);
  return { total, proposedFeeTokens: fee, requests: rows.map(row => ({ ...row, fragment: encodePayLink({ to: row.payee, amount: row.amount, memo: row.memo }) })) };
}
