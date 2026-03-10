# DEX (DeFinance) — AI Agent Guide

## What is this project

DeFinance is a white-label Uniswap-like decentralized exchange (DEX) for token swapping on EVM-compatible chains. Distributed as a WordPress plugin with an embedded React frontend.

- **Live Demo:** https://dex.onout.org/
- **Landing:** https://onout.org/dex/
- **Repo:** https://github.com/noxonsu/definance

## Stack

- **Frontend:** React (CRA), TypeScript, web3-react, JSBI for BigInt math
- **Smart Contracts:** Uniswap V2 fork — Factory, Router, Pair contracts on EVM chains
- **WordPress:** PHP plugin wrapper (`wordpress/definance.php`)
- **CI/CD:** GitHub Actions builds unifactory, packages WordPress ZIP, deploys to `definance.wpmix.net/updates/`
- **Hosting:** WordPress plugin auto-update from `farm.wpmix.net`, demo via GitHub Pages

## Repository structure

```
unifactory/              — Embedded Uniswap-fork React app (main DEX frontend)
  src/
    constants/
      index.ts           — Chain IDs, storage config (STORAGE_APP_KEY, STORAGE_NETWORK_ID)
      lists.ts           — Default token lists
      onout.ts           — Onout-specific constants
    connectors/          — Wallet connectors (MetaMask, WalletConnect, Coinbase)
  networks.json          — Network definitions (RPC URLs, names, storage contract addresses)
wordpress/               — WordPress plugin wrapper (definance.php, enqueue, shortcode)
App/                     — PHP MVC app for plugin management
vendor_cache/            — PHP dependencies (cached)
vendor_source/           — PHP dependencies (source)
.github/workflows/
  deploy.yml             — CI: build unifactory, package ZIP, deploy
```

## Build & Deploy

This product requires fork + push to trigger CI rebuild. You cannot configure it by dropping overlay files — source-level constants must be edited and the app rebuilt.

### Build locally

```bash
cd unifactory
npm install
npm run build    # Production build -> build/
```

### CI/CD (GitHub Actions)

Workflow: `.github/workflows/deploy.yml`

On push to main/master:
1. Installs dependencies in `unifactory/`
2. Builds the React app (`npm run build`)
3. Packages WordPress ZIP with the build output
4. Deploys ZIP to `definance.wpmix.net/updates/`
5. Updates `info.json` on `farm.wpmix.net` for WordPress auto-update

### Deployment flow

1. Fork `https://github.com/noxonsu/definance`
2. Edit config constants (see Config Files below)
3. Push to your fork's main branch
4. CI builds and deploys automatically
5. WordPress sites pull the update from your deploy target

## Config Files

Configuration is embedded in source code and requires a rebuild to apply changes.

**`unifactory/src/constants/index.ts`** — primary configuration:
- `STORAGE_NETWORK_ID` — BSC (56) in production, Goerli (5) in dev
- `STORAGE_APP_KEY = 'definance'` — key for on-chain storage contract (change to your app name)
- Chain ID constants: `BSC_ID=56`, `BSC_TESTNET_ID=97`, `OPBNB_MAINNET_ID=204`, etc.
- Wallet connectors: MetaMask (injected), WalletConnect, Coinbase Wallet (WalletLink)
- Slippage, deadline, and price impact defaults

**`unifactory/networks.json`** — network definitions:
- RPC endpoint URLs per chain
- Network display names
- Storage contract addresses per network
- Block explorer URLs

## Interview Protocol

Before configuring, ask the user:

1. **Target chain** — "Which EVM chain should your DEX run on? (BSC, Ethereum, Polygon, opBNB, or multiple)"
2. **Storage key** — "What name for your DEX? This becomes the on-chain storage key (e.g., 'myswap')"
3. **Custom RPC** — "Do you have preferred RPC endpoints, or should we use public defaults?"
4. **Contract addresses** — "Have you already deployed Uniswap V2 Factory/Router contracts, or do you need guidance?"
5. **Branding** — "What brand colors and domain will you use?"
6. **Deployment target** — "Will you deploy via WordPress plugin or GitHub Pages?"

## Output

The agent produces:

1. A forked repository with edited config files:
   - `unifactory/src/constants/index.ts` — updated `STORAGE_APP_KEY`, `STORAGE_NETWORK_ID`, chain IDs
   - `unifactory/networks.json` — updated RPC URLs, storage contract addresses
2. Instructions to push the fork to trigger CI deployment
3. WordPress installation guide if deploying as a plugin
4. Verification steps to confirm the DEX loads with correct chain and branding

## Common tasks

### Add a new EVM network

1. Add chain ID constant to `unifactory/src/constants/index.ts`
2. Add network entry to `unifactory/networks.json` with RPC, name, storage address, explorer
3. Push to trigger CI rebuild

### Change the storage key

Edit `STORAGE_APP_KEY` in `unifactory/src/constants/index.ts` to your app identifier. This determines which on-chain settings the DEX reads from the storage contract.

### Update Factory/Router contract addresses

Contract addresses are resolved through the on-chain storage contract. Update the storage contract data for your `STORAGE_APP_KEY` using the admin interface or direct contract call.

### Customize wallet connectors

Edit `unifactory/src/connectors/` to add or remove wallet options (MetaMask, WalletConnect, Coinbase Wallet).

## Troubleshooting

### Build fails with "Module not found"

```bash
cd unifactory && rm -rf node_modules && npm install
```

### DEX shows wrong chain or no liquidity

Verify `STORAGE_NETWORK_ID` in `unifactory/src/constants/index.ts` matches your target chain. Check that `networks.json` has correct RPC URLs for that chain ID.

### WordPress plugin not updating

CI pushes ZIP to the updates server. Check that `info.json` on `farm.wpmix.net` has the correct version. Force update: SSH to the WordPress server and replace plugin files manually.

### Wallet connection fails

Check that the RPC URL in `networks.json` for the target chain is active and accessible. Test in browser console: `window.ethereum.request({method:'eth_chainId'})`.
