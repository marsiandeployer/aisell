## What is this project

PolyFactory is a prediction market platform with a CLOB (Central Limit Order Book) on BSC Testnet. Users create markets, place YES/NO bets, and earn from correct predictions.

- **Live demo:** https://polyfactory.wpmix.net/
- **Repo:** https://github.com/marsiandeployer/PolyFactory

For deeper technical reference, see [PolyFactory/SKILL.md](https://github.com/marsiandeployer/PolyFactory/blob/main/SKILL.md).

## Stack

- **Frontend:** Vanilla HTML/CSS/JS + ethers.js v6 (no framework, no build step)
- **Contracts:** Solidity + Hardhat (BSC Testnet, chain ID 97)
- **Hosting:** nginx static files on VM104
- **CI:** GitHub Actions (SCP deploy on push to main)

## Repository structure

- `frontend/` — Static frontend (deployed as-is to webroot)
  - `app.js` — Main application logic (hash routing, market UI, orderbook)
  - `config.js` — RPC URLs, contract addresses, chain config
  - `index.html` — SPA shell
  - `style.css` — Styles
  - `wallet-init.js` — WalletConnect/AppKit wallet initialization
  - `images/` — Market images
- `contracts/` — `CLOBPredictionMarket.sol` (main), `PredictionMarket.sol` (simple version)
- `scripts/` — Hardhat deploy scripts
- `test/` — Hardhat unit tests
- `e2e/` — Playwright E2E tests

## Build & Deploy

No build step for the frontend — it is vanilla JS served as static files. Push to main triggers CI SCP deploy to the server webroot.

Manual deploy: copy `frontend/*` to the server webroot. Bump `?v=N` query parameter in `index.html` to bust Cloudflare cache.

No rebuild needed for config changes — edit `frontend/config.js` directly on the server or in the repo.

## Config Files

Overlay config, no rebuild needed. Edit `frontend/config.js` — a plain JS file containing a `CONFIG` object:

| Field | Purpose | Example |
|-------|---------|---------|
| `PREDICTION_MARKET_ADDRESS` | Deployed contract address | `0x...` |
| `RPC_URL` | JSON-RPC endpoint | `https://bsc-testnet-rpc.publicnode.com` |
| `CHAIN_ID` | EVM chain ID | `97` (BSC Testnet) |
| `BLOCK_EXPLORER_URL` | Block explorer base URL | `https://testnet.bscscan.com` |

Also `frontend/wallet-init.js` for WalletConnect/AppKit settings (project ID, supported chains).

## Interview Protocol

Ask the user before generating config:

1. **Chain/network** — Which blockchain? (BSC Testnet, BSC Mainnet, Ethereum, etc.)
2. **Contract address** — Deployed CLOBPredictionMarket contract address (or deploy new?)
3. **RPC endpoint** — JSON-RPC URL for the target chain
4. **Block explorer URL** — For transaction links in the UI
5. **Branding preferences** (optional) — Logo, colors, custom CSS
6. **WalletConnect project ID** (optional) — From cloud.walletconnect.com

## Output

Deliver to the user:

1. Updated `config.js` with the user's contract address, RPC, chain ID, and explorer URL
2. Updated `wallet-init.js` if WalletConnect project ID was provided
3. Deployment instructions for static hosting (copy files to webroot, configure nginx)

## Common tasks

- **Update contract address** — Edit `frontend/config.js`, change `PREDICTION_MARKET_ADDRESS`, deploy updated file
- **Add new market** — Call `createMarket()` on the deployed CLOBPredictionMarket contract as the owner
- **Deploy to new server** — Copy entire `frontend/` directory to the new webroot, update `config.js` with correct contract and RPC

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Frontend shows wrong contract | Outdated `config.js` | Update `PREDICTION_MARKET_ADDRESS` in `config.js` |
| Transactions fail | Wrong network in wallet | Switch wallet to BSC Testnet (chain ID 97) |
| CI deploy fails | SSH key misconfigured | Check `DEPLOY_SSH_KEY` secret in GitHub repo settings |
| Stale frontend after deploy | Cloudflare cache | Bump `?v=N` in `index.html` or enable CF Dev Mode |
