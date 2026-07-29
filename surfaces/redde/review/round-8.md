# Codex — round 8 (round-7 P0 closure confirmation)

You pre-committed: "上記 P0 を塞げば Slice 3 signs off." Closed exactly as
specified — please confirm, or flag any gap.

## Applied
- **P0 #1 (snapshot mixing).** After the snapshot, require `st2.data.equals(s0)`;
  everything is computed from those bytes. Final guard re-reads
  `[STATE, mint, reserve, stake_list]` at/after the scan slot and requires full
  State bytes, mint data, reserve lamports+owner, and stake_list bytes all
  unchanged → else STALE.
- **P0 #2 (ticket reconciliation mandatory).** After enumerating tickets, require
  `Σ tickets === circulating_ticket_balance@528` AND
  `count === circulating_ticket_count@520`; mismatch → STALE.
- **Freshness ratified.** Any record `last_update_epoch !== currentEpoch` → STALE
  (both lag and lead).
- **Emergency ratified.** Emergency stakes counted (rent-net) when list-member +
  Stake-owned + both PDA authorities; `emergency_cooling_down` not added to INV-2b
  (already in virtual value).
- **M-INV-2a removed from verdict** → `M-OBS-2a` observation only.
- **P1.** reserve owner must be System Program; `item_size >= 50`;
  `stakeCount <= capacity`; duplicate record pubkey → STALE.

## Live (mainnet epoch 1004, after fixes)
```
GREEN   M-INV-1 hold (mint 1,708,592.412 <= state 1,708,592.415, drift +0.003)
        liability 2,383,199.196 SOL
        M-INV-2b hold: net backing 2,383,216.708 SOL  (margin +17.5)
        48/48 stakes usable, 0 stale, tickets reconciled (1077 = header count/balance)
```

If sound, confirm "Slice 3 signs off" and I'll add Marinade to the board as
invariant class #2 and commit.
