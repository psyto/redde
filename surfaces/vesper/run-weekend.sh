#!/usr/bin/env bash
# Weekly Vesper readout. Re-emit both sides from chain for the weekend just passed, then assemble,
# verify, append to the append-only log, regenerate the board, and anchor the money-shot on-chain.
# Emits are best-effort: if a chain read fails (RPC limits), readout.mjs falls back to the last good
# claim on disk, so the board still advances. Wire it weekly via com.psyto.vesper-readout.plist.
#
#   RPC=<mainnet-url> KEYPAIR=<devnet-key> ./run-weekend.sh
#   DRY_RUN=1 ./run-weekend.sh    # exercise the whole path, anchor dry-run only — use this to prove
#                                 # node/PATH/deps resolve BEFORE trusting Monday's unattended fire
set -u
cd "$(dirname "$0")"

# launchd's PATH can reach an old system node that these scripts do not run under. Refuse rather
# than half-running: a readout that silently fails is worse than one that is obviously absent,
# because the board would simply stop advancing without saying why.
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "readout: node $(node --version 2>/dev/null || echo 'not found') is too old (need >= 20)." >&2
  echo "         Fix PATH in com.psyto.vesper-readout.plist to lead with a current node." >&2
  exit 2
fi
RPC="${RPC:-https://api.mainnet-beta.solana.com}"          # where the claims are re-emitted from (mainnet)
ANCHOR_RPC="${ANCHOR_RPC:-https://api.devnet.solana.com}"  # where the weekly memo is anchored
KEYPAIR="${KEYPAIR:-$HOME/.config/solana/id.json}"

echo "[readout $(date -u +%FT%TZ)] emit GREEN (Kamino) from chain"
RPC="$RPC" node emit-kamino.mjs || echo "  (kamino emit failed — using last good claim)"
echo "[readout] emit RED (Jupiter) from chain"
RPC="$RPC" node claim.mjs cmls || echo "  (jupiter emit failed — using last good claim)"
SEND="--send"
if [ "${DRY_RUN:-0}" = "1" ]; then SEND=""; echo "[readout] DRY_RUN — anchor will not be sent"; fi
echo "[readout] assemble + verify + append + board + anchor"
node readout.mjs $SEND --keypair "$KEYPAIR" --rpc "$ANCHOR_RPC"
