// Builds the sample database in the browser: the same catalogue, vendors, departments, bills,
// purchase orders and purchase requests the Postgres seed script (initDb.js) used to load.
import { catalogue, suppliers, departments } from './seedData.js';
import { isoDate } from './dates.js';
import {
  createBill, createPurchaseOrder, recordMovement, advancePurchaseOrder, receivePurchaseOrder, createRequest,
  placeRequestOrder, cancelPurchaseOrder, guessStrength, nextId,
} from './services.js';

export const DB_VERSION = 1;

const TABLES = [
  'categories', 'suppliers', 'departments', 'department_groups', 'items', 'stock_movements', 'bills', 'bill_items',
  'purchase_orders', 'purchase_order_items', 'requests', 'request_items',
];

function emptyDb() {
  const db = { version: DB_VERSION, seededAt: new Date().toISOString(), seq: {} };
  for (const t of TABLES) {
    db[t] = [];
    db.seq[t] = 0;
  }
  return db;
}

// SQL ILIKE with % wildcards
const ilike = (text, pattern) =>
  new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`, 'i').test(text);

export function createSeededDb() {
  // Deterministic pseudo-random so every reset looks the same
  let seed = 42;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  const db = emptyDb();
  const now = new Date().toISOString();

  const supplierIds = suppliers.map((s) => {
    const id = nextId(db, 'suppliers');
    db.suppliers.push({ id, ...s, created_at: now });
    return id;
  });
  for (const d of departments) {
    db.departments.push({ id: nextId(db, 'departments'), name: d.name, head: d.head, location: d.location, created_at: now });
  }

  for (const group of catalogue) {
    const gId = nextId(db, 'categories');
    db.categories.push({ id: gId, name: group.name, parent_id: null, icon: group.icon, description: group.description, created_at: now });
    let n = 0;
    for (const sub of group.subs) {
      const sId = nextId(db, 'categories');
      db.categories.push({ id: sId, name: sub.name, parent_id: gId, icon: null, description: null, created_at: now });
      for (const [name, unit, price, qty, reorder, gst, maker] of sub.items) {
        n += 1;
        const sku = `${group.prefix}-${String(n).padStart(4, '0')}`;
        let expiry = null;
        let batch = null;
        if (group.expiry) {
          // A handful expire soon so the expiry report has something to show
          expiry = isoDate(rand() < 0.12 ? Math.floor(rand() * 75) + 5 : Math.floor(rand() * 600) + 120);
          batch = `B${Math.floor(rand() * 90000 + 10000)}`;
        }
        const location = `Store ${group.prefix} / Rack ${Math.floor(rand() * 12) + 1}`;
        const opening = new Date(Date.now() - 45 * 864e5);
        const item = {
          id: nextId(db, 'items'), sku, name, category_id: sId, supplier_id: supplierIds[group.supplier], unit, price,
          quantity: qty, reorder_level: reorder, gst_rate: gst, manufacturer: maker, batch_no: batch, expiry_date: expiry,
          location, description: null, strength: guessStrength(name),
          created_at: opening.toISOString(), updated_at: now,
        };
        db.items.push(item);
        recordMovement(db, {
          item_id: item.id, item_name: name, change: qty, balance_after: qty,
          type: 'OPENING', note: 'Opening stock', created_at: opening,
        });
      }
    }
  }

  // What each department may request
  for (const d of departments) {
    const dept = db.departments.find((x) => x.name === d.name);
    for (const g of db.categories.filter((c) => c.parent_id == null && d.groups.includes(c.name))) {
      db.department_groups.push({ department_id: dept.id, category_id: g.id });
    }
  }

  // ---- Sample history: bills over the last 30 days ----
  const items = db.items.map((i) => ({ id: i.id, quantity: i.quantity, reorder_level: i.reorder_level }));
  const depts = db.departments;
  const requesters = ['Sr. Anjali', 'Dr. Rahul', 'Mr. Vinod', 'Sr. Grace', 'Dr. Fatima', 'Mr. Prakash', 'Sr. Divya'];
  for (let day = 29; day >= 0; day -= 1) {
    const perDay = 1 + Math.floor(rand() * 3);
    for (let b = 0; b < perDay; b += 1) {
      const lines = [];
      const used = new Set();
      const lineCount = 2 + Math.floor(rand() * 5);
      for (let i = 0; i < lineCount; i += 1) {
        const it = pick(items);
        if (used.has(it.id)) continue;
        // Only issue from comfortably stocked items so seeded low-stock items stay as designed
        const spare = it.quantity - it.reorder_level * 1.5;
        if (spare < 4) continue;
        const qty = Math.max(1, Math.floor(rand() * Math.min(spare * 0.08, 40)));
        it.quantity -= qty;
        used.add(it.id);
        lines.push({ item_id: it.id, quantity: qty });
      }
      if (!lines.length) continue;
      const dept = pick(depts.filter((d) => d.name !== 'Pharmacy'));
      const when = new Date(Date.now() - day * 864e5 - Math.floor(rand() * 8 * 3600e3));
      createBill(db, { department_id: dept.id, requested_by: pick(requesters), items: lines, created_at: when });
    }
  }

  // ---- Sample purchase orders, spread across every tracking state ----
  // [status, created days ago, expected in N days (negative = overdue)]
  const scenarios = [
    ['PENDING', 0, 7], ['PENDING', 1, 6], ['PENDING', 6, 1], ['PENDING', 30, -23],
    ['CONFIRMED', 3, 5], ['CONFIRMED', 11, -4], ['CONFIRMED', 19, -12],
    ['DISPATCHED', 5, 2], ['DISPATCHED', 6, 3], ['DISPATCHED', 14, -7], ['DISPATCHED', 22, -15],
    ['RECEIVED', 20, -13], ['RECEIVED', 12, -5],
  ];
  const stockItems = [...db.items].sort((a, b) =>
    (Number(b.quantity <= b.reorder_level) - Number(a.quantity <= a.reorder_level)) || a.id - b.id);
  // Orders rotate between the medicine wholesalers, each a little cheaper or dearer than the list price
  const factors = [1, 0.94, 0.97, 1.03, 0.99];
  for (const [i, [status, ago, due]] of scenarios.entries()) {
    const vendorIdx = i % supplierIds.length;
    const lines = [0, 1, 2].map((k) => stockItems[(i * 3 + k) % stockItems.length])
      .map((it) => ({ item_id: it.id, quantity: it.reorder_level * 2, unit_cost: Math.round(it.price * factors[vendorIdx] * 100) / 100 }));
    const po = createPurchaseOrder(db, {
      supplier_id: supplierIds[vendorIdx], items: lines, expected_date: isoDate(due),
      created_at: new Date(Date.now() - ago * 864e5), notes: 'Restock',
    });
    if (status === 'CONFIRMED' || status === 'DISPATCHED') advancePurchaseOrder(db, po.id, status);
    if (status === 'RECEIVED') receivePurchaseOrder(db, po.id);
  }

  // ---- Sample purchase requests: every medicine category, every state ----
  // lines: [category, how many items] or ['name pattern%', qty] for named medicines.
  // flow: what happens after the request is sent
  //   pending              waiting for procurement to pick a vendor
  //   partial              only the first item ordered, the rest still waiting
  //   ordered:<STATUS>     ordered; the order then moves to PENDING / CONFIRMED / DISPATCHED / RECEIVED
  //   split                items ordered from two different vendors
  //   late:<days>          ordered, the order is now <days> late
  //   vendorCancelled      ordered, then the order was cancelled so the items came back to the request
  //   cancelled            the request itself was cancelled
  //   priceUp              ordered at a higher price than last time
  // Pharmacy is the only department that raises purchase requests.
  const PHARMACIST = 'Mr. Deepak Jain';
  const sampleRequests = [
    { by: PHARMACIST, priority: 'URGENT', ago: 0.1, flow: 'pending', notes: 'ICU running short',
      lines: [['Paracetamol 500mg%', 300], ['Amoxicillin 500mg%', 150], ['Pantoprazole 40mg Tab%', 120], ['Metformin 500mg%', 200]] },
    { by: 'Ms. Priya Raj', priority: 'URGENT', ago: 0.3, flow: 'pending', notes: 'Crash cart top-up',
      lines: [['Emergency & Critical Drugs', 3], ['IV Fluids', 2]] },
    { by: 'Ms. Priya Raj', ago: 0.5, flow: 'pending', lines: [['Anaesthesia', 3]], notes: 'OT list next week' },
    { by: PHARMACIST, ago: 1, flow: 'pending', lines: [['Respiratory', 2], ['Antifungals & Antivirals', 2]] },
    { by: 'Mr. Sunil K', ago: 1.5, flow: 'pending', lines: [['Vitamins & Supplements', 3]], notes: 'Maternity ward stock' },
    { by: PHARMACIST, ago: 2, flow: 'partial', lines: [['Neuro & Psychiatric', 2], ['Analgesics & Antipyretics', 2]] },
    { by: PHARMACIST, ago: 3, flow: 'split',
      lines: [['Ceftriaxone 1g%', 200], ['Ondansetron%', 150], ['Amlodipine%', 200], ['Atorvastatin%', 150]] },
    { by: PHARMACIST, ago: 6, flow: 'priceUp', lines: [['Insulin Glargine%', 30], ['Human Insulin%', 60]], notes: 'Insulin rates revised' },
    { by: 'Mr. Sunil K', ago: 1, flow: 'ordered:PENDING', lines: [['Antiseptics & Topicals', 3]] },
    { by: 'Ms. Priya Raj', ago: 3, flow: 'ordered:CONFIRMED', lines: [['Cardiac & Blood Pressure', 3]] },
    { by: PHARMACIST, ago: 4, flow: 'ordered:DISPATCHED', lines: [['Gastro & Antacids', 3]] },
    { by: PHARMACIST, ago: 9, flow: 'ordered:RECEIVED', lines: [['ORS%', 400], ['Paracetamol 650mg%', 100]] },
    { by: 'Mr. Sunil K', ago: 12, flow: 'ordered:RECEIVED', lines: [['Diabetes Care', 2]] },
    { by: PHARMACIST, ago: 20, flow: 'late:12', lines: [['Antibiotics', 3]] },
    { by: 'Ms. Priya Raj', ago: 30, flow: 'late:23', lines: [['IV Fluids', 2], ['Emergency & Critical Drugs', 1]] },
    { by: PHARMACIST, ago: 4, flow: 'vendorCancelled', lines: [['Respiratory', 1], ['Analgesics & Antipyretics', 2]] },
    { by: 'Mr. Sunil K', ago: 5, flow: 'cancelled', lines: [['Vitamins & Supplements', 1]], notes: 'Duplicate request' },
  ].map((r) => ({ ...r, dept: 'Pharmacy' }));

  const deptId = (name) => depts.find((d) => d.name.startsWith(name)).id;
  const used = {}; // spread picks across each group
  const pickLines = (lines) => {
    const out = [];
    for (const [key, n] of lines) {
      if (!key.includes('%')) {
        const sub = db.categories.find((c) => c.name === key && c.parent_id != null);
        const pool = db.items.filter((i) => i.category_id === sub.id)
          .sort((a, b) => (Number(b.quantity <= b.reorder_level) - Number(a.quantity <= a.reorder_level)) || a.id - b.id);
        for (let k = 0; k < n; k += 1) {
          used[key] = (used[key] || 0) + 1;
          const it = pool[(used[key] - 1) % pool.length];
          if (!out.some((o) => o.item_id === it.id)) out.push({ item_id: it.id, quantity: Math.max(it.reorder_level, 5) });
        }
      } else {
        const m = db.items.find((i) => ilike(i.name, key));
        out.push({ item_id: m.id, quantity: n });
      }
    }
    return out;
  };
  const openLines = (reqId) => db.request_items
    .filter((ri) => ri.request_id === reqId && ri.po_id == null)
    .map((ri) => {
      const it = db.items.find((i) => i.id === ri.item_id);
      return { id: ri.id, supplier_id: it.supplier_id, price: it.price };
    });

  for (const r of sampleRequests) {
    const when = new Date(Date.now() - r.ago * 864e5);
    const created = createRequest(db, {
      department_id: deptId(r.dept), requested_by: r.by, priority: r.priority, notes: r.notes, items: pickLines(r.lines), created_at: when,
    });
    const [kind, arg] = r.flow.split(':');
    if (kind === 'pending') continue;
    if (kind === 'cancelled') {
      db.requests.find((x) => x.id === created.id).status = 'CANCELLED';
      continue;
    }
    const lines = openLines(created.id);
    const orderAt = new Date(when.getTime() + 3 * 3600e3);
    let chosen = lines.map((l) => ({ request_item_id: l.id, supplier_id: l.supplier_id, unit_cost: l.price }));
    if (kind === 'partial') chosen = chosen.slice(0, 1);
    if (kind === 'split') chosen = chosen.map((l, k) => (k % 2 ? { ...l, supplier_id: supplierIds.at(-2), unit_cost: Math.round(l.unit_cost * 0.95 * 100) / 100 } : l));
    if (kind === 'priceUp') chosen = chosen.map((l) => ({ ...l, unit_cost: Math.round(l.unit_cost * 1.12 * 100) / 100 }));
    const expected = kind === 'late' ? isoDate(-Number(arg)) : isoDate(Math.max(7 - Math.round(r.ago), 2));
    const { orders } = placeRequestOrder(db, created.id, { lines: chosen, expected_date: expected, created_at: orderAt });

    for (const [k, po] of orders.entries()) {
      if (kind === 'ordered' && arg !== 'PENDING') {
        if (arg === 'RECEIVED') receivePurchaseOrder(db, po.id);
        else advancePurchaseOrder(db, po.id, arg);
      }
      if (kind === 'split') advancePurchaseOrder(db, po.id, k === 0 ? 'CONFIRMED' : 'DISPATCHED');
      if (kind === 'priceUp' || kind === 'late') advancePurchaseOrder(db, po.id, 'CONFIRMED');
      if (kind === 'vendorCancelled') cancelPurchaseOrder(db, po.id);
    }
  }

  return db;
}
