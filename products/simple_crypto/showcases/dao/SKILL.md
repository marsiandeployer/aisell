# DAO Governance (DAOwidget) — AI Agent Guide

## What is this project

DAOwidget is a WordPress plugin for decentralized governance — allows users to create DAOs, submit proposals, and vote using ERC-20 tokens on EVM chains.

- **Live Demo:** https://farm.wpmix.net/daofactory/
- **Landing:** https://onout.org/dao/
- **Repo:** https://github.com/noxonsu/DAOwidget

For deeper technical reference, see [DAOwidget/SKILL.md](https://github.com/noxonsu/DAOwidget/blob/master/SKILL.md).

## Stack

- **Frontend:** React 17 (CRA + craco), TypeScript, SCSS, web3.js, ethers v5
- **Smart Contracts:** Solidity governance/DAO contracts on EVM chains
- **WordPress:** PHP plugin (`daofactory.php`), shortcode `[daofactory]`
- **CI/CD:** GitHub Actions deploys WordPress ZIP to `farm.wpmix.net/updates/`
- **Hosting:** farm.wpmix.net (WordPress), plugin updates at `/public_html/updates/`

## Repository structure

```
daofactory.php            — WordPress plugin main file (shortcode, enqueue)
src/                      — React source: components, pages, hooks, contracts
  constants/
    networks.ts           — Network objects (chainId, name, rpc, explorer)
    contracts.ts          — DAO contract addresses per chain
build/                    — React production build (output of npm run build)
unminified-build/         — Debug build (UNMINIFIED=true)
inc/                      — WordPress PHP includes
lang/                     — Translation files
templates/                — PHP templates
craco.config.js           — CRA override config (build as WP plugin)
package.json              — Node dependencies + scripts
.github/workflows/        — CI/CD deployment workflow
```

## Build & Deploy

This product requires fork + push to trigger CI rebuild. Configuration is embedded in React source constants, and changes require a full rebuild to take effect.

### Build locally

```bash
npm install
npm run build          # Production build -> build/
npm run build:plugin   # craco build for WP plugin
```

### CI/CD (GitHub Actions)

Workflow: `.github/workflows/deploy-daowidget.yml`

On push to main/master:
1. Verifies SKILL.md exists in the repo
2. Builds React app (`npm run build`)
3. Creates `DAOwidget-v<VERSION>.zip` WordPress plugin package
4. Uploads ZIP + `info.json` to `farm.wpmix.net` via SCP
5. Moves ZIP to `/home/farmFactory/web/farm.wpmix.net/public_html/updates/`

### Deployment flow

1. Fork `https://github.com/noxonsu/DAOwidget`
2. Edit network and contract constants (see Config Files below)
3. Push to your fork's main branch
4. CI builds and deploys the WordPress plugin automatically

## Config Files

Configuration is embedded in source code and requires a rebuild to apply.

**`src/constants/networks.ts`** — network definitions:
- Network objects with `chainId`, `name`, `rpc`, `explorer` per supported chain
- Add or remove EVM networks here

**`src/constants/contracts.ts`** — DAO contract addresses:
- Maps chain IDs to deployed DAO governance contract addresses
- Must be updated when deploying contracts on new chains

## Interview Protocol

Before configuring, ask the user:

1. **Target chain** — "Which EVM chain should your DAO platform run on? (Ethereum, BSC, Polygon, or multiple)"
2. **DAO contracts** — "Have you already deployed DAO governance contracts, or do you need guidance on deployment?"
3. **Token** — "What ERC-20 token will be used for voting power?"
4. **Branding** — "What brand name, colors, and domain will you use?"
5. **Hosting** — "Will you host via WordPress plugin or a standalone build?"

## Output

The agent produces:

1. A forked repository with edited config files:
   - `src/constants/networks.ts` — updated network objects for target chains
   - `src/constants/contracts.ts` — updated DAO contract addresses
2. Instructions to push the fork to trigger CI deployment
3. WordPress installation guide with the `[daofactory]` shortcode
4. Verification steps to confirm the DAO platform loads with correct chain and contracts

## Common tasks

### Add a new EVM network

1. Edit `src/constants/networks.ts` — add network object with `chainId`, `name`, `rpc`, `explorer`
2. Update `src/constants/contracts.ts` — add DAO contract address for the new chain
3. Push to trigger CI rebuild and deployment

### Update DAO contract address

Edit `src/constants/contracts.ts` and update the address for the target chain ID. Push to rebuild.

### Update WordPress plugin version

Version is auto-bumped in CI via `sed` in the `daofactory.php` header. For manual update, edit `Version: X.X.X` in `daofactory.php`.

## Troubleshooting

### Build fails with "Module not found"

```bash
rm -rf node_modules && npm install
```

### React build memory error

```bash
NODE_OPTIONS=--max_old_space_size=4096 npm run build
```

### Old plugin version on WordPress

CI pushes ZIP to the updates server. WordPress auto-update checks `info.json`. Force update: SSH to server and manually replace plugin files in `/wp-content/plugins/DAOwidget/`.

### Web3 wallet not connecting

Check `src/constants/networks.ts` — verify RPC URLs are active. Test in browser console: `window.ethereum.request({method:'eth_chainId'})`.
