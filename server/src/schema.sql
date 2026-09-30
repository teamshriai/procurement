-- Shri Health Procurement Centre — database schema

CREATE TABLE IF NOT EXISTS categories (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  parent_id    INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  icon         TEXT,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name, parent_id)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  contact_person  TEXT,
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  gst_number      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS departments (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  head        TEXT,
  location    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id             SERIAL PRIMARY KEY,
  sku            TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  category_id    INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  supplier_id    INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  unit           TEXT NOT NULL DEFAULT 'pcs',
  price          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  quantity       INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reorder_level  INTEGER NOT NULL DEFAULT 10 CHECK (reorder_level >= 0),
  gst_rate       NUMERIC(5,2) NOT NULL DEFAULT 12,
  manufacturer   TEXT,
  batch_no       TEXT,
  expiry_date    DATE,
  location       TEXT,
  description    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id);
CREATE INDEX IF NOT EXISTS idx_items_name ON items(lower(name));

CREATE TABLE IF NOT EXISTS stock_movements (
  id             SERIAL PRIMARY KEY,
  item_id        INTEGER REFERENCES items(id) ON DELETE SET NULL,
  item_name      TEXT NOT NULL,
  change         INTEGER NOT NULL,
  balance_after  INTEGER NOT NULL,
  type           TEXT NOT NULL,   -- OPENING, ADJUSTMENT, ISSUE, ISSUE_CANCEL, PURCHASE
  reference      TEXT,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_movements_item ON stock_movements(item_id);
CREATE INDEX IF NOT EXISTS idx_movements_created ON stock_movements(created_at DESC);

CREATE TABLE IF NOT EXISTS bills (
  id             SERIAL PRIMARY KEY,
  bill_no        TEXT NOT NULL UNIQUE,
  department_id  INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  requested_by   TEXT,
  patient_ref    TEXT,
  notes          TEXT,
  subtotal       NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_total      NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  total          NUMERIC(14,2) NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'COMPLETED',  -- COMPLETED, CANCELLED
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS bill_items (
  id          SERIAL PRIMARY KEY,
  bill_id     INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  item_id     INTEGER REFERENCES items(id) ON DELETE SET NULL,
  item_name   TEXT NOT NULL,
  sku         TEXT,
  unit        TEXT,
  quantity    INTEGER NOT NULL CHECK (quantity > 0),
  unit_price  NUMERIC(12,2) NOT NULL,
  gst_rate    NUMERIC(5,2) NOT NULL DEFAULT 0,
  tax_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_total  NUMERIC(14,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id             SERIAL PRIMARY KEY,
  po_no          TEXT NOT NULL UNIQUE,
  supplier_id    INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING, CONFIRMED, DISPATCHED, RECEIVED, CANCELLED
  expected_date  DATE,
  notes          TEXT,
  total          NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id          SERIAL PRIMARY KEY,
  po_id       INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id     INTEGER REFERENCES items(id) ON DELETE SET NULL,
  item_name   TEXT NOT NULL,
  quantity    INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost   NUMERIC(12,2) NOT NULL,
  line_total  NUMERIC(14,2) NOT NULL
);

-- Which product groups each department may request (only Pharmacy gets medicines)
CREATE TABLE IF NOT EXISTS department_groups (
  department_id  INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  category_id    INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (department_id, category_id)
);

-- ---------------------------------------------------------------- Requests
-- A department asks for items; procurement picks a vendor per line and
-- places the order, which creates one purchase order per vendor.

CREATE TABLE IF NOT EXISTS requests (
  id             SERIAL PRIMARY KEY,
  request_no     TEXT NOT NULL UNIQUE,
  department_id  INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  requested_by   TEXT,
  priority       TEXT NOT NULL DEFAULT 'NORMAL',  -- NORMAL, URGENT
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, ORDERED, CANCELLED
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ordered_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS request_items (
  id          SERIAL PRIMARY KEY,
  request_id  INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  item_id     INTEGER REFERENCES items(id) ON DELETE SET NULL,
  item_name   TEXT NOT NULL,
  brand       TEXT,
  strength    TEXT,
  unit        TEXT,
  quantity    INTEGER NOT NULL CHECK (quantity > 0),
  po_id       INTEGER REFERENCES purchase_orders(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_request_items_request ON request_items(request_id);

-- ---------------------------------------------------------------- Upgrades
-- Safe to run repeatedly on an existing database.

ALTER TABLE items ADD COLUMN IF NOT EXISTS strength TEXT;

-- Order lifecycle: PENDING (yet to be confirmed by vendor) -> CONFIRMED -> DISPATCHED (on the way) -> RECEIVED
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL;
ALTER TABLE purchase_orders ALTER COLUMN status SET DEFAULT 'PENDING';
UPDATE purchase_orders SET status = 'PENDING' WHERE status = 'ORDERED';
