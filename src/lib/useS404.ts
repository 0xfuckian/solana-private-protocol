import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  CONFIRMATIONS_REQUIRED,
  SLOT_SECONDS,
  TOTAL_SUPPLY,
  addressFromHex,
  hashFromHex,
} from "./protocol";
import {
  addressFromSeedHex,
  buildProof,
  clearWalletBlob,
  commitmentFor,
  decryptSeed,
  encryptSeed,
  generateSeedWords,
  getLinkedWalletId,
  loadWalletBlob,
  nullifierFor,
  saveWalletBlob,
  sealNoteFor,
  seedHexFromWords,
  setLinkedWalletId,
  spendKeyFromSeedHex,
  tryUnsealNote,
  validateSeedWords,
  type SealedNote,
} from "./wallet";

// ---------------------------------------------------------------------------
// Public chain simulation helpers
// ---------------------------------------------------------------------------

const CHAIN_START_KEY = "s404.chainStart.v1";
const SLOT_START_MS = Date.parse("2026-09-30T00:00:00Z");
const SLOT_MS = 400;
const FAUCET_SIG_KEY = "s404.faucetSig.v1";

export function getChainStart(): number {
  if (typeof window === "undefined") return SLOT_START_MS;
  const raw = localStorage.getItem(CHAIN_START_KEY);
  if (!raw) {
    localStorage.setItem(CHAIN_START_KEY, String(SLOT_START_MS));
    return SLOT_START_MS;
  }
  return Number(raw);
}

export function currentSlot(): number {
  return Math.floor((Date.now() - getChainStart()) / SLOT_MS);
}

export function slotToTimestamp(slot: number): number {
  return getChainStart() + slot * SLOT_MS;
}

export function makeSignature(): string {
  return hashFromHex(
    addressFromHex(
      Array.from({ length: 32 }, () =>
        Math.floor(Math.random() * 16).toString(16),
      ).join(""),
    ),
  );
}

export function recordFaucetSignature(sig: string) {
  try {
    localStorage.setItem(FAUCET_SIG_KEY, sig);
  } catch {
    /* storage unavailable */
  }
}

