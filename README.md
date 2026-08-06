# Enterprise POS System

**Full-featured Point of Sale** with inventory management, **true FIFO costing**, multi-branch support, role-based access, and comprehensive reporting.

Built for supermarkets, pharmacies, restaurants, retail stores and multi-branch businesses.

---

## Tech Stack

| Layer        | Technology                          |
|--------------|-------------------------------------|
| Backend      | Node.js + Express + TypeScript      |
| ORM          | Prisma                              |
| Database     | PostgreSQL                          |
| Auth         | JWT + bcrypt + Role-based (RBAC)    |
| Frontend     | React + TypeScript + Vite           |
| Architecture | Clean Architecture + Service layer  |
| Deployment   | Docker Compose                      |

---

## Current Status

### Implemented

| Module | Features |
|--------|----------|
| **Auth** | Login, JWT, `/me`, RBAC (Admin / Manager / Cashier / Inventory / Accountant) |
| **Products** | CRUD, barcode & SKU lookup, search, pagination, low-stock alerts, stock valuation |
| **Inventory (FIFO)** | Create lots, consume oldest-first, exact COGS via `FifoConsumption`, restore on void/refund, valuation |
| **Sales** | Multi-item sales, discounts, taxes, payment methods, auto invoice numbers, void + stock restore |
| **Returns / Refunds** | Full & partial refunds with proportional FIFO stock restore + negative payment records |
| **Cash Registers** | Open / close sessions, expected-cash calculation, shift summary, manager override |
| **Categories** | Hierarchical CRUD, tree view, cycle protection, product-count guards |
| **Purchases** | Create PO, receive (full/partial) → creates FIFO lots, stock movements, last-cost update |
| **Customers** | CRUD + search |
| **Suppliers** | CRUD + search |
| **Reports** | Daily sales report (with COGS & gross profit), Inventory valuation (FIFO) |
| **Receipts** | ESC/POS binary + HTML + plain text; browser Print / Save as PDF |
| **Exports** | CSV download for daily sales & inventory valuation (Excel-compatible) |
| **Dashboard** | Today KPIs, top products bar chart, recent sales with receipt links |
| **Branches** | Multi-branch CRUD, summary stats, frontend branch switcher |
| **Offline Queue** | IndexedDB sales queue — works offline, auto-syncs when back online |
| **Docker** | Multi-stage Dockerfiles (backend + frontend/nginx), full compose stack |
| **CI** | GitHub Actions: typecheck + build backend/frontend + Docker image build |
| **Offline Catalog** | Products cached in IndexedDB — search & barcode work offline |
| **Role UI Gating** | Nav tabs filtered by role (Cashier / Manager / Accountant / Admin) |
| **Sales Trend** | 7-day sales bar chart on dashboard |
| **Printer Bridge** | ESC/POS drivers: log (dev), network TCP:9100, file dump |
| **Unit Tests** | Vitest: ESC/POS builder + FIFO consumption math |
| **Tax Profiles** | VAT/GST profiles; branch default + product override; resolve endpoint |
| **Multi-currency** | Branch `currencyCode` / `currencySymbol` (USD, PKR, …) |
| **WebUSB Print** | Browser → USB thermal printer (Chrome/Edge) |
| **E2E** | Playwright: health, login, POS smoke |
| **Seed** | HQ (USD) + Downtown (PKR), VAT17/GST5, Admin, Cashier, sample products |

### Next / Optional

- Full offline inventory quantity sync
- FX conversion rates between branch currencies
- Playwright in CI + more sale flows
- Remember last WebUSB printer

---

## Project Structure

```
pos-enterprise/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma          # Full data model with FIFO lots
│   │   └── seed.ts
│   ├── src/
│   │   ├── config/
│   │   ├── middleware/            # auth, error
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   ├── products/
│   │   │   ├── sales/                 # + refunds
│   │   │   ├── purchases/
│   │   │   ├── inventory/
│   │   │   │   └── fifo.service.ts   ⭐ Core FIFO engine
│   │   │   ├── cash-registers/        # open / close / summary
│   │   │   ├── categories/            # hierarchical
│   │   │   ├── receipts/              # ESC/POS + HTML
│   │   │   ├── branches/              # multi-branch
│   │   │   ├── customers/
│   │   │   ├── suppliers/
│   │   │   └── reports/               # + dashboard + CSV export
│   │   └── Dockerfile                 # multi-stage
├── frontend/
│   ├── Dockerfile                     # nginx multi-stage
│   ├── nginx.conf
│   └── src/utils/offlineQueue.ts      # IndexedDB queue
├── docker/docker-compose.yml
├── .github/workflows/ci.yml


│   │   ├── shared/
│   │   ├── app.ts
│   │   └── server.ts
│   ├── package.json
│   └── tsconfig.json
├── frontend/                      # React + Vite POS UI
├── docker/
│   └── docker-compose.yml
└── docs/
```

---

## Quick Start

### 1. Database

```bash
cd docker
docker compose up -d
```

### 2. Backend

