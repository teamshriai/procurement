# Shri Health Procurement Centre

Hospital pharmacy procurement and inventory portal (medicines only). It is a **static web app**: React (JSX) + Vite,
with no server and no database to run. All data (64 medicines in 13 categories, 5 wholesalers, 8 departments,
30 days of bills, purchase orders and purchase requests) is generated in the browser from
[`client/src/mock/seedData.js`](client/src/mock/seedData.js) and [`client/src/mock/seed.js`](client/src/mock/seed.js),
and changes are saved in the browser's `localStorage`.

## Run it

```bash
npm run install:all     # install the client packages (clean install from the lockfile)
npm run dev             # http://localhost:5173
```

## Build and deploy

The output is plain files in `client/dist/`, so any static host works.

```bash
npm run build                   # for a site root (served at /)
npm run build:dev-procurement   # for https://shri-ai.org/dev/procurement/
```

`build:dev-procurement` is `vite build --base=/dev/procurement/`. The base path is a build-time setting, so to host it
elsewhere run `npx vite build --base=/your/path/` (inside `client/`). The single-page app needs the host to answer
unknown paths under its base with `index.html`; for nginx:

```nginx
location = /dev/procurement { return 301 /dev/procurement/; }
location /dev/procurement/ {
    alias /var/www/mockups/dev-procurement/;
    index index.html;
    try_files $uri $uri/ /dev/procurement/index.html;
}
```

To try a build locally: `npm run build && npm run preview`, or for the sub-path build
`npm run build:dev-procurement && npm run preview:dev-procurement`.

### Where the data lives

Everything is stored per browser (`localStorage`, keys `shpc-procurement-demo-v1` and `shpc-cart`), so changes are not
shared between people or devices. **Reset sample data** (bottom of the sidebar) discards your changes and loads the
sample data again. The sample data is dated relative to the day it is loaded, so use Reset to refresh the "days late"
and expiry tiles after a long gap.

## Features

Six sections in the sidebar. Related screens are tabs inside a section, so any feature is at most two clicks away.

- **Home → Order tracker**: tiles for new requests, orders placed, yet to be confirmed, on the way, delay warning (up to 9 days late, or due within 2 days and not yet dispatched), delayed 10+ days and delayed 20+ days. Click a tile to filter the list. Each order has a one-click next step: **Confirm** → **On the way** → **Received** (receiving adds the quantities to stock). **All orders** tab: full order history.
- **Home → Restock**: every item with its stock level, reorder level and quantity already on order. Tiles filter by needs restock, out of stock, low, getting low (within 1.5× reorder level), already on order, or all items. Out-of-stock and low items that are not on order start ticked, with a suggested quantity (up to twice the reorder level). Pick a vendor, decide the price, and **Place order** creates one purchase order per vendor.
- **Price decision** (Requests and Restock): each line shows the **old price** (what that vendor charged last time, else the catalogue price). Procurement must set a **new price**, either **Same price** (one click, or "Same price for all") or the new market rate, which shows the % change. You can't place an order until every line has a price.
- **Who can request what**: only the Pharmacy raises purchase requests for medicines. The wards (Emergency, ICU, OT, General Ward, Paediatrics, Maternity, OPD) receive medicines from the Pharmacy through Billing. This is set per department in Vendors → Departments, and requests from other departments are rejected.
- **Requests**: a department picks itself, types a medicine (for example "para 500"), and brand, strength, unit and stock fill in automatically. It enters the quantity and sends the request. Procurement sees each request with the usual vendor already selected, plus past vendors and their last prices. Change the vendor if needed, decide the price, then **Place order**. One purchase order is created per vendor. Cancelling an order puts its items back on the request.
- **Stock**: Items & stock (add, edit, reprice, − / + stock, CSV export), Categories, Stock ledger (audit trail of every movement).
- **Billing**: New bill (issue stock to a department; GST per item; stock is deducted in one step), Bills (search, print, cancel to return stock).
- **Vendors**: Vendors and Departments.
- **Reports**: Overview charts, reorder list, expiry watch, stock valuation, department consumption. All can be exported to CSV.

## Structure

```
client/src/mock/seedData.js   starter catalogue, vendors, departments
client/src/mock/seed.js       builds the sample bills, purchase orders and requests
client/src/mock/services.js   stock logic (billing, cancel, PO receive, adjustments, requests)
client/src/mock/routes.js     the API the screens call (/items, /bills, /requests, ...)
client/src/mock/store.js      in-browser database with localStorage persistence and rollback
client/src/api.js             thin wrapper the pages use to call the routes
client/src/pages/             one file per screen
client/src/components/        layout, modals, charts, shared UI
```
