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
