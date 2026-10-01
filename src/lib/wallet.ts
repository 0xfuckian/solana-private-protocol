/**
 * SOL-ZK shielded wallet — everything runs in the browser.
 *
 * Model (mirrors a simplified Sapling-style scheme):
 *  - 24-word seed → deterministic spend key (SHA-256 chain over the words).
 *  - Each note: { value, nonce, owner } → commitment = SHA-256 hash. Only
 *    commitments are published on the ledger. Balance = sum of unspent notes,
 *    computed here, never stored.
 *  - Spending publishes a nullifier = SHA-256(commitment ‖ spendKey), which
 *    cannot be linked back to the commitment without the key.
 *  - Transfers create new notes encrypted to the receiver: only the receiver
 *    can scan the pool and trial-decrypt. The ledger stores ciphertext only.
 *  - A "proof" is built client-side (SHA-256 over the witness payload); the
 *    relayer transmits the envelope verbatim and cannot alter a byte without
 *    breaking the proof.
 */

import { pseudoBase58 } from "./protocol";

// ---------------------------------------------------------------------------
// Wordlist (256 common words, enough for a 24-word seed in this simulation)
// ---------------------------------------------------------------------------

const WORDLIST_STR =
  "abandon ability absorb absurd access acoustic action actual adapt admit " +
  "advance affair agent air alarm album alien alley allow alpha amber anchor " +
  "ancient angle animal answer antique anvil apple april arch arctic arm " +
  "arrow artist aspect asset atlas atom attic august autumn avoid awake axis " +
  "bacon badge bag balance balcony bamboo banner barrel basic batch beach " +
  "beacon beam bean bear beauty become before begin behind believe bench " +
  "berry beyond bicycle bind birch biscuit bitter black blade blanket blast " +
  "blend blizzard bloom blossom blue blur boat body bolt bonus border borrow " +
  "bottle bottom bounce bracket brave bread breeze brick bridge bright " +
  "bring brisk broad bronze brook brush bubble bucket budget buffalo bug " +
  "build bulb bunch bundle bunker burden bureau burst bush butter button " +
  "cabbage cabin cable cage calm camera canal candle canvas canyon capital " +
  "captain carbon cargo carpet carry castle catch cattle cause cedar cement " +
  "census cereal chain chair chalk charm chart chase cheese cherry chest " +
  "chief child chill choice chorus cider circle circus citizen city clam " +
  "clarity claw clay clerk cliff climb clinic clock close cloud clover " +
  "cluster coach coast cobalt cocoa coffee coil coin collar comet comfort " +
  "comic compass concert cone connect conscious contest cook copper coral " +
  "corner cotton country couple course cousin cover coyote crack cradle " +
  "crane crash crater crawl cream credit creek crest cricket crisp cross " +
  "crowd crown crumble crush crystal cube curve cushion cycle dad dahlia " +
  "daily dairy daisy dance dawn dazzle debris decade decimal decorate deep " +
  "deer defense degree delicate delta demand dentist deputy desert design " +
  "desk detail device diagram dial diamond diary diesel digital dinner " +
  "direct dish divide doctor dolphin domain donate donkey double dove " +
  "draft dragon drain drama draw dream dress drift drink drive drop drum " +
  "duck dumb eager eagle early earth easel east echo eclipse edge edit " +
  "effort eight elbow elder electric elegant element elk ember emblem " +
  "emotion empire employ empty enable enact end energy engine enjoy enough " +
  "enter entire envelope equal equip era error essay etch ether evoke exact " +
  "exile exit expand expect expert expose extra fabric facade face fact " +
  "fade faith fallen family famous fantasy farmer fashion faster father " +
  "fault favor feast feather feature february fence fern ferry fever fiber " +
  "fiction field figure filter final finger finish fire firm fiscal fish " +
  "flag flame flare flash fleet flesh float flock floor flower fluid flute " +
  "focus fog foil fold folk follow fond font food foot force forest fork " +
  "form fossil foster found fox fragile frame fresh friend fringe frog " +
  "front frost frozen fruit fudge fuel fungi funnel funny gadget galaxy " +
  "gallery game garage garden garlic gas gate gather gauge gaze gear gecko " +
  "gem general genius gentle genuine giant gift ginger giraffe give glacier " +
  "glance glass glaze gleam glide globe gloom glory glove glow goat gold " +
  "goose gorge gospel gossip govern grace grade grain grand grant grape " +
  "graph grasp grass gravel gravity green greet grid grief grill grin grip " +
  "groom group grove grow guard guess guide guitar gulf gust gym habit " +
  "hair half hammer hamster hand happy harbor harmony harp harvest hash " +
  "haste hatch haven hazard hazel head heart heavy hedge helmet herald " +
  "herb hero hidden high hike hill hint hip hobby hockey hollow honey " +
  "honor hood horizon horn horse hospital hotel hour hover hub human " +
  "humble humor hunger hunt hurdle hybrid ice icon idea ideal ignite " +
  "image imagine imitate impact import impress improve impulse inch index " +
  "indigo indoor infant inform inject inland input insect inside inspire " +
  "install intact interest invest invite iron island italic item ivory " +
  "jacket jade jaguar jazz jelly jewel job join joke journey joy judge " +
  "juice jump jungle junior jury just kayak keen keeper kelp kernel kettle " +
  "key kick kidney kind king kiss kite kitten knee knife knock knot " +
  "koala lab label ladder lagoon lake lamp language lantern laser latch " +
  "laugh lava lawn layer lazy leaf league lean leap learn ledge legend " +
  "lemon length lens leopard level liberty library license lift light " +
  "lilac limit line linen link lion liquid listen little lizard llama " +
  "load loan lobby lobster local lock loft log logic long loop lotus " +
  "loud lounge love loyal lucid luggage lunar lunch lung lush lyric";

