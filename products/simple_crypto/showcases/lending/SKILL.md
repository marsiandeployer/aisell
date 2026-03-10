# Lenda -- DeFi Lending & Borrowing Platform

## What is this project

Lenda is a white-label DeFi lending and borrowing platform on BNB Smart Chain (BSC). Users deposit collateral tokens and borrow against them, similar to Aave but with custom smart contracts owned by the deployer. The product is built as a standalone frontend that connects to on-chain Pool and Storage contracts.

- **Repository:** https://github.com/marsiandeployer/BankLend
- **Live demo:** https://lenda.wpmix.net/
- **Landing page:** https://onout.org/lenda/

The product name is **Lenda**; the repository is named **BankLend**.

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite + Tailwind CSS v4 |
| Web3 | wagmi v3 + viem v2 |
| Chains | BSC Mainnet (chainId 56) + BSC Testnet (chainId 97) |
| Price feeds | Chainlink oracles (on-chain) |
| Smart contracts | Custom Pool contract + onout.org Storage contract |
| Theme | Tailwind v4 CSS custom properties (oklch color space), light/dark toggle |
| Bridge mode | wallet-apps-bridge-client.js for MCW iframe integration |

## Repository structure

Key files and directories in the BankLend repository:

| Path | Purpose |
|------|---------|
| `frontend/src/constants/config.ts` | APP_CONFIG: walletConnectProjectId, chain settings, branding |
| `frontend/src/constants/config.ts` | POOL_ADDRESS_FALLBACK: hardcoded pool contract address |
| `frontend/src/hooks/useCollaterals.ts` | Reads on-chain: getSupportedCollaterals() -> collateralConfigs() -> ERC20 symbol/decimals -> Chainlink prices |
| `frontend/src/hooks/usePoolState.ts` | TVL, borrows, APY, poolAddress (from Storage or POOL_ADDRESS_FALLBACK) |
| `frontend/src/hooks/useAdmin.ts` | Admin operations: setRates, setCollateral, adminWithdraw, adminDeposit, updateStorageConfig |
| `frontend/src/hooks/useBorrow.ts` | User borrow flow: borrow(collateralToken, collateralAmount, borrowAmount) |
| `frontend/src/hooks/useTheme.ts` | Theme management: reads ?theme= param, localStorage, system preference; applies html.light/html.dark class |
| `frontend/src/hooks/useBridgeAutoConnect.ts` | Auto-connect when running inside MCW iframe (?walletBridge=swaponline) |
| `frontend/src/components/Navbar.tsx` | Navigation bar with theme toggle button |
| `frontend/index.html` | Entry point; includes wallet-apps-bridge-client.js for bridge mode |

## Build & Deploy

Lenda **requires rebuild** for configuration. There is no overlay config mechanism -- the deployer must fork the repository, edit source constants, build, and deploy manually.

**Steps:**

1. Fork https://github.com/marsiandeployer/BankLend
2. Edit `frontend/src/constants/config.ts`:
   - Set `walletConnectProjectId` in APP_CONFIG to a real WalletConnect Cloud project ID
   - Set `POOL_ADDRESS_FALLBACK` to the deployed Pool contract address
   - Adjust chain configuration (BSC Testnet 97 or BSC Mainnet 56)
3. Build the frontend:
   ```
   cd frontend
   npm install
   npm run build
   ```
4. Deploy the `dist/` directory to the target server:
   ```
   cp -r dist/* /var/www/your-domain/
   ```
5. Configure nginx to serve the static files with SPA fallback (`try_files $uri $uri/ /index.html`)

**Current production deploy target:** `lenda.wpmix.net` served from `/var/www/lenda.wpmix.net/` on the application server.

There is no CI/CD pipeline -- deployment is manual (build locally, copy artifacts to server).

## Config Files

The primary configuration file is `frontend/src/constants/config.ts`. Key values to customize:

**APP_CONFIG object:**
- `walletConnectProjectId` -- WalletConnect Cloud project ID for wallet connection modal. Without a real project ID, the WalletConnect/Reown popup will be broken.

**POOL_ADDRESS_FALLBACK constant:**
- Hardcoded pool contract address. On BSC Testnet the current pool is `0x7411fd9...`. This is used when the onout.org Storage contract does not return a pool address for the domain.

**Chain configuration:**
- `chains: [bscTestnet, bsc]` -- testnet is listed first (default). To make mainnet the default, reorder to `[bsc, bscTestnet]`.
- Connectors: `injected()` + `walletConnect({ projectId })`. The walletConnect connector is hidden in UI when no real projectId is configured.

**Theme configuration:**
- Light/dark theme controlled via Tailwind v4 CSS custom properties (`--color-slate-*` in oklch color space)
- `html.light` class in `frontend/src/index.css` overrides the entire slate palette for light mode
- `useTheme.ts` reads `?theme=` URL param, localStorage, or system preference

