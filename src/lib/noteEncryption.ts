/**
 * SOL-ZK v2 note encryption — the production-shape scheme.
 *
 * Legacy v1 notes derive their AES-GCM key as SHA-256("solzk-view:" +
 * address + ":" + ephemeral): anyone holding the (public) address can
 * decrypt every note. That is a research-simulation shortcut, not
 * encryption, and it stays readable forever for old notes.
 *
 * v2 notes use per-note ephemeral ECDH (P-256) + HKDF-SHA-256 + AES-GCM-256:
 *  - each wallet owns a viewing keypair (ECDH P-256). The public half is
 *    published at registration; the private half never leaves the device
 *    (stored as a JWK encrypted with the wallet password, PBKDF2 120k).
 *  - the sender generates a FRESH ephemeral keypair per note, derives
 *    ECDH(ephemeralPriv, recipientViewPub), runs HKDF with a salt binding
 *    (recipientPub || ephemeralPub) and info "solzk-note-v2", and encrypts
 *    the space-padded note JSON. Ciphertext is exactly 512 bytes, so v2
 *    notes keep the uniform envelope sizes.
 *  - the ephemeral public key (65-byte uncompressed) travels in the sealed
 *    note's optional `epk` field, in the clear — exactly like Sapling's
 *    epk. Tampering with it only destroys the key agreement, never leaks.
 *  - the 1-byte view tag is SHA-256("solzk-vtag-v2:" + recipientPub + ":" +
 *    epk)[0]: computable from public data on both sides, so the scanner
 *    rejects ~255/256 foreign notes WITHOUT an ECDH operation.
 *
 * Security properties (what v1 lacks): only the viewing-private holder can
 * decrypt; every note has forward secrecy from its fresh ephemeral; the
 * server sees pubs and ciphertext only; AES-GCM rejects any tampering.
 * What this still is not: ownership/value/conservation proofs — those need
 * the audited join-split circuit (circuits/solzk-joinsplit.circom).
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Plaintext budget: padded JSON so AES-GCM output is exactly 512 bytes. */
export const V2_PLAINTEXT_BYTES = 512 - 16;
export const V2_INFO = "solzk-note-v2";
export const V2_TAG_DOMAIN = "solzk-vtag-v2";

export interface V2SealedNote {
  ephemeral: string; // 16-byte random, kept for v1 shape compatibility
  nonce: string; // b64 12-byte AES-GCM IV
  ciphertext: string; // b64 512-byte AES-GCM output
  /** b64 65-byte uncompressed P-256 ephemeral public key. Presence marks v2. */
  epk: string;
}

export interface NotePlaintext {
  value: number;
  memo: string;
  r: string;
}

export function isV2Sealed(note: {
  ephemeral: string;
  nonce: string;
  ciphertext: string;
  epk?: unknown;
}): note is V2SealedNote {
  return typeof note.epk === "string" && note.epk.length > 0;
}

function bufToB64(bytes: Uint8Array | ArrayBuffer): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < u.length; i++) binary += String.fromCharCode(u[i]);
  return btoa(binary);
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Raw P-256 viewing public key (b64 of 65-byte uncompressed point). */
export type ViewPubKey = string;

// ---------------------------------------------------------------------------
// Viewing keypair lifecycle
// ---------------------------------------------------------------------------

export interface ViewingKeypair {
  /** b64 65-byte uncompressed P-256 public key — safe to publish. */
  publicKey: ViewPubKey;
  /** JWK private key — encrypt at rest, never transmit. */
  privateJwk: JsonWebKey;
}

export async function generateViewingKeypair(): Promise<ViewingKeypair> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: bufToB64(raw), privateJwk: jwk };
}

export async function importViewingPublic(b64: string): Promise<CryptoKey> {
  const bytes = b64ToBytes(b64);
  if (bytes.length !== 65 || bytes[0] !== 0x04) {
    throw new Error("Malformed P-256 viewing public key.");
  }
  return crypto.subtle.importKey("raw", bytes as BufferSource, { name: "ECDH", namedCurve: "P-256" }, true, []);
}

export async function importViewingPrivate(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
}

// ---------------------------------------------------------------------------
// Key agreement: ECDH -> HKDF(salt = recipientPub || epk) -> AES-GCM-256
// ---------------------------------------------------------------------------

async function agreementKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  saltB64: string,
  usage: KeyUsage[],
): Promise<CryptoKey> {
  const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  const hkdfBase = await crypto.subtle.importKey("raw", bits as BufferSource, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: textEncoder.encode(saltB64) as BufferSource,
      info: textEncoder.encode(V2_INFO) as BufferSource,
    },
    hkdfBase,
    { name: "AES-GCM", length: 256 },
    false,
    usage,
  );
}

function v2Salt(recipientPub: ViewPubKey, epk: string): string {
  return `solzk-note-v2-salt:${recipientPub}:${epk}`;
}