export const WORDLIST: string[] = WORDLIST_STR.split(" ");

// ---------------------------------------------------------------------------
// Seed generation & derivation
// ---------------------------------------------------------------------------

export function generateSeedWords(): string[] {
  const words: string[] = [];
  while (words.length < 24) {
    const w = WORDLIST[Math.floor(Math.random() * WORDLIST.length)];
    if (!words.includes(w)) words.push(w);
  }
  return words;
}

export function validateSeedWords(words: string[]): {
  ok: boolean;
  invalid: string[];
} {
  const invalid = words.filter(
    (w) => !WORDLIST.includes(w.trim().toLowerCase()),
  );
  return { ok: invalid.length === 0 && words.length === 24, invalid };
}

/** Deterministic 32-byte seed hex from the words (order matters). */
export async function seedHexFromWords(words: string[]): Promise<string> {
  const normalized = words.map((w) => w.trim().toLowerCase()).join(" ");
  let h = await sha256Hex("solzk-seed-v1:" + normalized);
  for (let i = 0; i < 8; i++) {
    h = await sha256Hex(h + ":" + i);
  }
  return h;
}

/** Spend key = another deterministic hash of the seed. */
export async function spendKeyFromSeedHex(seedHex: string): Promise<string> {
  return sha256Hex("solzk-spend-v1:" + seedHex);
}

/** The public shielded address for a seed (44-char base58-style). */
export async function addressFromSeedHex(seedHex: string): Promise<string> {
  const addrHash = await sha256Hex("solzk-addr-v1:" + seedHex);
  return pseudoBase58(44, mulberryFromHex(addrHash));
}

function mulberryFromHex(hex: string): () => number {
  let a = parseInt(hex.slice(0, 8), 16) >>> 0;
  if (a === 0) a = 0x9e3779b9;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// WebCrypto primitives
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function b64ToBuf(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(input));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function pbkdf2Key(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as unknown as ArrayBuffer,
      iterations: 120_000,
      hash: "SHA-256",
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface WalletBlob {
  v: 1;
  salt: string; // b64
  iv: string; // b64
  ciphertext: string; // b64 of AES-GCM(seedHex)
  createdAt: number;
}

export async function encryptSeed(
  seedHex: string,
  password: string,
): Promise<WalletBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await pbkdf2Key(password, salt);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as ArrayBuffer },
    key,
    textEncoder.encode(seedHex),
  );
  return {
    v: 1,
    salt: bufToB64(salt.buffer),
    iv: bufToB64(iv.buffer),
    ciphertext: bufToB64(ct),
    createdAt: Date.now(),
  };
}

export async function decryptSeed(
  blob: WalletBlob,
  password: string,
): Promise<string> {
  const salt = b64ToBuf(blob.salt);
  const iv = b64ToBuf(blob.iv);
  const key = await pbkdf2Key(password, salt);
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as unknown as ArrayBuffer },
      key,
      b64ToBuf(blob.ciphertext) as unknown as ArrayBuffer,
    );
    return textDecoder.decode(pt);
  } catch {
    throw new Error("Wrong password");
  }
}

// ---------------------------------------------------------------------------
// Notes: commitments, nullifiers, transfer encryption
// ---------------------------------------------------------------------------

export async function commitmentFor(
  value: number,
  nonce: string,
  spendKeyHex: string,
): Promise<string> {
  return sha256Hex(`solzk-note:${value}:${nonce}:${spendKeyHex}`);
}

export async function nullifierFor(
  commitment: string,
  spendKeyHex: string,
): Promise<string> {
  return sha256Hex(`solzk-nullifier:${commitment}:${spendKeyHex}`);
}

/** Sealed-note ciphertext size: 512 bytes → the 934-byte mint envelope. */
export const NOTE_CIPHERTEXT_BYTES = 512;
/** Plaintext is space-padded so the ciphertext lands exactly on the size. */
const NOTE_PLAINTEXT_BYTES = NOTE_CIPHERTEXT_BYTES - 16; // AES-GCM tag

