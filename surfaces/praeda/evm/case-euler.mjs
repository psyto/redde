/**
 * CASE FILE — Euler Finance, 2023-03-13 (Ethereum mainnet).
 *
 * The declared, auditable input set of the EVM leg's first reconstruction. Every
 * entry here is a public fact or a public account; nothing here is an inference.
 * The engine renders UNRECONSTRUCTED until the converge-items below are PINNED
 * against an archival endpoint — by design, not by omission (see ../SPEC.md).
 *
 * WHY EULER AS THE FIRST FIRING: exactly as the Solana leg opened on an adjudicated
 * case (Mango, framing settled by a court), the EVM leg opens on a case whose
 * framing is externally settled — a single, exhaustively-documented exploit whose
 * principal RETURNED the funds. Praeda's E/L ledger is a small, separate,
 * reproducible claim next to that settled public record. No live accusation.
 */
export const CASE = {
  name: "Euler Finance 2023-03-13 boundary-flow case",
  chainId: 1, // Ethereum mainnet — but the engine is chain-parameterized (any EVM chain).
  when: "2023-03-13",
  adjudicated: true, // framing externally settled: single documented exploit, funds returned.

  // ---- PINNED — canonical public addresses (high confidence) ----------------
  // Assets drained across the boundary (public record: DAI, WETH, USDC, wstETH).
  // Token contracts are canonical mainnet addresses.
  tokens: {
    DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    wstETH: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
  },

  // ---- CONVERGE — must be resolved on-chain before a ledger is produced ------
  // The boundary = the Euler contracts that HELD the pooled underlying and out of
  // which value crossed. Candidate anchors from the public record (the Euler main
  // module and the exploit contracts); the *literal* boundary is the address whose
  // ERC-20 balance of each drained token fell across W — resolve by reading
  // balanceOf(candidate) at fromBlock vs toBlock and keeping those that emptied.
  // TODO(archival): confirm on-chain which address is the value-leg boundary per token.
  // RESOLVED on-chain (this session, Alchemy archival). Boundary = Euler main module:
  // balanceOf(0x2718…) of all four drained assets fell from millions to ~0 across W
  // (discover.mjs): DAI 8,920,417→0 | WETH 7,705→0.98 | USDC 34,869,180→2.16 | wstETH 66,203→0.006
  boundary: [
    "0x27182842E098f60e3D576794A5bFFb0777E025d3", // Euler main module — literal value-leg boundary
  ],
  // Observed endpoints that are NOT beneficiaries unless a value-conserving path
  // resolves (SPEC attribution boundary). Routers / bridges / CEX omnibus → ROUTE_UNRESOLVED.
  intermediaries: [
    // none declared yet; the dominant endpoint is resolved by the ledger itself.
  ],

  // W pinned by per-asset drain block (discover2.mjs binary search):
  //   fromBlock 16817995 = 2023-03-13T08:50:47Z, all four reserves still intact.
  //   DAI drained @16817996 (08:50) … USDC last @16818065 (09:04).
  //   toBlock  16818067 = 2023-03-13T09:05Z, all four at floor.
  window: { fromBlock: 16817995, toBlock: 16818067 },

  // Reference manifest (SPEC Measure 1): each asset priced at an INDEPENDENT source —
  // Chainlink USD feeds + Lido wstETH rate, read at fromBlock (discover3.mjs). Chainlink
  // was NOT the Euler collapse mechanism (a donateToReserves/self-liquidation exploit),
  // so it is admissible. NOTE (reference-sensitivity): USDC=$0.9910, DAI=$0.9915 — the
  // SVB/USDC-depeg weekend, captured honestly rather than assumed at $1. wstETH/USD is
  // DERIVED = stEthPerToken(1.113925, Lido) × STETH/USD($1595.51). The USD *magnitude* is
  // reference-sensitive (the wstETH leg dominates); the *account sort* is not.
  reference: {
    referenceBlock: 16817995,
    manifest: {
      hash: "chainlink+lido@16817995", // declared content-address of the pinned reference set
      source: "Chainlink latestAnswer (ETH/USDC/DAI/STETH) + Lido wstETH.stEthPerToken",
      assets: [
        { token: "0x6B175474E89094C44Da98b954EedeAC495271d0F", symbol: "DAI", decimals: 18, usd: 0.991531 },
        { token: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH", decimals: 18, usd: 1595.7868 },
        { token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6, usd: 0.991 },
        { token: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0", symbol: "wstETH", decimals: 18, usd: 1777.274722 },
      ],
    },
  },
};