/** 1-byte fast-reject tag from public data only — no private key needed. */
export async function viewTagV2(recipientPub: ViewPubKey, epk: string): Promise<number> {
  const hex = await sha256Hex(`${V2_TAG_DOMAIN}:${recipientPub}:${epk}`);
  return parseInt(hex.slice(0, 2), 16);
}

export async function ephemeralMatchesTagV2(
  recipientPub: ViewPubKey,
  epk: string,
  tag: number,
): Promise<boolean> {
  return (await viewTagV2(recipientPub, epk)) === tag;
}

// ---------------------------------------------------------------------------
// Seal / unseal
// ---------------------------------------------------------------------------

function padPlaintext(note: NotePlaintext): Uint8Array {
  const encoded = textEncoder.encode(JSON.stringify(note));
  if (encoded.length > V2_PLAINTEXT_BYTES) throw new Error("Note memo too long");
  const padded = new Uint8Array(V2_PLAINTEXT_BYTES).fill(32);
  padded.set(encoded);
  return padded;
}

function parsePlaintext(bytes: ArrayBuffer): NotePlaintext | null {
  try {
    const parsed = JSON.parse(textDecoder.decode(bytes).trimEnd()) as {
      value: number;
      memo: string;
      r: string;
    };
    if (!Number.isSafeInteger(parsed.value) || parsed.value <= 0) return null;
    if (typeof parsed.memo !== "string" || typeof parsed.r !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Seal a note so ONLY the viewing-private holder can read it. Needs the
 * recipient's published viewing public key (fetched from the ledger).
 */
export async function sealNoteV2(
  recipientPub: ViewPubKey,
  note: NotePlaintext,
): Promise<V2SealedNote> {
  const recipientKey = await importViewingPublic(recipientPub);
  const ephemeral = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const epkRaw = await crypto.subtle.exportKey("raw", ephemeral.publicKey);
  const epk = bufToB64(epkRaw);
  const aes = await agreementKey(
    ephemeral.privateKey,
    recipientKey,
    v2Salt(recipientPub, epk),
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, aes, padPlaintext(note) as BufferSource);
  if (ct.byteLength !== 512) throw new Error("v2 ciphertext must be 512 bytes");
  const eph = crypto.getRandomValues(new Uint8Array(16));
  return {
    ephemeral: bufToB64(eph),
    nonce: bufToB64(iv),
    ciphertext: bufToB64(ct),
    epk,
  };
}

/** Trial-decrypt with the viewing private key. Null on any failure. */
export async function unsealNoteV2(
  privateJwk: JsonWebKey,
  recipientPub: ViewPubKey,
  sealed: V2SealedNote,
): Promise<NotePlaintext | null> {
  try {
    const priv = await importViewingPrivate(privateJwk);
    const epkKey = await importViewingPublic(sealed.epk);
    const aes = await agreementKey(priv, epkKey, v2Salt(recipientPub, sealed.epk), ["decrypt"]);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(sealed.nonce) as BufferSource },
      aes,
      b64ToBytes(sealed.ciphertext) as BufferSource,
    );
    return parsePlaintext(pt);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Encrypted at-rest storage for the viewing private key.
// Mirrors the wallet blob scheme (PBKDF2 120k + AES-GCM); self-contained so
// the legacy blob shape never changes.
// ---------------------------------------------------------------------------

async function passwordKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", textEncoder.encode(password) as BufferSource, "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 120_000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface EncryptedViewingKey {
  v: 2;
  salt: string;
  iv: string;
  ciphertext: string;
}

export async function encryptViewingKey(
  privateJwk: JsonWebKey,
  password: string,
): Promise<EncryptedViewingKey> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passwordKey(password, salt);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    textEncoder.encode(JSON.stringify(privateJwk)) as BufferSource,
  );
  return { v: 2, salt: bufToB64(salt), iv: bufToB64(iv), ciphertext: bufToB64(ct) };
}

export async function decryptViewingKey(
  blob: EncryptedViewingKey,
  password: string,
): Promise<JsonWebKey> {
  const key = await passwordKey(password, b64ToBytes(blob.salt));
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(blob.iv) as BufferSource },
      key,
      b64ToBytes(blob.ciphertext) as BufferSource,
    );
    const jwk = JSON.parse(textDecoder.decode(pt)) as JsonWebKey;
    if (jwk.kty !== "EC") throw new Error("bad key");
    return jwk;
  } catch {
    throw new Error("Wrong password");
  }
}

const VIEWKEY_STORAGE = "solzk.viewkey.v2";

export function saveEncryptedViewingKey(blob: EncryptedViewingKey): void {
  localStorage.setItem(VIEWKEY_STORAGE, JSON.stringify(blob));
}

export function loadEncryptedViewingKey(): EncryptedViewingKey | null {
  try {
    const raw = localStorage.getItem(VIEWKEY_STORAGE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EncryptedViewingKey;
    if (parsed.v !== 2 || typeof parsed.ciphertext !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearEncryptedViewingKey(): void {
  localStorage.removeItem(VIEWKEY_STORAGE);
}
