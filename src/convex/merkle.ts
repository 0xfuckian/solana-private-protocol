import { poseidon2 } from "poseidon-lite";
import { v } from "convex/values";
import { query, type MutationCtx } from "./_generated/server";

export const TREE_DEPTH = 26;
export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const hashPair = (left: string, right: string) => poseidon2([BigInt(left), BigInt(right)]).toString();
export const ZEROES: string[] = ["0"];
for (let i = 0; i < TREE_DEPTH; i++) ZEROES.push(hashPair(ZEROES[i], ZEROES[i]));

async function node(ctx: MutationCtx, level: number, index: number) {
  return ctx.db.query("merkleTreeNodes").withIndex("by_position", q => q.eq("level", level).eq("index", index)).unique();
}

/** Legacy SHA-256 commitments are mapped into Fr; production must use the audited circuit's native commitment. */
export async function appendCommitment(ctx: MutationCtx, commitment: string, slot: number): Promise<number> {
  if (!/^[a-f0-9]{64}$/.test(commitment)) throw new Error("Malformed commitment.");
  let state = await ctx.db.query("merkleState").withIndex("by_key", q => q.eq("key", "global")).unique();
  if (!state) {
    const id = await ctx.db.insert("merkleState", { key: "global", nextIndex: 0, root: ZEROES[TREE_DEPTH] });
    state = (await ctx.db.get(id))!;
  }
  const leafIndex = state.nextIndex;
  if (leafIndex >= 2 ** TREE_DEPTH) throw new Error("Commitment tree is full.");
  let index = leafIndex;
  let hash = (BigInt(`0x${commitment}`) % FIELD).toString();
  for (let level = 0; level <= TREE_DEPTH; level++) {
    const current = await node(ctx, level, index);
    if (current) await ctx.db.patch(current._id, { hash });
    else await ctx.db.insert("merkleTreeNodes", { level, index, hash });
    if (level < TREE_DEPTH) {
      const sibling = await node(ctx, level, index ^ 1);
      hash = index % 2 === 0 ? hashPair(hash, sibling?.hash ?? ZEROES[level]) : hashPair(sibling?.hash ?? ZEROES[level], hash);
      index = Math.floor(index / 2);
    }
  }
  await ctx.db.patch(state._id, { nextIndex: leafIndex + 1, root: hash });
  await ctx.db.insert("merkleRoots", { root: hash, leafCount: leafIndex + 1, slot, createdAt: Date.now() });
  const roots = await ctx.db.query("merkleRoots").withIndex("by_created").order("desc").take(101);
  if (roots.length > 100) await ctx.db.delete(roots[100]._id);
  return leafIndex;
}

export async function appendNote(ctx: MutationCtx, note: { commitment: string; sealed: { ephemeral: string; nonce: string; ciphertext: string }; slot: number; createdAt: number }) {
  const existing = await ctx.db.query("notes").withIndex("by_commitment", q => q.eq("commitment", note.commitment)).first();
  if (existing) throw new Error("Commitment already exists.");
  // Faucet registration receipts carry no spendable value and are not leaves.
  const leafIndex = note.sealed.ephemeral === "faucet" ? undefined : await appendCommitment(ctx, note.commitment, note.slot);
  return ctx.db.insert("notes", { ...note, leafIndex });
}

export const getPath = query({
  args: { commitment: v.string() },
  handler: async (ctx, { commitment }) => {
    const leaf = await ctx.db.query("notes").withIndex("by_commitment", q => q.eq("commitment", commitment)).first();
    if (leaf?.leafIndex === undefined) throw new Error("Legacy note is not indexed in the new tree; migration is required.");
    const state = await ctx.db.query("merkleState").withIndex("by_key", q => q.eq("key", "global")).unique();
    let index = leaf.leafIndex;
    const siblings: string[] = [];
    const pathIndices: number[] = [];
    for (let level = 0; level < TREE_DEPTH; level++) {
      const sibling = await ctx.db.query("merkleTreeNodes").withIndex("by_position", q => q.eq("level", level).eq("index", index ^ 1)).unique();
      siblings.push(sibling?.hash ?? ZEROES[level]);
      pathIndices.push(index % 2);
      index = Math.floor(index / 2);
    }
    return { root: state!.root, leafIndex: leaf.leafIndex, siblings, pathIndices, commitmentMapping: "legacy-sha256-mod-fr" };
  },
});
