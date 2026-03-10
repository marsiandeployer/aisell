# MCW Wallet — White-Label Crypto Wallet Configurator

## What is this project

MultiCurrencyWallet (MCW) is an open-source P2P atomic swap wallet supporting BTC, ETH, BNB and 10+ EVM chains. It ships as a pre-built React static app where branding and features are configured by dropping overlay files on top of the build directory — no rebuild needed.

- **Live demo:** https://wallet.wpmix.net/
- **Repository:** https://github.com/swaponline/MultiCurrencyWallet
- **Landing page:** https://onout.org/wallet/

MCW uses an **overlay config approach**: the wallet build is ready to serve as-is. Customization is done by replacing three files (`erc20tokens.js`, `variables.css`, `customStyles.css`) in the `build-mainnet/` directory. This means any user can white-label MCW without touching source code or running a build pipeline.

For deeper technical reference, see [MultiCurrencyWallet/SKILL.md](https://github.com/swaponline/MultiCurrencyWallet/blob/master/SKILL.md).

## Stack

- **Frontend:** React (pre-built static app), webpack bundle
- **Wallet connection:** Reown AppKit + wagmi v2 + viem
- **P2P swap engine:** libp2p (HTLC atomic swaps for BTC/ETH pairs)
- **Hosting/Deploy:** GitHub Pages (primary), nginx, or any static file server
- **Config method:** Overlay — JS/CSS files dropped into `build-mainnet/`, no npm build required

## Repository structure

Key paths in the MCW repository:

| Path | Purpose |
|------|---------|
| `build-mainnet/` | Pre-built production static files — deploy target |
| `build-mainnet/erc20tokens.js` | Main config overlay: `window.buildOptions`, custom tokens, fees |
| `build-mainnet/variables.css` | CSS custom properties for brand colors |
| `build-mainnet/customStyles.css` | Additional UI overrides (logo, fonts) |
| `src/front/config/mainnet/` | Source config (RPC endpoints, chain IDs, API keys) |
| `src/front/config/testnet/` | Testnet config (same structure as mainnet) |
| `src/front/shared/pages/Apps/` | dApp bridge catalog and walletBridge |
| `src/front/shared/lib/appkit.ts` | Reown AppKit initialization |

## Build & Deploy

MCW is an overlay-config product — **no rebuild is needed** for white-labeling. The agent generates config files that the user drops into the pre-built static directory.

**Deploy options:**

1. **GitHub Pages (recommended):** Fork https://github.com/swaponline/MultiCurrencyWallet, replace overlay files in `build-mainnet/`, enable GitHub Pages from `master` branch pointing to `/build-mainnet`.

2. **Nginx server:** Copy `build-mainnet/` contents to a web root, overlay custom config files, configure nginx with `try_files $uri $uri/ /index.html`.

3. **wpmix.net subdomain:** Provide config files to admin for deployment at `{slug}.wpmix.net`.

For build-from-source instructions (rarely needed), see [MultiCurrencyWallet/SKILL.md](https://github.com/swaponline/MultiCurrencyWallet/blob/master/SKILL.md).

## Config Files

All configuration is done through overlay files placed in `build-mainnet/`. **No rebuild needed** — edit these files and serve.

### erc20tokens.js

The primary config file, loaded before the React app. Sets three global objects:

- **`window.buildOptions`** — main wallet configuration:
  - `curEnabled` — toggle chains on/off (btc, eth, bnb, matic, arbeth, aureth, xdai, avax, movr, one)
  - `blockchainSwapEnabled` — toggle P2P atomic swap per chain (only BTC and ETH have full swap support)
  - `defaultExchangePair` — default trading pair shown on load
  - `showWalletBanners`, `showHowItsWork`, `invoiceEnabled`, `addCustomTokens` — UI feature flags

- **`window.widgetEvmLikeTokens`** — array of custom ERC20/BEP20 tokens:
  - Each token: `{ standard, address, decimals, symbol, fullName, icon, iconBgColor }`
  - Token standards: `erc20` (Ethereum), `bep20` (BNB Chain), `erc20matic` (Polygon), `erc20xdai` (Gnosis), `erc20arbitrum` (Arbitrum)

- **`window.widgetERC20Comisions`** — swap fee configuration per chain:
  - Each chain entry: `{ fee: "0.3", address: "0x...", min: "0.001" }`
  - Fee is a percentage string (e.g., "0.3" = 0.3%)

Additional `window.SO_*` variables:
- `window.SO_WalletConnectProjectId` — WalletConnect project ID (from https://cloud.walletconnect.com/)
- `window.SO_MenuItemsBefore` / `window.SO_MenuItemsAfter` — custom menu items array: `[{ title, link }]`
- `window.SO_FaqBeforeTabs` — custom FAQ entries: `[{ title, content }]`

### variables.css

CSS custom properties for brand colors. Only override values that differ from defaults:

- `--color-brand` — primary brand color
- `--color-brand-hover` — hover state (usually lighter)
- `--color-brand-background` — brand color with ~10% opacity (append `1a` to hex)

Supports both default and dark themes via `[data-scheme="default"]` and `[data-scheme="dark"]` selectors.

### customStyles.css

Optional UI overrides: hide/replace the text logo (`.walletName`), set custom header background, import custom fonts.

## Interview Protocol

Conduct a batched interview before generating config files. Ask in groups of 2-3 questions.

**Batch 1 — Project Identity:**
- What is the name of your wallet? (e.g., MoonPay, NovaWallet)
- What is your primary brand color? (hex code or color name)
- Which blockchain(s) should your wallet support? (BTC, ETH, BNB, MATIC, ARBETH, XDAI, AVAX, MOVR, ONE, AURETH, or all)

**Batch 2 — Features:**
- What is the main use case? (multi-chain wallet / BNB-focused / token-specific / P2P swap)
- Any specific tokens to list? (your project token, USDT, etc. — provide contract address and chain)
- Should in-wallet swap/exchange be enabled?

**Batch 3 — Monetization:**
- Want to add a commission fee on swaps? If yes: fee wallet address, fee percentage (e.g., 0.3%), minimum fee amount
- Need WalletConnect support? (provide WalletConnect project ID from cloud.walletconnect.com, or use shared default)

**Batch 4 — Deployment & Extras:**
- Where will you host? (GitHub Pages / your server / wpmix.net subdomain)
- Any custom menu items? (e.g., "About" linking to your site, "Support" linking to Telegram)

After interview, generate all 4 output files immediately.

## Output

The agent generates 4 files for the user:

| File | Purpose |
|------|---------|
| `erc20tokens.js` | Main wallet configuration: enabled chains, custom tokens, fees, WalletConnect, menu items |
| `variables.css` | Brand color overrides (CSS custom properties for default and dark themes) |
| `customStyles.css` | UI customizations: logo replacement, header styling, custom fonts |
| `DEPLOY.md` | Step-by-step deployment instructions tailored to the user's chosen hosting method |

The user copies these files into `build-mainnet/` of their MCW fork or server directory. No build step required.

## Common tasks

**Add a custom ERC20/BEP20 token:**
Add an entry to the `window.widgetEvmLikeTokens` array in `erc20tokens.js` with the token's standard, contract address, decimals, symbol, full name, and icon URL.

**Change brand colors:**
Edit `variables.css` — update `--color-brand`, `--color-brand-hover`, and `--color-brand-background` in both the default and dark scheme selectors.

**Enable/disable blockchains:**
In `erc20tokens.js`, set the chain key to `true` or `false` in the `window.buildOptions.curEnabled` object.

**Configure swap fees:**
Add or update entries in `window.widgetERC20Comisions` in `erc20tokens.js`. Each chain needs `fee` (percentage string), `address` (fee recipient wallet), and `min` (minimum fee amount).

**Add WalletConnect:**
Set `window.SO_WalletConnectProjectId` in `erc20tokens.js` to your project ID from https://cloud.walletconnect.com/. Without a project ID, WalletConnect uses a shared default with rate limits.

**Add custom menu items:**
Define `window.SO_MenuItemsBefore` and/or `window.SO_MenuItemsAfter` arrays in `erc20tokens.js`, each entry having `title` and `link` properties.

**Add custom FAQ:**
Define `window.SO_FaqBeforeTabs` array in `erc20tokens.js` with `title` and `content` for each entry.

## Troubleshooting

**Wrong chain config — wallet shows unexpected currencies:**
Check `window.buildOptions.curEnabled` in `erc20tokens.js`. Each chain must be explicitly set to `true` or `false`. Missing keys default to the MCW base config.

**CSS brand colors not applying:**
Verify `variables.css` uses the correct selectors: `:root, [data-scheme="default"]` for light mode, `[data-scheme="dark"]` for dark mode. The file must be in the same directory as `index.html` (inside `build-mainnet/`).

**Fee config not working:**
Ensure `window.widgetERC20Comisions` (note the typo in the original MCW code — "Comisions" not "Commissions") uses string values for `fee` and `min`, not numbers. Example: `fee: "0.3"` not `fee: 0.3`.

**WalletConnect modal broken or showing Reown error:**
Without a valid WalletConnect project ID, the Reown modal may fail. Either set `window.SO_WalletConnectProjectId` to a valid project ID from https://cloud.walletconnect.com/, or omit it to use the shared default (which has rate limits).

**Custom tokens not appearing:**
Verify each token in `window.widgetEvmLikeTokens` has the correct `standard` matching the chain (`bep20` for BNB Chain, `erc20` for Ethereum, `erc20matic` for Polygon, etc.) and a valid contract `address`.
