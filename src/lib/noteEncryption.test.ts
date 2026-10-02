import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  decryptViewingKey,
  encryptViewingKey,
  ephemeralMatchesTagV2,
  generateViewingKeypair,
  isV2Sealed,
  sealNoteV2,
  unsealNoteV2,
  viewTagV2,
} from "./noteEncryption";

describe("v2 ECDH note encryption", () => {
  it("round-trips a note for the viewing-key holder", async () => {
    const recipient = await generateViewingKeypair();
    const sealed = await sealNoteV2(recipient.publicKey, { value: 1000, memo: "hello", r: "r1" });
    expect(isV2Sealed(sealed)).toBe(true);
    expect(atob(sealed.ciphertext).length).toBe(512);
    expect(atob(sealed.epk).length).toBe(65);
    const opened = await unsealNoteV2(recipient.privateJwk, recipient.publicKey, sealed);
    expect(opened).toEqual({ value: 1000, memo: "hello", r: "r1" });
  });

  it("round-trips arbitrary unicode memos at the fixed size", async () => {
    const recipient = await generateViewingKeypair();
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 60 }), async (memo) => {
        const sealed = await sealNoteV2(recipient.publicKey, { value: 7, memo, r: "x" });
        expect(atob(sealed.ciphertext).length).toBe(512);
        const opened = await unsealNoteV2(recipient.privateJwk, recipient.publicKey, sealed);
        expect(opened?.memo).toBe(memo);
      }),
      { numRuns: 25 },
    );
  });

  it("a stranger's viewing key decrypts nothing", async () => {
    const recipient = await generateViewingKeypair();
    const stranger = await generateViewingKeypair();
    const sealed = await sealNoteV2(recipient.publicKey, { value: 1000, memo: "", r: "r1" });
    expect(await unsealNoteV2(stranger.privateJwk, stranger.publicKey, sealed)).toBeNull();
  });

  it("rejects tampering with ciphertext, nonce, or epk", async () => {
    const recipient = await generateViewingKeypair();
    const sealed = await sealNoteV2(recipient.publicKey, { value: 1000, memo: "", r: "r1" });
    const flip = (b64: string): string => {
      const bytes = atob(b64);
      const mutated = String.fromCharCode(bytes.charCodeAt(0) ^ 1) + bytes.slice(1);
      return btoa(mutated);
    };
    for (const bad of [
      { ...sealed, ciphertext: flip(sealed.ciphertext) },
      { ...sealed, nonce: flip(sealed.nonce) },
      { ...sealed, epk: flip(sealed.epk) },
    ]) {
      expect(await unsealNoteV2(recipient.privateJwk, recipient.publicKey, bad)).toBeNull();
    }
  });

  it("uses fresh randomness per note (no key/nonce reuse signal)", async () => {
    const recipient = await generateViewingKeypair();
    const a = await sealNoteV2(recipient.publicKey, { value: 1, memo: "", r: "same" });
    const b = await sealNoteV2(recipient.publicKey, { value: 1, memo: "", r: "same" });
    expect(a.epk).not.toBe(b.epk);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("view tags agree for the right recipient and reject otherwise", async () => {
    const recipient = await generateViewingKeypair();
    const other = await generateViewingKeypair();
    const sealed = await sealNoteV2(recipient.publicKey, { value: 1, memo: "", r: "r" });
    const tag = await viewTagV2(recipient.publicKey, sealed.epk);
    expect(await ephemeralMatchesTagV2(recipient.publicKey, sealed.epk, tag)).toBe(true);
    // A different recipient's pubkey almost surely yields a different tag.
    const otherTag = await viewTagV2(other.publicKey, sealed.epk);
    expect(await ephemeralMatchesTagV2(other.publicKey, sealed.epk, tag)).toBe(otherTag === tag);
  });

  it("viewing private key survives password-encrypted storage; wrong password fails", async () => {
    const recipient = await generateViewingKeypair();
    const blob = await encryptViewingKey(recipient.privateJwk, "correct-horse-8");
    const back = await decryptViewingKey(blob, "correct-horse-8");
    expect(back.d).toBe(recipient.privateJwk.d);
    await expect(decryptViewingKey(blob, "wrong-password")).rejects.toThrow("Wrong password");
  });

  it("rejects malformed viewing public keys at import", async () => {
    await expect(sealNoteV2("not-base64!!!", { value: 1, memo: "", r: "r" })).rejects.toThrow();
    await expect(
      sealNoteV2(btoa("too-short"), { value: 1, memo: "", r: "r" }),
    ).rejects.toThrow(/Malformed/);
  });
});
