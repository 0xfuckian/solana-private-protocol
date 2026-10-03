// Generate circuit vectors.
//
//   node circuits/make-vectors.mjs
//
// The witness and public signals are fully deterministic and match the
// circuit's constraints (Poseidon commitments, Merkle paths, nullifiers,
// conservation). If `circuits/setup.sh` has produced artifacts, this also
// produces a real Groth16 proof and verifies it before writing. Without
// artifacts the vectors still pin the exact values the circuit must accept.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { poseidon2, poseidon4 } from "poseidon-lite";

const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const DEPTH = 20;
// Must match src/lib/poseidon.ts fieldFromString exactly: fold the UTF-8 bytes
// into Fr with Poseidon, 31 bytes per chunk.
const CHUNK = 31;
const encoder = new TextEncoder();
const fieldFromString = (s) => {
  const bytes = encoder.encode(s);
  let h = 0n;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    let chunk = 0n;
    for (const b of bytes.subarray(i, i + CHUNK)) chunk = (chunk << 8n) | BigInt(b);
    h = poseidon2([h, chunk]);
  }
  return h;
};
const commitmentFor = (value, assetId, r, owner) => poseidon4([BigInt(value), BigInt(assetId), fieldFromString(r), fieldFromString(owner)]).toString();
const nullifierFor = (commitment, spendKey) => poseidon2([BigInt(commitment), BigInt(spendKey)]).toString();
const hashPair = (l, r) => poseidon2([BigInt(l), BigInt(r)]).toString();
const ZEROES = ["0"];
for (let i = 0; i < DEPTH; i++) ZEROES.push(hashPair(ZEROES[i], ZEROES[i]));

function pathFor(leaves, index) {
  const siblings = [];
  const pathIndices = [];
  let idx = index;
  let level = leaves.slice();
  for (let d = 0; d < DEPTH; d++) {
    siblings.push(level[idx ^ 1] ?? ZEROES[d]);
    pathIndices.push(idx % 2);
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(hashPair(level[i] ?? ZEROES[d], level[i + 1] ?? ZEROES[d]));
    level = next;
    idx = Math.floor(idx / 2);
  }
  let cur = leaves[index];
  idx = index;
  for (let d = 0; d < DEPTH; d++) {
    cur = idx % 2 === 0 ? hashPair(cur, siblings[d]) : hashPair(siblings[d], cur);
    idx = Math.floor(idx / 2);
  }
  return { siblings, pathIndices, root: cur };
}

const spendKey = fieldFromString("vec-spend-key").toString();
const assetId = 0;
const inValue = [600, 500];
const inR = ["vec-r0", "vec-r1"];
const inOwner = ["vec-owner0", "vec-owner1"];
const c0 = commitmentFor(inValue[0], assetId, inR[0], inOwner[0]);
const c1 = commitmentFor(inValue[1], assetId, inR[1], inOwner[1]);
const p0 = pathFor([c0, c1], 0);
const p1 = pathFor([c0, c1], 1);
if (p0.root !== p1.root) throw new Error("root mismatch");

const feeTokens = 20;
const relayerFee = 0;
const outValue = [480, inValue[0] + inValue[1] - 480 - feeTokens - relayerFee];
const outR = ["vec-out0", "vec-out1"];
const outOwner = ["vec-recv", "vec-owner1"];
const outputCommit = [
  commitmentFor(outValue[0], assetId, outR[0], outOwner[0]),
  commitmentFor(outValue[1], assetId, outR[1], outOwner[1]),
];
const nullifiers = [nullifierFor(c0, spendKey), nullifierFor(c1, spendKey)];
const domainField = fieldFromString("transfer:vec").toString();

const input = {
  root: p0.root,
  nullifier: nullifiers,
  outputCommit,
  assetId: String(assetId),
  feeTokens: String(feeTokens),
  relayerFee: String(relayerFee),
  domain: domainField,
  inValue: inValue.map(String),
  inR: inR.map((s) => fieldFromString(s).toString()),
  inOwner: inOwner.map((s) => fieldFromString(s).toString()),
  spendKey,
  pathElements: [p0.siblings, p1.siblings],
  pathIndices: [p0.pathIndices, p1.pathIndices],
  outValue: outValue.map(String),
  outR: outR.map((s) => fieldFromString(s).toString()),
  outOwner: outOwner.map((s) => fieldFromString(s).toString()),
};
const publicSignals = [input.root, nullifiers[0], nullifiers[1], outputCommit[0], outputCommit[1], String(assetId), String(feeTokens), String(relayerFee), domainField];

const wasm = "circuits/build/kilnen-spend_js/kilnen-spend.wasm";
const zkey = "circuits/build/kilnen-spend.zkey";
let proven = false;
let proof = null;
if (existsSync(wasm) && existsSync(zkey)) {
  const snarkjs = await import("snarkjs");
  const vkey = JSON.parse(readFileSync("circuits/verification_key.json", "utf8"));
  const out = await snarkjs.groth16.fullProve(input, wasm, zkey);
  if (!(await snarkjs.groth16.verify(vkey, out.publicSignals, out.proof))) throw new Error("proof failed verification");
  proven = true;
  proof = out.proof;
  if (out.publicSignals.join(",") !== publicSignals.join(",")) throw new Error("public signal order mismatch");
}

const vectors = {
  note: "Deterministic Kilnen join-split vectors. Values match circuits/kilnen-spend.circom. `proven` is true only when a real proof was generated against the committed artifacts.",
  circuitId: "kilnen-joinsplit-v1",
  depth: DEPTH,
  assetId,
  feeTokens,
  relayerFee,
  root: input.root,
  nullifiers,
  outputCommit,
  domainField,
  input,
  publicSignals,
  proven,
  proof,
};
writeFileSync("circuits/vectors.json", JSON.stringify(vectors, null, 2) + "\n");
console.log("wrote circuits/vectors.json proven=" + proven);