**Storage contract integration:**
- The onout.org Storage contract uses selector `0xae55c888` (getData) with a domain key like `lenda-testnet.onout.org`
- If Storage returns a valid config, it overrides POOL_ADDRESS_FALLBACK and APY settings

## Interview Protocol

Before configuring Lenda for a client, gather these details:

1. **Target chain:** "Will you deploy on BSC Testnet (for testing) or BSC Mainnet (production)?"
2. **Pool contract address:** "What is the deployed Pool contract address? (If you haven't deployed contracts yet, we can use the testnet pool for now.)"
3. **Collateral tokens:** "Which tokens should users be able to use as collateral? (The Pool contract must have these configured on-chain via setCollateral.)"
4. **WalletConnect project ID:** "Do you have a WalletConnect Cloud project ID? (Get one at https://cloud.walletconnect.com/) Without it, the wallet connection modal won't work properly."
5. **Branding preferences:** "Any custom branding? (Logo, color scheme -- light or dark default theme)"
6. **Deploy target:** "Where will you host the frontend? (Your own server, specific domain, or we set up a wpmix.net subdomain)"
7. **Storage contract:** "Do you want to use the onout.org Storage contract for remote config, or hardcode everything in the source?"

## Output

After gathering client requirements, the agent produces:

1. **Forked repository** with edited `frontend/src/constants/config.ts`:
   - Updated `walletConnectProjectId`
   - Updated `POOL_ADDRESS_FALLBACK` with client's pool address
   - Correct chain order (mainnet-first or testnet-first)
2. **Build artifacts** (`dist/` directory) ready for deployment
3. **Deploy instructions** specific to the client's hosting setup (nginx config, domain, SSL)
4. **Theme customization** if requested (CSS custom property overrides in `index.css`)

## Common tasks

### Switch from testnet to mainnet
Edit `frontend/src/constants/config.ts`: change chain array order from `[bscTestnet, bsc]` to `[bsc, bscTestnet]`. Update `POOL_ADDRESS_FALLBACK` to the mainnet pool address. Rebuild and redeploy.

### Update pool contract address
Edit `POOL_ADDRESS_FALLBACK` in `frontend/src/constants/config.ts`. Alternatively, configure the onout.org Storage contract to return the new address for the domain.

### Add a new collateral token
This is an on-chain operation. Call `setCollateral` on the Pool contract via the admin interface (useAdmin hook). The frontend reads supported collaterals dynamically from the chain -- no frontend change needed after the contract is updated.

### Change theme (light/dark default)
The default theme follows system preference. To force a specific theme:
- Append `?theme=light` or `?theme=dark` to the URL
- Or modify `useTheme.ts` to set a different default
- To customize colors, edit the CSS custom properties in `frontend/src/index.css` under `html.light {}` or `:root {}`

### Enable bridge mode (MCW iframe)
Lenda supports running inside a MultiCurrencyWallet iframe. The `wallet-apps-bridge-client.js` script in `index.html` injects `window.ethereum` from the parent frame. The `useBridgeAutoConnect.ts` hook auto-connects when `?walletBridge=swaponline` is in the URL or when `window !== window.top`. After connection, it auto-switches to BSC (chainId 56) if the current chain is not BSC.

## Troubleshooting

### WalletConnect popup broken / Reown modal shows error
**Cause:** No real WalletConnect project ID configured. The default or empty `walletConnectProjectId` in APP_CONFIG causes the Reown popup to fail.
**Fix:** Register at https://cloud.walletconnect.com/, create a project, copy the project ID into `APP_CONFIG.walletConnectProjectId`, rebuild and redeploy.

### Pool returns empty data / no collaterals shown
**Cause:** The onout.org Storage contract is not configured for the domain, and `POOL_ADDRESS_FALLBACK` points to a contract that has no collaterals set up.
**Fix:** Either configure the Storage contract with `getData("your-domain.onout.org")` returning the correct pool address, or verify that `POOL_ADDRESS_FALLBACK` points to a pool with collaterals configured via `setCollateral`.

### Bridge mode not connecting wallet
**Cause:** The `wallet-apps-bridge-client.js` script is not loaded, or the parent frame does not provide `window.ethereum`.
**Fix:** Verify that `index.html` includes the bridge script. Ensure the URL contains `?walletBridge=swaponline`. Check that the parent MCW frame is running and has a connected wallet. The `useBridgeAutoConnect` hook polls every 100ms for `window.ethereum` to appear.

### Wrong chain after wallet connect
**Cause:** The wallet is connected to a chain other than BSC (56) or BSC Testnet (97).
**Fix:** The bridge auto-connect hook attempts `switchChain({ chainId: 56 })` automatically. If this fails, the user must manually switch chains in their wallet. Verify that the `chains` array in wagmi config includes the target chain.

### CSS containing block issue with modals
**Cause:** `backdrop-blur-sm` on `<nav>` creates a CSS containing block that breaks `position: fixed` for modals/popups.
**Fix:** The ConnectWallet modal uses `createPortal(modal, document.body)` to escape the containing block. If adding new modals, use the same portal pattern.
