# Budget App (GitHub Pages)

This project is fully static and runs directly in the browser (no Node server, no localhost:3000 backend).

## Run

- Open `index.html` directly in your browser, or
- Host the repository with GitHub Pages.

## GitHub Pages

1. Push this folder to a GitHub repository.
2. In GitHub, open **Settings → Pages**.
3. Set **Source** to **Deploy from a branch**.
4. Choose your branch (usually `main`) and `/ (root)`.
5. Save, then open the published Pages URL.

## Data Storage

Data is stored in browser `localStorage` with account support:

- `budgetAccounts_v1` for account credentials + per-account budget data
- `budgetSessionUser_v1` for current signed-in user
- Legacy `budgetAppData_v1` is read once for first-account migration

## Monetization MVP Mapping (Freelancer Cashflow Coach)

This app is now mapped toward a paid freelancer cashflow product.

### Target User

- Freelancers and creators with variable monthly income.

### Core Paid Value

- Monthly spending targets by category.
- Cash runway estimate from net cash vs 90-day burn rate.
- Tax reserve recommendation (30% of current-month income).
- CSV export + monthly report text export.

### Suggested Pricing

- Free: transaction tracking + recurring bills.
- Pro ($9/mo): targets, runway, tax reserve, exports.

### Current Technical Note

- This repo is static and stores data in localStorage. To take payments (Stripe) and enforce paid tiers securely, add a backend with authenticated entitlements.
