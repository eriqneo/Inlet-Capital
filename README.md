# Inlet Capital — Institutional Microfinance PWA

Inlet Capital is a high-fidelity, "Premium Standard" Progressive Web Application (PWA) designed for modern microfinance and table-banking institutions. It provides a robust, offline-first platform for managing members, groups, loans, and comprehensive financial auditing.

## 🚀 Key Features

### ✨ Recent Updates
*   **Dashboard Insights**: Added a new, prominent Alerts & Reminders KPI card on the main Dashboard that deep-links directly to the pending actions report.
*   **Enhanced Group Profiles**: Revamped the Group Profile UI with fully paginated tracking for Group Loans and Group Savings, backed by a synchronized global Date Filter.
*   **Fuzzy Group Search**: Implemented a real-time fuzzy search bar in the Groups Management view to quickly filter by Name, ID, or Meeting Day.
*   **Cash Flow Upgrades**: The Daily Cash Flow ledger now natively recognizes and tags transactions linked to Groups versus independent individuals.
*   **Extended Loan Applications**: Expanded the loan period flexibility up to 12 months during the application stage.

### 1. Institutional Reporting Suite
*   **Daily Cash Flow Ledger**: Real-time tracking of all money-in (Savings, Repayments, Registration Fees, Processing Fees) with auto-generated traceable references (`SAVE-D-...`).
*   **Individual & Group Performance**: Granular tracking of savings, loan balances, and repayment progress.
*   **Registration Reports**: Detailed onboarding logs including Next of Kin (NOK) contact integration with tap-to-call functionality.
*   **Excel Export**: One-click professional data export for all reports.

### 2. Smart Operational Intelligence
*   **Repayment Alerts & Reminders**: A 4-tier severity system (Critical, Urgent, Due Today, Upcoming) that acts as a daily action list for loan officers.
*   **Call Logger**: Direct "Mark as Called" functionality to track collection efforts within the system audit log.
*   **Member Health Metrics**: Real-time "Active/Inactive" status tracking based on a 90-day activity window.

### 3. Comprehensive Member Management
*   **Premium Member Profiles**: Centralized view of personal details, financial history (Loans & Savings), and Next of Kin information.
*   **Live Profile Editing**: In-situ profile updates with integrated camera support for passport photo re-capture.
*   **Group Banking**: Advanced group management including joint accounts, group loans, and member performance aggregation.

### 4. Financial Core
*   **Savings Ledger**: Intuitive deposit and withdrawal recording for both individuals and groups.
*   **Loan Lifecycle**: From application and multi-stage approval (Partial/Full) to automated repayment scheduling and closure.
*   **Expense Tracking**: Categorized votehead management for institutional overheads.

## 🛠 Technology Stack
*   **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3 (Custom Design System).
*   **Database**: IndexedDB (Browser-based persistence for maximum privacy and offline capability).
*   **Architecture**: Modular PWA with Service Worker support.
*   **UI/UX**: "Premium Standard" aesthetics featuring Inter & Outfit typography, glassmorphism, and responsive layouts.

## 📁 Project Structure
```text
/
├── public/                # Deployment-ready assets
│   ├── index.html         # Main Entry Point
│   ├── src/               # Application logic (App.js, Core, Features)
│   ├── manifest.json      # PWA Configuration
│   └── sw.js              # Service Worker (Offline Support)
├── package.json           # Scripts & Metadata
└── .gitignore             # Version control exclusions
```

## 💻 Local Development

### Prerequisites
*   Node.js (for Vite dev server)

### Running the App
1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```
4. Open your browser to the URL provided by Vite (typically `http://localhost:3000` or `http://localhost:5173`).

## Weekly Savings Consistency

Member Profile > Savings History shows weekly contribution coverage and on-time payment history for group members. The requirement is KES 200 per group meeting day; individual members are exempt.

- Assessment starts at `group_joined_at`, falling back to registration date or creation date, and never before the group's registration/creation date. Imported membership dates must reflect the actual start of membership.
- Only completed meeting days count as due. Dates are assessed in Africa/Nairobi time, and today's meeting remains payable until the end of the day.
- Deposits cover the oldest unpaid weeks first. KES 400 covers two weeks and KES 600 covers three. Catch-up payments clear the shortfall but retain their late-payment history. Advance deposits cover future weeks.
- Withdrawals do not undo contribution credit. Reversed deposits and transactions after the assessment date are excluded.
- Both loan disbursement screens check fresh savings records as of the selected disbursement date. Any outstanding contributions or historically late weeks require a superadmin decision and a reason. Missing records or invalid meeting/start dates stop the check.
- Exception decisions are stored in `loans.savings_disbursement_review` with the reviewer, timestamp, reason and assessment, and displayed in Loan Management > Overview. PocketBase restricts writes to this field to superadmins. The consistency calculation itself runs in the application.

For a new PocketHost instance, run `node scripts/setup_savings_consistency.mjs` to install the review field and field-write rule; `--check` verifies them without schema changes. The script accepts `PB_URL`, `ADMIN_EMAIL` and `ADMIN_PASS` environment variables, or uses the existing maintenance configuration. It does not change loan or savings records.

Run the calculation and review tests with `node --test tests/savingsConsistency.test.mjs`.

## ☁️ Deployment
This system is optimized for **Cloudflare Pages**. 
*   **Build Command**: Set to `npm run build` in the Cloudflare settings.
*   **Build Output Directory**: Set to `dist` in the Cloudflare settings.
*   **Data Security**: Since the app uses IndexedDB, all client and financial data is stored securely on the user's local device, ensuring zero server-side data leaks.

---
*Built with Precision for Inlet Capital Limited.*
# Debt Recovery Unit

The expandable Loans menu includes DU and D.R.U. D.R.U identifies loans with no payments for at least 90 days and provides a superadmin renewal workflow with a new period, 20% interest, carried fines, and an agreement reason. See [Debt Recovery Setup](DEBT_RECOVERY_SETUP.md) for the calculation policy and required PocketHost deployment steps.
