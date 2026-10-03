import * as snarkjs from "snarkjs";
import fs from "fs";
const vkey = JSON.parse(fs.readFileSync("vkey.json"));
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  JSON.parse(fs.readFileSync("input.json")), "_probe_js/_probe.wasm", "_probe.zkey");
console.log("publicSignals", publicSignals);
console.log("verify", await snarkjs.groth16.verify(vkey, publicSignals, proof));
