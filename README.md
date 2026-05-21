# Inlet Capital — Institutional Microfinance PWA

Inlet Capital is a high-fidelity, "Premium Standard" Progressive Web Application (PWA) designed for modern microfinance and table-banking institutions. It provides a robust, offline-first platform for managing members, groups, loans, and comprehensive financial auditing.

## 🚀 Key Features

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
*   Python 3 (for the local dev server)

### Running the App
1. Clone the repository.
2. Run the development server:
   ```bash
   npm start
   or
   python3 -m http.server 8001

   ```
3. Open your browser to `http://localhost:8001`.

## ☁️ Deployment
This system is optimized for **Cloudflare Pages**. 
*   **Build Output Directory**: Set to `public` in the Cloudflare settings.
*   **Data Security**: Since the app uses IndexedDB, all client and financial data is stored securely on the user's local device, ensuring zero server-side data leaks.

---
*Built with Precision for Inlet Capital Limited.*
