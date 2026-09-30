# Shri Health Procurement Centre

Hospital pharmacy procurement and inventory portal (medicines only): React (JSX) + Vite front end, Express API, PostgreSQL database.
It is a single admin workspace with no login.

## Run it

```bash
npm run install:all     # install root, server and client packages
npm run db:init         # create tables + load the starter catalogue (only if empty)
npm run dev             # API on :4000, web app on http://localhost:5173
```

`npm run db:reset` drops everything and reloads the sample data: 64 medicines in 13 categories, 5 medicine wholesalers, and Pharmacy requests covering every medicine category and every state: waiting (normal and urgent), partly ordered, ordered from two vendors, ordered at a higher price, yet to be confirmed, confirmed, on the way, received, late 12 and 23 days, vendor order cancelled (back to waiting), and request cancelled.

### Use it from other computers on the network (LAN)

```bash
npm start               # builds the web app and serves everything on port 4000
```

The terminal prints the address to share, for example `http://192.168.29.164:4000`.
Open that on any computer or phone connected to the same Wi-Fi or office network.
Keep this computer on and awake while others are using it.

Database connection: `server/.env` (`DATABASE_URL=postgres://user:pass@localhost:5432/indostates_procurement`).
Create the database first with `createdb indostates_procurement`.

## Features

Six sections in the sidebar. Related screens are tabs inside a section, so any feature is at most two clicks away.

- **Home → Order tracker**: tiles for new requests, orders placed, yet to be confirmed, on the way, delay warning (up to 9 days late, or due within 2 days and not yet dispatched), delayed 10+ days and delayed 20+ days. Click a tile to filter the list. Each order has a one-click next step: **Confirm** → **On the way** → **Received** (receiving adds the quantities to stock). **All orders** tab: full order history.
- **Home → Restock**: every item with its stock level, reorder level and quantity already on order. Tiles filter by needs restock, out of stock, low, getting low (within 1.5× reorder level), already on order, or all items. Out-of-stock and low items that are not on order start ticked, with a suggested quantity (up to twice the reorder level). Pick a vendor, decide the price, and **Place order** creates one purchase order per vendor.
- **Price decision** (Requests and Restock): each line shows the **old price** (what that vendor charged last time, else the catalogue price). Procurement must set a **new price**, either **Same price** (one click, or "Same price for all") or the new market rate, which shows the % change. You can't place an order until every line has a price.
- **Who can request what**: only the Pharmacy raises purchase requests for medicines. The wards (Emergency, ICU, OT, General Ward, Paediatrics, Maternity, OPD) receive medicines from the Pharmacy through Billing. This is set per department in Vendors → Departments, and the server rejects anything else.
- **Requests**: a department picks itself, types a medicine (for example "para 500"), and brand, strength, unit and stock fill in automatically. It enters the quantity and sends the request. Procurement sees each request with the usual vendor already selected, plus past vendors and their last prices. Change the vendor if needed, decide the price, then **Place order**. One purchase order is created per vendor. Cancelling an order puts its items back on the request.
- **Stock**: Items & stock (add, edit, reprice, − / + stock, CSV export), Categories, Stock ledger (audit trail of every movement).
- **Billing**: New bill (issue stock to a department; GST per item; stock is deducted in one transaction), Bills (search, print, cancel to return stock).
- **Vendors**: Vendors and Departments.
- **Reports**: Overview charts, reorder list, expiry watch, stock valuation, department consumption. All can be exported to CSV.

## Structure

```
server/src/schema.sql   tables
server/src/services.js  transactional stock logic (billing, cancel, PO receive, adjustments)
server/src/routes.js    REST API (/api/...)
server/src/seedData.js  starter catalogue, suppliers, departments
client/src/pages/       one file per screen
client/src/components/  layout, modals, charts, shared UI
```
