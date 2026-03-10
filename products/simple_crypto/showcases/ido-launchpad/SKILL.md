# IDO Launchpad (IDOFactory) — AI Agent Guide

## What is this project

IDOFactory is a white-label decentralized IDO launchpad platform where projects launch token sales and investors participate with supported tokens.

- **Live Demo:** https://launchpad.onout.org/
- **Landing:** https://onout.org/launchpad/
- **Repo:** https://github.com/noxonsu/launchpad

For deeper technical reference, see [launchpad/SKILL.md](https://github.com/noxonsu/launchpad/blob/master/SKILL.md).

## Stack

- **Frontend:** React (CRA with config-overrides), TypeScript, styled-components v5
- **Smart Contracts:** Solidity IDO sale contracts, Truffle for migrations
- **WordPress:** Plugin wrapper (`lp-wp.php`)
- **CI/CD:** GitHub Actions -> `yarn build` -> peaceiris/actions-gh-pages -> `appsource/launchpad` gh-pages
- **Hosting:** GitHub Pages at `launchpad.onout.org` (CNAME), also available as WordPress plugin
- **Constraints:** React 18 pinned (wagmi v3 incompatible with 19), `@material-ui/core` removed (use `@mui/material/styles`), no external CDN scripts

## Repository structure

```
src/                     — React source
  components/            — UI components
  pages/                 — App pages (launchpad list, sale detail, admin)
  config.ts              — App configuration (chain defaults, contract addresses)
  utils/
    chains.ts            — Network configuration (chain IDs, RPCs, explorers)
contracts/               — Solidity IDO contracts
migrations/              — Truffle migration scripts
public/                  — Static assets
build/                   — Production build (CI output)
docs/                    — Documentation
lp-wp.php               — WordPress plugin wrapper
.github/workflows/
  deploy.yml             — CI: build and deploy to GitHub Pages
```

## Build & Deploy

This product requires fork + push to trigger CI rebuild. Configuration is embedded in React source files, and changes require a full rebuild to take effect.

### Build locally

```bash
yarn
yarn start              # Dev server
yarn build              # Production build -> build/
```

### CI/CD (GitHub Actions)

Workflow: `.github/workflows/deploy.yml`

On push to main/master:
1. Installs dependencies (`yarn`)
2. Builds the React app (`yarn build`)
3. Uses `peaceiris/actions-gh-pages` to push `build/` to `appsource/launchpad` gh-pages branch
4. GitHub Pages serves from gh-pages with CNAME `launchpad.onout.org`

### Deployment flow

1. Fork `https://github.com/noxonsu/launchpad`
2. Edit config files (see Config Files below)
3. Push to your fork's main branch
4. CI builds and deploys to GitHub Pages automatically
5. Configure your custom domain as CNAME if desired

### Important CI notes

- `peaceiris/actions-gh-pages` strips `.github/` from build output
- GitHub Pages must be in `legacy` mode (not `workflow`)
- Commit messages with apostrophes can break CI heredoc — use env variables

## Config Files

Configuration is embedded in source code and requires a rebuild to apply.

**`src/config.ts`** — primary app configuration:
- Default chain ID and contract addresses
- API endpoints and feature flags
- Admin settings and sale parameters

**`src/utils/chains.ts`** — network definitions:
- Chain IDs, RPC URLs, block explorer URLs
- Network display names
- Supported chain list

## Interview Protocol

Before configuring, ask the user:

1. **Target chain** — "Which EVM chain should your launchpad run on? (Ethereum, BSC, Polygon, or multiple)"
2. **IDO contracts** — "Have you deployed IDO sale contracts, or do you need deployment guidance?"
3. **Token standard** — "What token standard will projects use for sales? (ERC-20 on target chain)"
4. **Branding** — "What brand name, colors, and domain will you use?"
5. **Deployment target** — "Will you deploy via GitHub Pages or WordPress plugin?"

## Output

The agent produces:

1. A forked repository with edited config files:
   - `src/config.ts` — updated chain defaults and contract addresses
   - `src/utils/chains.ts` — updated network configuration
2. Instructions to push the fork to trigger CI deployment
3. CNAME setup guide for custom domain on GitHub Pages
4. WordPress plugin installation guide if using `lp-wp.php`
5. Verification steps to confirm the launchpad loads with correct chain and contracts

## Common tasks

### Add new network support

Edit `src/utils/chains.ts` to add the network configuration (chain ID, RPC, explorer). Update `src/config.ts` with contract addresses for the new chain. Push to trigger CI rebuild.

### Deploy new IDO contract

Use Truffle migrations or Hardhat scripts in `contracts/`. After deployment, update the contract address in `src/config.ts` and push to rebuild.

### Update frontend config

Edit network and contract addresses in `src/config.ts` or set via environment variables. Push to trigger CI rebuild.

### Switch deployment target

For GitHub Pages: ensure `.github/workflows/deploy.yml` points to the correct `appsource/{repo}` target and CNAME file is in `public/`. For WordPress: use `lp-wp.php` and deploy the build as a plugin ZIP.

## Troubleshooting

### Build fails with dependency errors

```bash
rm -rf node_modules && yarn
```

If memory issues occur:

```bash
NODE_OPTIONS=--max_old_space_size=4096 yarn build
```

### MUI import errors after upgrade

`@material-ui/core` has been removed. Replace imports with `@mui/material/styles`. Do not add `@material-ui/core` back.

### External CDN scripts break on deploy

Do not use external CDN scripts in HTML — CORS issues occur with unpkg.com redirects. Bundle all dependencies via the build system.

### GitHub Pages not updating

Check that GitHub Pages is in `legacy` mode (not `workflow`). Verify `peaceiris/actions-gh-pages` pushed to the correct `gh-pages` branch. Check the deploy action logs for errors.

### Wallet connection issues

Verify chain configuration in `src/utils/chains.ts` — ensure RPC URLs are active. Check browser console for Web3 errors.
