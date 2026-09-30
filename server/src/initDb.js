// Creates the schema and loads the starter catalogue.
//   npm run db:init   -> create tables, seed only if empty
//   npm run db:reset  -> drop everything and reseed
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, withTransaction } from './db.js';
import { catalogue, suppliers, departments } from './seedData.js';
import {
  createBill, createPurchaseOrder, recordMovement, advancePurchaseOrder, receivePurchaseOrder, createRequest, placeRequestOrder, guessStrength,
  cancelPurchaseOrder,
} from './services.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reset = process.argv.includes('--reset');

// Deterministic pseudo-random so every reset looks the same
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

function isoDate(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

async function run() {
  if (reset) {
    await pool.query(`DROP TABLE IF EXISTS department_groups, request_items, requests, purchase_order_items, purchase_orders, bill_items, bills,
      stock_movements, items, departments, suppliers, categories CASCADE`);
    console.log('Dropped existing tables');
  }
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  console.log('Schema ready');

  const { rows } = await pool.query('SELECT count(*) AS n FROM categories');
  if (rows[0].n > 0) console.log('Data already present — skipping seed (use npm run db:reset to reseed)');
  else await seedSampleData();

  // Fill the strength column (500mg, 1g, 40IU/ml…) from item names where it is blank
  const { rows: blanks } = await pool.query('SELECT id, name FROM items WHERE strength IS NULL');
  let filled = 0;
  for (const it of blanks) {
    const strength = guessStrength(it.name);
    if (!strength) continue;
    await pool.query('UPDATE items SET strength = $1 WHERE id = $2', [strength, it.id]);
    filled += 1;
  }
  if (filled) console.log(`Filled strength for ${filled} items`);
}

async function seedSampleData() {
  await withTransaction(async (c) => {
    const supplierIds = [];
    for (const s of suppliers) {
      const r = await c.query(
        'INSERT INTO suppliers (name, contact_person, phone, email, address, gst_number) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [s.name, s.contact_person, s.phone, s.email, s.address, s.gst_number]
      );
      supplierIds.push(r.rows[0].id);
    }
    for (const d of departments) {
      await c.query('INSERT INTO departments (name, head, location) VALUES ($1,$2,$3)', [d.name, d.head, d.location]);
    }

    let itemCount = 0;
    for (const group of catalogue) {
      const g = await c.query(
        'INSERT INTO categories (name, icon, description) VALUES ($1,$2,$3) RETURNING id',
        [group.name, group.icon, group.description]
      );
      let n = 0;
      for (const sub of group.subs) {
        const s = await c.query('INSERT INTO categories (name, parent_id) VALUES ($1,$2) RETURNING id', [sub.name, g.rows[0].id]);
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
          const ins = await c.query(
            `INSERT INTO items (sku, name, category_id, supplier_id, unit, price, quantity, reorder_level, gst_rate,
               manufacturer, batch_no, expiry_date, location, strength, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now() - interval '45 days') RETURNING id`,
            [sku, name, s.rows[0].id, supplierIds[group.supplier], unit, price, qty, reorder, gst, maker, batch, expiry, location, guessStrength(name)]
          );
          await recordMovement(c, {
            item_id: ins.rows[0].id, item_name: name, change: qty, balance_after: qty,
            type: 'OPENING', note: 'Opening stock', created_at: new Date(Date.now() - 45 * 864e5),
          });
          itemCount += 1;
        }
      }
    }
    console.log(`Seeded ${itemCount} items in ${catalogue.length} groups`);

    // What each department may request
    for (const d of departments) {
      await c.query(
        `INSERT INTO department_groups (department_id, category_id)
         SELECT dp.id, g.id FROM departments dp, categories g
          WHERE dp.name = $1 AND g.parent_id IS NULL AND g.name = ANY($2)`, [d.name, d.groups]);
    }

    // ---- Sample history: bills over the last 30 days ----
    const { rows: items } = await c.query('SELECT id, quantity, reorder_level FROM items');
    const { rows: depts } = await c.query('SELECT id, name, head FROM departments');
    const requesters = ['Sr. Anjali', 'Dr. Rahul', 'Mr. Vinod', 'Sr. Grace', 'Dr. Fatima', 'Mr. Prakash', 'Sr. Divya'];
    let bills = 0;
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
        await createBill(c, {
          department_id: dept.id,
          requested_by: pick(requesters),
          items: lines,
          created_at: when,
        });
        bills += 1;
      }
    }
    console.log(`Seeded ${bills} sample bills`);

    // ---- Sample purchase orders, spread across every tracking state ----
    // [status, created days ago, expected in N days (negative = overdue)]
    const scenarios = [
      ['PENDING', 0, 7], ['PENDING', 1, 6], ['PENDING', 6, 1], ['PENDING', 30, -23],
      ['CONFIRMED', 3, 5], ['CONFIRMED', 11, -4], ['CONFIRMED', 19, -12],
      ['DISPATCHED', 5, 2], ['DISPATCHED', 6, 3], ['DISPATCHED', 14, -7], ['DISPATCHED', 22, -15],
      ['RECEIVED', 20, -13], ['RECEIVED', 12, -5],
    ];
    const { rows: stockItems } = await c.query(
      'SELECT id, reorder_level, price FROM items ORDER BY (quantity <= reorder_level) DESC, id');
    // Orders rotate between the medicine wholesalers, each a little cheaper or dearer than the list price
    const factors = [1, 0.94, 0.97, 1.03, 0.99];
    let pos = 0;
    for (const [i, [status, ago, due]] of scenarios.entries()) {
      const vendorIdx = i % supplierIds.length;
      const lines = [0, 1, 2].map((k) => stockItems[(i * 3 + k) % stockItems.length])
        .map((it) => ({ item_id: it.id, quantity: it.reorder_level * 2, unit_cost: Math.round(it.price * factors[vendorIdx] * 100) / 100 }));
      const po = await createPurchaseOrder(c, {
        supplier_id: supplierIds[vendorIdx], items: lines, expected_date: isoDate(due),
        created_at: new Date(Date.now() - ago * 864e5), notes: 'Restock',
      });
      if (status === 'CONFIRMED' || status === 'DISPATCHED') await advancePurchaseOrder(c, po.id, status);
      if (status === 'RECEIVED') await receivePurchaseOrder(c, po.id);
      pos += 1;
    }
    console.log(`Seeded ${pos} purchase orders`);

    // ---- Sample purchase requests: every medicine category, every state ----
    // lines: [category, how many items] or [name pattern, qty] for named medicines.
    // flow: what happens after the request is sent
    //   pending              waiting for procurement to pick a vendor
    //   partial              only the first item ordered, the rest still waiting
    //   ordered:<STATUS>     ordered; the order then moves to PENDING / CONFIRMED / DISPATCHED / RECEIVED
    //   split                items ordered from two different vendors
    //   late:<days>          ordered, the order is now <days> late
    //   vendorCancelled      ordered, then the order was cancelled so the items came back to the request
    //   cancelled            the request itself was cancelled
    //   priceUp              ordered at a higher price than last time
    // Pharmacy is the only department that raises purchase requests; together these cover every
    // medicine category (lines: [category, how many items] or ['name pattern', qty]) and every state.
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
    const pickLines = async (lines) => {
      const out = [];
      for (const [key, n] of lines) {
        if (!key.includes('%')) {
          const { rows: pool } = await c.query(
            `SELECT i.id, i.reorder_level FROM items i JOIN categories s ON s.id = i.category_id
              WHERE s.name = $1 ORDER BY (i.quantity <= i.reorder_level) DESC, i.id`, [key]);
          for (let k = 0; k < n; k += 1) {
            used[key] = (used[key] || 0) + 1;
            const it = pool[(used[key] - 1) % pool.length];
            if (!out.some((o) => o.item_id === it.id)) out.push({ item_id: it.id, quantity: Math.max(it.reorder_level, 5) });
          }
        } else {
          const { rows: m } = await c.query('SELECT id FROM items WHERE name ILIKE $1 LIMIT 1', [key]);
          out.push({ item_id: m[0].id, quantity: n });
        }
      }
      return out;
    };
    const openLines = async (reqId) => (await c.query(
      `SELECT ri.id, i.supplier_id, i.price FROM request_items ri JOIN items i ON i.id = ri.item_id
        WHERE ri.request_id = $1 AND ri.po_id IS NULL ORDER BY ri.id`, [reqId])).rows;

    for (const r of sampleRequests) {
      const when = new Date(Date.now() - r.ago * 864e5);
      const created = await createRequest(c, {
        department_id: deptId(r.dept), requested_by: r.by, priority: r.priority, notes: r.notes, items: await pickLines(r.lines), created_at: when,
      });
      const [kind, arg] = r.flow.split(':');
      if (kind === 'pending') continue;
      if (kind === 'cancelled') {
        await c.query("UPDATE requests SET status = 'CANCELLED' WHERE id = $1", [created.id]);
        continue;
      }
      const lines = await openLines(created.id);
      const orderAt = new Date(when.getTime() + 3 * 3600e3);
      let chosen = lines.map((l) => ({ request_item_id: l.id, supplier_id: l.supplier_id, unit_cost: l.price }));
      if (kind === 'partial') chosen = chosen.slice(0, 1);
      if (kind === 'split') chosen = chosen.map((l, k) => (k % 2 ? { ...l, supplier_id: supplierIds.at(-2), unit_cost: Math.round(l.unit_cost * 0.95 * 100) / 100 } : l));
      if (kind === 'priceUp') chosen = chosen.map((l) => ({ ...l, unit_cost: Math.round(l.unit_cost * 1.12 * 100) / 100 }));
      const expected = kind === 'late' ? isoDate(-Number(arg)) : isoDate(Math.max(7 - Math.round(r.ago), 2));
      const { orders } = await placeRequestOrder(c, created.id, { lines: chosen, expected_date: expected, created_at: orderAt });

      for (const [k, po] of orders.entries()) {
        if (kind === 'ordered' && arg !== 'PENDING') {
          if (arg === 'RECEIVED') await receivePurchaseOrder(c, po.id);
          else await advancePurchaseOrder(c, po.id, arg);
        }
        if (kind === 'split') await advancePurchaseOrder(c, po.id, k === 0 ? 'CONFIRMED' : 'DISPATCHED');
        if (kind === 'priceUp' || kind === 'late') await advancePurchaseOrder(c, po.id, 'CONFIRMED');
        if (kind === 'vendorCancelled') await cancelPurchaseOrder(c, po.id);
      }
    }
    console.log(`Seeded ${sampleRequests.length} department requests`);
  });
}

run()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end();
    process.exit(1);
  });