export function readFaucetSignature(): string {
  try {
    return localStorage.getItem(FAUCET_SIG_KEY) ?? "";
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

export type WalletPhase = "loading" | "none" | "locked" | "unlocked";

export interface MyNote {
  _id: string;
  commitment: string;
  sealed: SealedNote;
  slot: number;
  value: number;
  memo: string;
}

export function useS404() {
  const [phase, setPhase] = useState<WalletPhase>("loading");
  const [seedHex, setSeedHex] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number>(0);
  const [notes, setNotes] = useState<MyNote[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanBump, setScanBump] = useState(0);
  const seedWordsRef = useRef<string[] | null>(null);
  const spendKeyRef = useRef<string | null>(null);

  const authUser = useQuery(api.users.currentUser);
  const serverWallet = useQuery(api.protocol.getMyWallet, authUser ? {} : "skip");
  const protocol = useQuery(api.protocol.getState);

  const registerWalletMut = useMutation(api.protocol.registerWallet);
  const faucetMut = useMutation(api.protocol.faucet);
  const sendPrivateMut = useMutation(api.protocol.sendPrivate);

  // Restore session from localStorage on mount.
  useEffect(() => {
    const blob = loadWalletBlob();
    setPhase(blob ? "locked" : "none");
  }, []);

  const deriveKeys = useCallback(async (sh: string) => {
    const [addr, spend] = await Promise.all([
      addressFromSeedHex(sh),
      spendKeyFromSeedHex(sh),
    ]);
    setAddress(addr);
    spendKeyRef.current = spend;
  }, []);

  /** Unlock with password: decrypt the local seed, derive keys, link. */
  const unlock = useCallback(
    async (password: string): Promise<boolean> => {
      setError(null);
      const blob = loadWalletBlob();
      if (!blob) {
        setError("No wallet on this device.");
        return false;
      }
      try {
        const sh = await decryptSeed(blob, password);
        setSeedHex(sh);
        await deriveKeys(sh);
        setPhase("unlocked");
        if (!getLinkedWalletId() && serverWallet) {
          setLinkedWalletId(serverWallet.address);
        }
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Wrong password");
        return false;
      }
    },
    [deriveKeys, serverWallet],
  );

  /** Create a fresh wallet: 24 words + password. Words are shown once. */
  const createWallet = useCallback(
    async (password: string): Promise<string[]> => {
      setError(null);
      const words = generateSeedWords();
      const sh = await seedHexFromWords(words);
      const blob = await encryptSeed(sh, password);
      saveWalletBlob(blob);
      seedWordsRef.current = words;
      setSeedHex(sh);
      await deriveKeys(sh);
      setPhase("unlocked");
      return words;
    },
    [deriveKeys],
  );

  /** Restore from words. */
  const restoreWallet = useCallback(
    async (words: string[], password: string): Promise<boolean> => {
      setError(null);
      const check = validateSeedWords(words);
      if (!check.ok) {
        setError(`Unrecognised words: ${check.invalid.slice(0, 3).join(", ")}`);
        return false;
      }
      const sh = await seedHexFromWords(words);
      const blob = await encryptSeed(sh, password);
      saveWalletBlob(blob);
      setSeedHex(sh);
      await deriveKeys(sh);
      setPhase("unlocked");
      return true;
    },
    [deriveKeys],
  );

  const lock = useCallback(() => {
    setSeedHex(null);
    setAddress(null);
    spendKeyRef.current = null;
    seedWordsRef.current = null;
    setBalance(0);
    setNotes([]);
    setPhase(loadWalletBlob() ? "locked" : "none");
  }, []);

  const forgetWallet = useCallback(() => {
    clearWalletBlob();
    seedWordsRef.current = null;
    spendKeyRef.current = null;
    setSeedHex(null);
    setAddress(null);
    setPhase("none");
  }, []);

  // The shielded pool, as the node serves it to us: every unspent sealed
  // note. We trial-decrypt each with our key; the node cannot tell which
  // ones open.
  const spendableNotes = useQuery(
    api.notes.listSpendableNotes,
    phase === "unlocked" ? {} : "skip",
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!spendableNotes || !address) return;
      setScanning(true);
      const mine: MyNote[] = [];
      for (const n of spendableNotes.notes) {
        const opened = await tryUnsealNote(address, n.sealed);
        if (opened) {
          mine.push({
            _id: n._id,
            commitment: n.commitment,
            sealed: n.sealed,
            slot: n.slot,
            value: opened.value,
            memo: opened.memo,
          });
        }
      }
      if (cancelled) return;
      setNotes(mine);
      setBalance(mine.reduce((acc, n) => acc + n.value, 0));
      setScanning(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [spendableNotes, address, scanBump]);

  const refreshNotes = useCallback(() => setScanBump((b) => b + 1), []);

  /** Register the derived address with the node and seed the devnet faucet. */
  const registerOnChain = useCallback(
    async (faucetLamports: number) => {
      if (!address || !spendKeyRef.current) throw new Error("Wallet locked");
      const id = await registerWalletMut({
        address,
        commitment: await commitmentFor(0, "registration", spendKeyRef.current),
        fundingLamports: faucetLamports,
      });
      setLinkedWalletId(address);
      const sig = makeSignature();
      recordFaucetSignature(sig);
      return { walletId: id as string, faucetSignature: sig };
    },
    [address, registerWalletMut],
  );

  const topUpFaucet = useCallback(
    async (lamports: number) => {
      const next = await faucetMut({ lamports });
      recordFaucetSignature(makeSignature());
      return next;
    },
    [faucetMut],
  );

  /** Build and publish a shielded transfer (spend → receiver + change). */
  const sendPrivate = useCallback(
    async (receiver: string, amount: number, memo: string) => {
      if (!address || !spendKeyRef.current) throw new Error("Wallet locked");
      if (balance < amount) throw new Error("Insufficient shielded balance");

      // Greedy note selection.
      const sorted = [...notes].sort((a, b) => b.value - a.value);
      const selected: MyNote[] = [];
      let acc = 0;
      for (const n of sorted) {
        if (acc >= amount) break;
        selected.push(n);
        acc += n.value;
      }
      if (acc < amount)
        throw new Error("No combination of notes covers that amount");

      const nullifiers: string[] = [];
      for (const n of selected) {
        nullifiers.push(await nullifierFor(n.commitment, spendKeyRef.current));
      }

      const r = crypto.randomUUID();
      const receiverNote = await sealNoteFor(receiver, {
        value: amount,
        memo,
        r,
      });
      // The commitment only needs sender-known info: value, randomness and
      // the (public) receiver address. Ownership binds later, when the
      // receiver derives a nullifier with their own spend key.
      const receiverCommitment = await commitmentFor(amount, r, receiver);
      const change = acc - amount;
      const changeNote =
        change > 0
          ? await sealNoteFor(address, { value: change, memo: "change", r })
          : null;
      const changeCommitment = changeNote
        ? await commitmentFor(change, "change:" + r, address)
        : "";

      // The proof commits to every byte of the statement.
      const statement = `${nullifiers.join(",")}|${receiver}|${amount}|${JSON.stringify(receiverNote)}`;
      const { proof } = await buildProof(statement);

      return sendPrivateMut({
        nullifiers,
        receiver,
        amount,
        receiverCommitment,
        sealedNote: receiverNote,
        changeNote:
          changeNote ?? { ephemeral: "none", nonce: "none", ciphertext: "none" },
        changeCommitment,
        proof,
      });
    },
    [address, balance, notes, sendPrivateMut],
  );

  const progressToNextMilestone = useMemo(() => {
    if (!protocol) return 0;
    return Math.min(1, protocol.mintedTokens / TOTAL_SUPPLY);
  }, [protocol]);

  return {
    // session
    phase,
    authUser,
    serverWallet,
    protocol,
    error,
    setError,
    // keys
    seedHex,
    address,
    hasWords: seedWordsRef.current !== null,
    getWords: () => seedWordsRef.current,
    // actions
    createWallet,
    restoreWallet,
    unlock,
    lock,
    forgetWallet,
    registerOnChain,
    topUpFaucet,
    sendPrivate,
    // shielded state
    balance,
    notes,
    scanning,
    refreshNotes,
    confirmationsRequired: CONFIRMATIONS_REQUIRED,
    slotSeconds: SLOT_SECONDS,
    progressToNextMilestone,
  };
}