```bash
cd backend

cp .env.example .env
# DATABASE_URL=postgresql://pos:possecret@localhost:5432/pos_enterprise?schema=public
# JWT_SECRET=change-me-to-a-very-long-random-secret-at-least-32-chars

npm install
npx prisma generate
npx prisma migrate dev --name init
npx tsx prisma/seed.ts
npm run dev
```

API: `http://localhost:4000`

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

UI: `http://localhost:5173` (proxies `/api` → backend)

### 4. Full stack with Docker (production-style)

```bash
cd docker

# Start Postgres only first, then migrate + seed
docker compose up -d db
docker compose --profile tools run --rm migrate

# Build & start backend + frontend
docker compose up -d --build backend frontend
```

- Frontend: `http://localhost:8080`
- Backend API: `http://localhost:4000`
- Health: `http://localhost:4000/health`

### 5. Unit tests

```bash
cd backend
npm install -D vitest   # if not already installed
npx vitest run
```

### 6. E2E (Playwright)

```bash
# Terminals: backend :4000 + frontend :5173 must be running
cd e2e
npm install
npx playwright install chromium
npm test
```

After schema changes (currency / tax profiles):

```bash
cd backend
npx prisma migrate dev --name multi_currency_tax_profiles
npx tsx prisma/seed.ts
```

---

## Key API Endpoints

| Method | Path | Description | Roles |
|--------|------|-------------|-------|
| POST | `/api/auth/login` | Login | Public |
| GET | `/api/auth/me` | Current user | Authenticated |
| GET | `/api/products` | List / search products | Authenticated |
| GET | `/api/products/barcode/:code` | Barcode lookup | Authenticated |
| GET | `/api/products/low-stock` | Low stock items | Admin/Manager/Inventory |
| POST | `/api/products` | Create product | Admin/Manager/Inventory |
| POST | `/api/sales` | Create sale (FIFO COGS) | Cashier+ |
| POST | `/api/sales/:id/void` | Void + restore stock | Manager/Admin |
| POST | `/api/sales/:id/refund` | Full / partial refund + FIFO restore | Cashier+ |
| POST | `/api/cash-registers/open` | Open cash drawer session | Cashier+ |
| GET | `/api/cash-registers/me/open` | Current open session | Authenticated |
| POST | `/api/cash-registers/:id/close` | Close session + expected cash | Cashier+ |
| GET | `/api/cash-registers/:id/summary` | Shift sales summary | Cashier+ |
| GET/POST | `/api/categories` | Categories (flat + tree) | Authenticated / Manager |
| POST | `/api/purchases` | Create purchase order | Admin/Manager/Inventory |
| POST | `/api/purchases/:id/receive` | Receive stock → FIFO lots | Admin/Manager/Inventory |
| GET | `/api/reports/daily-sales` | Daily sales + COGS + profit | Admin/Manager/Accountant |
| GET | `/api/reports/inventory-valuation` | FIFO inventory valuation | Admin/Manager/Accountant |
| GET | `/api/reports/dashboard` | Today KPIs, top products, recent sales | Cashier+ |
| GET | `/api/reports/export/daily-sales.csv` | CSV export (Excel) | Admin/Manager/Accountant |
| GET | `/api/reports/export/inventory.csv` | Inventory valuation CSV | Admin/Manager/Accountant |
| GET | `/api/receipts/:saleId` | ESC/POS + HTML + text receipt | Cashier+ |
| GET | `/api/receipts/:saleId/html` | Printable HTML receipt | Cashier+ |
| GET | `/api/receipts/:saleId/escpos` | Raw ESC/POS binary | Cashier+ |
| GET/POST | `/api/branches` | List / create branches | Authenticated / Admin |
| GET | `/api/branches/:id/summary` | Branch KPIs | Authenticated |
| POST | `/api/printers/receipts/:saleId` | Send ESC/POS to printer (log/network/file) | Cashier+ |
| GET/POST | `/api/tax-profiles` | Tax profiles (VAT/GST) | Accountant+ |
| GET | `/api/tax-profiles/resolve/:productId` | Effective tax rate for product | Authenticated |
| GET/POST | `/api/customers` | Customers | Cashier+ |
| GET/POST | `/api/suppliers` | Suppliers | Admin/Manager/Inventory |

---

## FIFO How it works

1. **Purchase / Receive** → new `InventoryLot` with `unitCost` + `receivedAt`.
2. **Sale** → `FifoService.consume()` selects lots ordered by `receivedAt ASC`, reduces quantity, writes `FifoConsumption` records linked to the `SaleItem`.
3. **COGS** on the sale line = sum of (qty × unitCost) from the consumptions.
4. **Void / Return** → quantities restored to the original lots.

This produces accurate gross profit even when purchase prices change over time.

---

## Default Seed Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@pos.local | admin123 |
| Cashier | cashier@pos.local | cashier123 |

---

## Architecture Notes

- **Clean separation**: Routes → Service → Prisma
- **Transactions** around sales and stock receive for consistency
- **Decimal** arithmetic via Prisma Decimal for money & quantities
- **RBAC** enforced at route level with `authorize(...roles)`
- **Branch-scoped** data where relevant
