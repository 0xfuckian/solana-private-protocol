import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  CONFIRMATIONS_REQUIRED,
  RELAYER_FEE_NOTE_TOKENS,
  SLOT_SECONDS,
  TICKER,
  TOTAL_SUPPLY,
  addressFromHex,
  discountTierForBurned,
  formatTokenAmount,
  hashFromHex,
  transferFeeTokens,
} from "./protocol";
import {
  addressFromSeedHex,
  buildProof,
  clearWalletBlob,
  commitmentFor,
  decryptSeed,
  ephemeralMatchesTag,
  encryptSeed,
  generateSeedWords,
  getLinkedWalletId,
  incomingViewKeyFromSeedHex,
  loadWalletBlob,
  nullifierFor,
  outgoingViewKeyFromSeedHex,
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

const CHAIN_START_KEY = "solzk.chainStart.v1";
const SLOT_START_MS = Date.parse("2026-10-01T00:00:00Z");
const SLOT_MS = 400;
const FAUCET_SIG_KEY = "solzk.faucetSig.v1";

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
  /** This note's 1-byte view tag matched ours — decrypted first in the scan. */
  tagHit?: boolean;
}

export interface ViewKeys {
  incoming: string | null;
  outgoing: string | null;
}

export function useSolzk() {
  const [phase, setPhase] = useState<WalletPhase>("loading");
  const [seedHex, setSeedHex] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number>(0);
  const [notes, setNotes] = useState<MyNote[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanBump, setScanBump] = useState(0);
  const [viewKeys, setViewKeys] = useState<ViewKeys>({
    incoming: null,
    outgoing: null,
  });
  const [tagMatches, setTagMatches] = useState(0);
  const seedWordsRef = useRef<string[] | null>(null);
  const spendKeyRef = useRef<string | null>(null);

  const authUser = useQuery(api.users.currentUser);
  const serverWallet = useQuery(api.protocol.getMyWallet, authUser ? {} : "skip");
  const protocol = useQuery(api.protocol.getState);
  const vaultPool = useQuery(api.vault.getPool);

  const registerWalletMut = useMutation(api.protocol.registerWallet);
  const faucetMut = useMutation(api.protocol.faucet);
  const sendPrivateMut = useMutation(api.protocol.sendPrivate);
  const burnForTierMut = useMutation(api.protocol.burnForTier);
  const redeemMut = useMutation(api.protocol.redeem);
  const depositMut = useMutation(api.vault.deposit);
  const claimFeesMut = useMutation(api.vault.claimFees);
  const withdrawMut = useMutation(api.vault.withdraw);

  // Restore session from localStorage on mount.
  useEffect(() => {
    const blob = loadWalletBlob();
    setPhase(blob ? "locked" : "none");
  }, []);

  const deriveKeys = useCallback(async (sh: string) => {
    const [addr, spend, ivk, ovk] = await Promise.all([
      addressFromSeedHex(sh),
      spendKeyFromSeedHex(sh),
      incomingViewKeyFromSeedHex(sh),
      outgoingViewKeyFromSeedHex(sh),
    ]);
    setAddress(addr);
    spendKeyRef.current = spend;
    setViewKeys({ incoming: ivk, outgoing: ovk });
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
    setViewKeys({ incoming: null, outgoing: null });
    setTagMatches(0);
    setPhase(loadWalletBlob() ? "locked" : "none");
  }, []);

  const forgetWallet = useCallback(() => {
    clearWalletBlob();
    seedWordsRef.current = null;
    spendKeyRef.current = null;
    setSeedHex(null);
    setAddress(null);
    setViewKeys({ incoming: null, outgoing: null });
    setTagMatches(0);
    setPhase("none");
  }, []);

  // The shielded pool, as the node serves it to us: every sealed note and
  // every published nullifier. We trial-decrypt with our key and retire
  // notes whose nullifier has appeared. The node cannot tell which opened.
  const spendableNotes = useQuery(
    api.notes.listSpendableNotes,
    phase === "unlocked" ? {} : "skip",
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!spendableNotes || !address || !spendKeyRef.current) return;
      setScanning(true);
      const published = new Set(spendableNotes.publishedNullifiers ?? []);
      const mine: MyNote[] = [];
      let tags = 0;
      for (const n of spendableNotes.notes) {
        // 1-byte view tag: match my tag first so the scan can prioritise
        // (and on mainnet, skip) foreign notes without a trial decrypt.
        const tagHit =
          n.sealed.ephemeral !== "faucet" &&
          n.sealed.ephemeral !== "none"
            ? await ephemeralMatchesTag(address, n.sealed.ephemeral)
            : false;
        if (tagHit) tags++;
        const opened = await tryUnsealNote(address, n.sealed);
        if (opened) {
          const nullifier = await nullifierFor(
            n.commitment,
            spendKeyRef.current,
          );
          if (!published.has(nullifier)) {
            mine.push({
              _id: n._id,
              commitment: n.commitment,
              sealed: n.sealed,
              slot: n.slot,
              value: opened.value,
              memo: opened.memo,
              tagHit,
            });
          }
        }
      }
      if (cancelled) return;
      // Tag matches first — newest value lands at the top of the wallet.
      mine.sort((a, b) =>
        a.tagHit === b.tagHit
          ? b.slot - a.slot
          : a.tagHit
            ? -1
            : 1,
      );
      setNotes(mine);
      setBalance(mine.reduce((acc, n) => acc + n.value, 0));
      setTagMatches(tags);
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

  /**
   * Build and publish a shielded transfer (spend → receiver + change).
   *
   * Fee handling mirrors the node exactly:
   *  - protocol fee: 2%, discounted by the caller's burn tier;
   *  - fee-in-note ON: the relayer is paid RELAYER_FEE_NOTE_TOKENS out of
   *    the spent value and no SOL is needed — the wallet stays spendable
   *    at zero SOL balance;
   *  - fee-in-note OFF: the sender pays the network fee in SOL.
   */
  const sendPrivate = useCallback(
    async (
      receiver: string,
      amount: number,
      memo: string,
      opts?: { feeInNote?: boolean },
    ) => {
      if (!address || !spendKeyRef.current) throw new Error("Wallet locked");
      if (balance < amount) throw new Error("Insufficient shielded balance");

      // Same fee the node will compute, from the same public tier state.
      const discount = discountTierForBurned(serverWallet?.burnedTokens ?? 0);
      const fee = transferFeeTokens(amount, discount.discountBps);
      const relayerFee = opts?.feeInNote ? RELAYER_FEE_NOTE_TOKENS : 0;
      const net = amount - fee - relayerFee;
      if (net <= 0) {
        throw new Error(
          `Amount too small — fees are ${formatTokenAmount(fee)}${relayerFee ? ` + ${formatTokenAmount(relayerFee)}` : ""} ${TICKER}.`,
        );
      }

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
        value: net,
        memo,
        r,
      });
      const receiverCommitment = await commitmentFor(net, r, receiver);
      const change = acc - amount;
      const changeNote =
        change > 0
          ? await sealNoteFor(address, { value: change, memo: "change", r })
          : null;
      const changeCommitment = changeNote
        ? await commitmentFor(change, "change:" + r, address)
        : "";

      // The proof commits to every byte of the statement.
      const statement = `${nullifiers.join(",")}|${receiver}|${amount}|${receiverCommitment}|${JSON.stringify(receiverNote)}`;
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
        feeInNote: opts?.feeInNote === true,
      });
    },
    [address, balance, notes, sendPrivateMut, serverWallet],
  );

  /** Select notes and produce nullifiers for a shielded spend of `amount`. */
  const buildSpend = useCallback(
    async (amount: number) => {
      if (!spendKeyRef.current) throw new Error("Wallet locked");
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
      return { nullifiers, selected, acc };
    },
    [notes],
  );

  /** Burn SOLZK from your notes to unlock a permanent fee-discount tier. */
  const burnForTier = useCallback(
    async (amountTokens: number) => {
      if (!address || !spendKeyRef.current) throw new Error("Wallet locked");
      const { nullifiers } = await buildSpend(amountTokens);
      const statement = `burn:${address}:${amountTokens}:${nullifiers.join(",")}`;
      const { proof } = await buildProof(statement);
      const res = await burnForTierMut({ amountTokens, nullifiers, proof });
      refreshNotes();
      return res as {
        burnedTokens: number;
        tierLabel: string;
        discountBps: number;
        signature: string;
      };
    },
    [address, buildSpend, burnForTierMut, refreshNotes],
  );

  /**
   * Redeem — the private exit. Burn notes, receive SOL from the protocol
   * liquidity reserve at the exit rate; the tokens leave the supply forever.
   */
  const redeemTokens = useCallback(
    async (amountTokens: number) => {
      if (!address || !spendKeyRef.current) throw new Error("Wallet locked");
      const { nullifiers } = await buildSpend(amountTokens);
      const statement = `redeem:${address}:${amountTokens}:${nullifiers.join(",")}`;
      const { proof } = await buildProof(statement);
      const res = await redeemMut({ amountTokens, nullifiers, proof });
      refreshNotes();
      return res as {
        netLamports: number;
        feeLamports: number;
        signature: string;
        slot: number;
      };
    },
    [address, buildSpend, redeemMut, refreshNotes],
  );

  /**
   * Read-only scan: trial-decrypt the whole pool with someone else's
   * address (their incoming view key, in this devnet build). Returns what
   * they hold — values and memos — without any spend authority.
   */
  const scanAddress = useCallback(
    async (addr: string) => {
      const out: {
        commitment: string;
        value: number;
        memo: string;
        slot: number;
      }[] = [];
      for (const n of spendableNotes?.notes ?? []) {
        const opened = await tryUnsealNote(addr, n.sealed);
        if (opened) {
          out.push({
            commitment: n.commitment,
            value: opened.value,
            memo: opened.memo,
            slot: n.slot,
          });
        }
      }
      return out;
    },
    [spendableNotes],
  );

  /** Deposit SOLZK into the vault — like adding liquidity to a pool. */
  const depositToVault = useCallback(
    async (amount: number) => {
      if (balance < amount) throw new Error("Insufficient shielded balance");
      const { nullifiers } = await buildSpend(amount);
      const statement = `deposit:${address}:${amount}:${nullifiers.join(",")}`;
      const { proof } = await buildProof(statement);
      await depositMut({ amountTokens: amount, nullifiers, proof });
      refreshNotes();
    },
    [address, balance, buildSpend, depositMut, refreshNotes],
  );

  /** Claim the depositor payout — the vault's share of protocol fees. */
  const claimVaultFees = useCallback(async () => {
    const res = await claimFeesMut({});
    refreshNotes();
    return res as { claimedLamports: number };
  }, [claimFeesMut, refreshNotes]);

  /** Withdraw from the vault: burn shares, receive a fresh sealed note. */
  const withdrawFromVault = useCallback(
    async (shares: number) => {
      if (!address) throw new Error("Wallet locked");
      const r = crypto.randomUUID();
      // The pool pro-ratas the token amount; we seal a note of the estimate
      // and the node verifies the claim on its own accounting.
      const pool = vaultPool;
      if (!pool) throw new Error("Pool not loaded");
      const tokensOut = Math.floor(
        (shares * pool.depositedTokens) / Math.max(1, pool.totalShares),
      );
      const sealed = await sealNoteFor(address, {
        value: tokensOut,
        memo: "vault withdraw",
        r,
      });
      const commitment = await commitmentFor(tokensOut, r, address);
      const statement = `withdraw:${address}:${shares}:${commitment}`;
      const { proof } = await buildProof(statement);
      const res = await withdrawMut({
        shares,
        sealedNote: sealed,
        commitment,
        proof,
      });
      refreshNotes();
      return res as { tokensOut: number };
    },
    [address, vaultPool, withdrawMut, refreshNotes],
  );

  const progressToSellout = useMemo(() => {
    if (!protocol) return 0;
    return Math.min(1, protocol.mintedTokens / TOTAL_SUPPLY);
  }, [protocol]);

  return {
    // session
    phase,
    authUser,
    serverWallet,
    protocol,
    vaultPool,
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
    burnForTier,
    redeemTokens,
    depositToVault,
    claimVaultFees,
    withdrawFromVault,
    buildSpend,
    scanAddress,
    // shielded state
    balance,
    notes,
    scanning,
    refreshNotes,
    viewKeys,
    tagMatches,
    confirmationsRequired: CONFIRMATIONS_REQUIRED,
    slotSeconds: SLOT_SECONDS,
    progressToSellout,
  };
}
