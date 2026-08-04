#!/usr/bin/env bash
# Weekly Vesper readout. Re-emit both sides from chain for the weekend just passed, then assemble,
# verify, append to the append-only log, regenerate the board, and anchor the money-shot on-chain.
# Emits are best-effort: if a chain read fails (RPC limits), readout.mjs falls back to the last good
# claim on disk, so the board still advances. Wire it weekly via com.psyto.vesper-readout.plist.
#
#   RPC=<mainnet-url> KEYPAIR=<devnet-key> ./run-weekend.sh
set -u
cd "$(dirname "$0")"
RPC="${RPC:-https://api.mainnet-beta.solana.com}"          # where the claims are re-emitted from (mainnet)
ANCHOR_RPC="${ANCHOR_RPC:-https://api.devnet.solana.com}"  # where the weekly memo is anchored
KEYPAIR="${KEYPAIR:-$HOME/.config/solana/id.json}"

echo "[readout $(date -u +%FT%TZ)] emit GREEN (Kamino) from chain"
RPC="$RPC" node emit-kamino.mjs || echo "  (kamino emit failed — using last good claim)"
echo "[readout] emit RED (Jupiter) from chain"
RPC="$RPC" node claim.mjs cmls || echo "  (jupiter emit failed — using last good claim)"
echo "[readout] assemble + verify + append + board + anchor"
node readout.mjs --send --keypair "$KEYPAIR" --rpc "$ANCHOR_RPC"