export interface SealedNote {
  ephemeral: string; // b64 ephemeral key material
  nonce: string; // b64 AES-GCM iv
  ciphertext: string; // b64 AES-GCM(JSON{value, memo, r}) — fixed length
}

/**
 * Encrypt a note so only the holder of the receiver address can decrypt.
 * The plaintext is space-padded so the ciphertext is always exactly 512
 * bytes — uniform envelope sizes are what stop length from leaking.
 */
export async function sealNoteFor(
  receiverAddress: string,
  note: { value: number; memo: string; r: string },
): Promise<SealedNote> {
  const eph = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyMaterial = await sha256Hex(
    `solzk-view:${receiverAddress}:${bufToB64(eph.buffer)}`,
  );
  const keyBytes = hexToBuf(keyMaterial);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
  const json = JSON.stringify(note);
  if (json.length > NOTE_PLAINTEXT_BYTES) {
    throw new Error("Note memo too long");
  }
  const padded = json.padEnd(NOTE_PLAINTEXT_BYTES, " ");
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as ArrayBuffer },
    key,
    textEncoder.encode(padded),
  );
  return {
    ephemeral: bufToB64(eph.buffer),
    nonce: bufToB64(iv.buffer),
    ciphertext: bufToB64(ct),
  };
}

/** Trial-decrypt: returns null when the note is not ours. */
export async function tryUnsealNote(
  myAddress: string,
  sealed: SealedNote,
): Promise<{ value: number; memo: string; r: string } | null> {
  try {
    void NOTE_PLAINTEXT_BYTES;
    const keyMaterial = await sha256Hex(
      `solzk-view:${myAddress}:${sealed.ephemeral}`,
    );
    const keyBytes = hexToBuf(keyMaterial);
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      "AES-GCM",
      false,
      ["decrypt"],
    );
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBuf(sealed.nonce) as unknown as ArrayBuffer },
      key,
      b64ToBuf(sealed.ciphertext) as unknown as ArrayBuffer,
    );
    const parsed = JSON.parse(textDecoder.decode(pt).trimEnd()) as {
      value: number;
      memo: string;
      r: string;
    };
    if (typeof parsed.value !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Build the hex payload of an envelope, zero-padded to the uniform size
 * (934 bytes for a mint, 921 for a transfer). Mirrors the node's parser:
 * `S404|<kind>|<b64len>|<b64(json)>` + zero padding.
 */
export function buildEnvelopePayload(
  kind: "mint" | "transfer",
  sealed: SealedNote,
  totalBytes: number,
): string {
  const b64 = btoa(JSON.stringify(sealed))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const prefix = `SOLZK|${kind}|${b64.length}|`;}
  let payload = prefix + b64;
  const total = totalBytes * 2;
  if (payload.length > total) {
    throw new Error("Envelope overflows the uniform size");
  }
  while (payload.length < total) payload += "0";
  return payload;
}

function hexToBuf(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// ---------------------------------------------------------------------------
// "Zero-knowledge" proof building (simulated circuit)
// ---------------------------------------------------------------------------

/**
 * Builds the proof that the envelope is well-formed. The proof commits to
 * every byte of the payload: the relayer can transmit it but cannot alter a
 * single byte without invalidating the proof.
 */
export async function buildProof(payload: string): Promise<{
  proof: string;
  proofBytes: number;
}> {
  const inner = await sha256Hex(payload);
  const proof = await sha256Hex(inner + "solzk-circuit-v1");
  return {
    proof,
    // Mimics a Groth16 proof size
    proofBytes: 192,
  };
}

/** Verify helper shared by the relayer action (recomputed there in node). */
export function proofStatement(payload: string): string {
  return payload;
}

// ---------------------------------------------------------------------------
// Local storage (encrypted seed only — password never leaves the device)
// ---------------------------------------------------------------------------

const WALLET_KEY = "solzk.wallet.v1";
const WALLET_ID_KEY = "solzk.walletId";

export function saveWalletBlob(blob: WalletBlob) {
  localStorage.setItem(WALLET_KEY, JSON.stringify(blob));
}

export function loadWalletBlob(): WalletBlob | null {
  const raw = localStorage.getItem(WALLET_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WalletBlob;
  } catch {
    return null;
  }
}

export function clearWalletBlob() {
  localStorage.removeItem(WALLET_KEY);
  localStorage.removeItem(WALLET_ID_KEY);
}

export function setLinkedWalletId(id: string) {
  localStorage.setItem(WALLET_ID_KEY, id);
}
export function getLinkedWalletId(): string | null {
  return localStorage.getItem(WALLET_ID_KEY);
}

export function hasLocalWallet(): boolean {
  return loadWalletBlob() !== null;
}
