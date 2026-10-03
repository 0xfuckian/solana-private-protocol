#!/usr/bin/env bash
# Kilnen circuit build + Groth16 setup — reproducible, single-party dev setup.
#
#   ./circuits/setup.sh
#
# Produces (all under circuits/build/):
#   kilnen-spend.r1cs / _js/kilnen-spend.wasm / _js/witness_calculator.js
#   kilnen-spend.zkey            — proving key
#   verification_key.json        — verification key (also copied to circuits/)
#
# WARNING: this is a SINGLE-PARTY development setup. The Powers-of-Tau and
# phase-2 contributions here are local and their toxic waste is not destroyed
# by multiple independent parties. Production requires a multi-party ceremony
# with published transcripts. The circuit constraints are real; the setup
# trust is not production-grade.
set -euo pipefail
cd "$(dirname "$0")/.."

BUILD=circuits/build
PTAU=$BUILD/pot16.ptau
mkdir -p "$BUILD"

echo "== compile =="
bunx circom2 --r1cs --wasm --sym -o "$BUILD" circuits/kilnen-spend.circom

if [ ! -f "$PTAU" ]; then
  echo "== powers of tau (2^16) =="
  bunx snarkjs powersoftau new bn128 16 "$BUILD/pot16_0000.ptau" -v
  bunx snarkjs powersoftau contribute "$BUILD/pot16_0000.ptau" "$BUILD/pot16_0001.ptau" \
    --name="kilnen-dev-setup" -e="${KILNEN_SETUP_ENTROPY:-kilnen development setup entropy}"
  bunx snarkjs powersoftau prepare phase2 "$BUILD/pot16_0001.ptau" "$PTAU" -v
fi

echo "== groth16 setup =="
bunx snarkjs groth16 setup "$BUILD/kilnen-spend.r1cs" "$PTAU" "$BUILD/kilnen-spend_0000.zkey"
bunx snarkjs zkey contribute "$BUILD/kilnen-spend_0000.zkey" "$BUILD/kilnen-spend.zkey" \
  --name="kilnen-dev-contributor" -e="${KILNEN_ZKEY_ENTROPY:-kilnen zkey dev entropy}"
bunx snarkjs zkey export verificationkey "$BUILD/kilnen-spend.zkey" "$BUILD/verification_key.json"

cp "$BUILD/verification_key.json" circuits/verification_key.json
echo "== done: $BUILD/kilnen-spend.zkey =="
