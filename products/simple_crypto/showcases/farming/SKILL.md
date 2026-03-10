## What is this project

FarmFactory is an ERC-20 token staking widget (yield farming). Users stake one token and earn another. Supports Ethereum, BSC, Polygon, and other EVM chains.

Distribution: WordPress plugin + standalone static HTML (no backend needed).

- **Live demo:** https://farm.wpmix.net/
- **Repo:** https://github.com/noxonsu/farmfactory
- **Landing:** https://onout.org/farming/

For deeper technical reference, see [farmfactory/SKILL.md](https://github.com/noxonsu/farmfactory/blob/main/SKILL.md).

## Stack

- **Frontend:** React 18, TypeScript
- **Wallet:** Reown AppKit + wagmi v2
- **Contracts:** Solidity (StakingRewards contract, ABI in `contracts/Farm.json`)
- **Distribution:** WordPress plugin + standalone HTML widget
- **CI/CD:** GitHub Actions (build, ZIP, deploy to farm.wpmix.net)

## Repository structure

- `src_react/` — React source (TypeScript, wagmi v2, Reown AppKit)
- `reactwidget/` — Built React bundle (committed to git, served directly)
- `wordpress/` — WordPress plugin source (`farmfactory.php`, shortcode, assets)
- `contracts/` — `Farm.json` ABI + bytecode, `Farm.sol` Solidity source
- `demo/` — Static demo page (`index.html`)
- `.github/workflows/deploy.yml` — CI/CD pipeline

## Build & Deploy

Build the widget bundle: `cd src_react && yarn build:widget` — outputs to `reactwidget/`. CI deploys automatically on push to main. Also deployed via GitHub Pages at `appsource.github.io/farm/`.

No rebuild needed for config changes — overlay config via HTML data-attributes. Just edit the HTML page that hosts the widget div and redeploy the static file.

## Config Files

Overlay config, no rebuild needed. The pre-built bundle (`reactwidget/static/js/main.js`) scans `.ff-farmfactory-widget` divs and reads data-attributes:

| Attribute | Purpose | Example |
|-----------|---------|---------|
| `data-network-name` | Target blockchain | `bsc`, `mainnet`, `matic`, `sepolia` |
| `data-farm-address` | StakingRewards contract | `0x...` |
| `data-rewards-address` | Rewards token contract | `0x...` |
| `data-staking-address` | Staking token contract | `0x...` |
| `data-rewards-token-icon` | Rewards token icon URL (optional) | `https://...` |
| `data-staking-token-icon` | Staking token icon URL (optional) | `https://...` |

Additionally, set `window.SO_FARM_FACTORY_ROOT` to the base URL of the directory containing `reactwidget/`.

Supported networks: `mainnet`, `bsc`, `bsc_test`, `matic`, `sepolia`, `arbitrum_mainnet`, `avax`, `fantom`, `cronos`, `xdai`.

## Interview Protocol

Ask the user before generating config:

1. **Chain/network** — Which blockchain? (BSC, Ethereum, Polygon, etc.)
2. **Farm contract address** — StakingRewards contract address (or deploy new?)
3. **Staking token address** — Token users will stake
4. **Rewards token address** — Token users earn as rewards
5. **Token icons** (optional) — URLs for staking and rewards token logos
6. **Brand CSS** (optional) — Custom colors or styling for the widget
7. **Hosting preference** — WordPress plugin, standalone HTML, or GitHub Pages?

## Output

Deliver to the user:

1. HTML snippet with configured `.ff-farmfactory-widget` div, `window.SO_FARM_FACTORY_ROOT`, and script/CSS links pointing to appsource CDN or self-hosted bundle
2. Deployment instructions (WordPress shortcode setup or static file hosting)
3. If new farm contract needed: deployment script using `contracts/Farm.json` ABI + bytecode

## Common tasks

- **Add a new network** — Edit `src_react/src/utils/chains.ts`, add to `appkit.ts` networks array, run `yarn build:widget`, commit `reactwidget/` and push
- **Change contract on live site** — Update `demo/index.html` data-attributes, commit and push (CI deploys). For WordPress: update WP options via admin or DB. For appsource: update `appsource/farm/index.html`
- **Embed on a custom page** — Use HTML snippet with CDN links to `appsource.github.io/farm/` for CSS and JS assets

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `TypeError: undefined 'rpc'` | Unknown network name in `data-network-name` | Use a supported value from `chains.ts` |
| Chunks 404 / Cloudflare 522 | Wrong `SO_FARM_FACTORY_ROOT` value | Set to base URL of directory containing `reactwidget/` |
| APY = 0, no countdown | Farm not funded (`rewardRate` is 0) | Call `notifyRewardAmount()` on the farm contract as owner |
| Widget not rendering | `main.js` not loaded | Verify `<script defer src="...main.js">` path is correct |
| Connect button missing | JS error before React mount | Check browser console for errors |
