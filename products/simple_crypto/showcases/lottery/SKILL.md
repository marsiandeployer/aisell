## What is this project

LotteryFactory is a blockchain lottery widget (PancakeSwap Lottery V2 fork). Admin deploys a lottery contract, users buy tickets and win up to x100 their bet. Admin earns 0-30% commission from ticket sales.

- **Live demo:** https://appsource.github.io/lottery/
- **Repo:** https://github.com/noxonsu/LotteryFactory
- **Landing:** https://onout.org/lottery/

For deeper technical reference, see [LotteryFactory/SKILL.md](https://github.com/noxonsu/LotteryFactory/blob/main/SKILL.md).

## Stack

- **Frontend:** React (CRA), TypeScript
- **Contracts:** Solidity (PancakeSwap Lottery V2 fork), ABI in `static/contracts/source/artifacts/PancakeSwapLottery.json`
- **Distribution:** WordPress plugin (`lotteryfactory.php`) + standalone
- **Config:** `window.SO_LotteryConfig` in `frontend/public/index.html`
- **CI/CD:** GitHub Actions (build + deploy to appsource GitHub Pages)

## Repository structure

- `frontend/` — React CRA frontend
  - `public/index.html` — Contains `window.SO_LotteryConfig` (edit this to change network/contract)
  - `src/` — React source code
- `lib/` — Compiled browser deployer (rollup bundle)
- `src/deployer/` — TypeScript deployer source (`index.ts`, `constants.ts`)
- `static/contracts/source/artifacts/PancakeSwapLottery.json` — Contract ABI + bytecode
- `lotteryfactory.php` — WordPress plugin entry point
- `.github/workflows/deploy.yml` — CI/CD pipeline

## Build & Deploy

Build contracts: `npm run build` (rollup to `lib/`). Build frontend: `cd frontend && npm run build_clean` (React CRA to `frontend/build/`). CI on push to main: build, SCP to farm.wpmix.net, deploy to appsource/lottery via GitHub Pages.

To update config and deploy: edit `frontend/public/index.html`, commit, push to main. CI handles the rest.

No rebuild needed for config changes — edit `window.SO_LotteryConfig` in `frontend/public/index.html`, commit and push. CI rebuilds automatically but the config itself is overlay (runtime JS object).

## Config Files

Overlay config, no rebuild needed. Edit `window.SO_LotteryConfig` in `frontend/public/index.html`:

| Field | Purpose | Example |
|-------|---------|---------|
| `chainId` | EVM chain ID | `97` (BSC Testnet), `56` (BSC), `1` (Ethereum) |
| `chainName` | Human-readable network name | `BSC Testnet` |
| `rpc` | JSON-RPC endpoint | `https://bsc-testnet-rpc.publicnode.com` |
| `etherscan` | Block explorer base URL | `https://testnet.bscscan.com` |
| `contract` | Deployed PancakeSwapLottery address | `0x...` |
| `token.symbol` | Ticket currency symbol | `WEENUS` |
| `token.address` | ERC-20 token address | `0x...` |
| `token.decimals` | Token decimals | `18` |
| `numbersCount` | Ticket numbers (2-6, must match contract) | `6` |
| `winPercents` | Prize distribution (must sum to 100 with burn) | `{ burn: 2, match_1: 1.25, ... }` |
| `logo` | Logo URL | `https://...` |
| `menu` | Navigation items | `[{ title, link, blank }]` |

The `rewardsBreakdown` passed to `startLottery()` must match `winPercents` values multiplied by 100, summing to 10000.

## Interview Protocol

Ask the user before generating config:

1. **Chain/network** — Which blockchain? (BSC, Ethereum, Polygon, etc.)
2. **Contract address** — Deployed lottery contract (or deploy new?)
3. **Token** — Address, symbol, and decimals of the ticket currency
4. **Ticket price** — Price per lottery ticket in token units
5. **Number count** — How many numbers per ticket? (2-6)
6. **Win distribution** — Prize percentages per match tier (must sum to 100 with burn)
7. **Commission/treasury fee** — Admin fee percentage (0-30%)
8. **Logo URL** — Brand logo for the lottery UI
9. **Branding** (optional) — Custom colors or menu items

## Output

Deliver to the user:

1. Updated `index.html` with configured `window.SO_LotteryConfig` (chain, contract, token, prizes)
2. Deployment instructions (push to main for CI, or manual copy to webroot)
3. Contract deployment script if a new contract is needed (using `PancakeSwapLottery.json` ABI + bytecode)
4. Instructions for starting the first lottery round (`startLottery` call with correct parameters)

## Common tasks

- **Add new blockchain** — Add network to `src/deployer/constants.ts`, deploy contract to the new chain, update `SO_LotteryConfig` in `index.html`, push to main
- **Start new lottery round** — Call `startLottery(endTime, priceTicket, discountDivisor, rewardsBreakdown, treasuryFee)` as operator. `endTime` must be 4+ hours in the future. `rewardsBreakdown` values must sum to 10000
- **Close and draw winners** — After `endTime` passes: call `closeLottery(lotteryId)`, then `drawFinalNumberAndMakeLotteryClaimable(lotteryId, seed, autoInjection)`

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| "Lottery is not open" | No active round | Call `startLottery()` as operator |
| "Not operator" | Wrong address calling | Set operator via `setOperatorAndTreasuryAndInjectorAddresses` |
| "End time must be > 4 hours" | `endTime` too soon | Set `endTime` at least 4 hours in the future |
| rewardsBreakdown error | Values don't sum to 10000 | Ensure all breakdown values sum exactly to 10000 |
| Frontend shows wrong chain | Outdated `SO_LotteryConfig` | Edit `frontend/public/index.html`, commit, push |
