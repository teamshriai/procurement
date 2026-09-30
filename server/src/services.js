// Core stock-changing operations. Every function expects a client that is
// already inside a transaction (see withTransaction in db.js).

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const round2 = (n) => Math.round(n * 100) / 100;

/** Pull a strength such as 500mg, 4.5g, 40IU/ml or 5% out of an item name. */
export function guessStrength(name) {
  const m = /\d+(?:\.\d+)?\s?(?:(?:mg|mcg|g|ml|IU)(?:\/\d*\s?ml)?\b|%)/i.exec(name || '');
  return m ? m[0] : null;
}
const pad = (n) => String(n).padStart(5, '0');

export async function recordMovement(client, { item_id, item_name, change, balance_after, type, reference, note, created_at }) {
  await client.query(
    `INSERT INTO stock_movements (item_id, item_name, change, balance_after, type, reference, note, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8, now()))`,
    [item_id, item_name, change, balance_after, type, reference || null, note || null, created_at || null]
  );
}

/** Increase or decrease one item's stock and log it. */
export async function adjustStock(client, itemId, change, { type = 'ADJUSTMENT', reference, note } = {}) {
  const { rows } = await client.query('SELECT id, name, quantity FROM items WHERE id = $1 FOR UPDATE', [itemId]);
  const item = rows[0];
  if (!item) throw new HttpError(404, 'Item not found');
  const next = item.quantity + change;
  if (next < 0) throw new HttpError(400, `Only ${item.quantity} in stock for "${item.name}"`);
  const { rows: updated } = await client.query(
    'UPDATE items SET quantity = $1, updated_at = now() WHERE id = $2 RETURNING *',
    [next, itemId]
  );
  await recordMovement(client, { item_id: item.id, item_name: item.name, change, balance_after: next, type, reference, note });
  return updated[0];
}

/**
 * Create a bill (stock issue) — validates stock for every line, decrements
 * inventory, logs movements. Throws 400 with per-line details on shortage.
 */
export async function createBill(client, { department_id, requested_by, patient_ref, notes, discount = 0, items, created_at }) {
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'Add at least one item to the bill');

  // Merge duplicate lines
  const merged = new Map();
  for (const line of items) {
    const qty = parseInt(line.quantity, 10);
    if (!line.item_id || !Number.isFinite(qty) || qty <= 0) throw new HttpError(400, 'Every line needs an item and a quantity above 0');
    merged.set(line.item_id, (merged.get(line.item_id) || 0) + qty);
  }
  const ids = [...merged.keys()];

  // Lock rows in id order to avoid deadlocks between concurrent bills
  const { rows: stock } = await client.query(
    'SELECT * FROM items WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE',
    [ids]
  );
  const byId = new Map(stock.map((r) => [r.id, r]));

  const shortages = [];
  for (const [id, qty] of merged) {
    const it = byId.get(Number(id));
    if (!it) shortages.push({ item_id: id, name: 'Unknown item', requested: qty, available: 0 });
    else if (it.quantity < qty) shortages.push({ item_id: it.id, name: it.name, requested: qty, available: it.quantity });
  }
  if (shortages.length) throw new HttpError(400, 'Insufficient stock for some items', { shortages });

  let subtotal = 0;
  let taxTotal = 0;
  const lines = [];
  for (const [id, qty] of merged) {
    const it = byId.get(Number(id));
    const base = round2(it.price * qty);
    const tax = round2((base * it.gst_rate) / 100);
    subtotal += base;
    taxTotal += tax;
    lines.push({ it, qty, tax, lineTotal: round2(base + tax) });
  }
  subtotal = round2(subtotal);
  taxTotal = round2(taxTotal);
  const disc = Math.min(Math.max(round2(Number(discount) || 0), 0), subtotal + taxTotal);
  const total = round2(subtotal + taxTotal - disc);

  const { rows: seq } = await client.query("SELECT nextval('bills_id_seq') AS id");
  const billId = seq[0].id;
  const billNo = `SHPC-INV-${pad(billId)}`;

  const { rows: billRows } = await client.query(
    `INSERT INTO bills (id, bill_no, department_id, requested_by, patient_ref, notes, subtotal, tax_total, discount, total, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11, now())) RETURNING *`,
    [billId, billNo, department_id || null, requested_by || null, patient_ref || null, notes || null, subtotal, taxTotal, disc, total, created_at || null]
  );

  for (const { it, qty, tax, lineTotal } of lines) {
    await client.query(
      `INSERT INTO bill_items (bill_id, item_id, item_name, sku, unit, quantity, unit_price, gst_rate, tax_amount, line_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [billId, it.id, it.name, it.sku, it.unit, qty, it.price, it.gst_rate, tax, lineTotal]
    );
    const balance = it.quantity - qty;
    await client.query('UPDATE items SET quantity = $1, updated_at = now() WHERE id = $2', [balance, it.id]);
    await recordMovement(client, {
      item_id: it.id, item_name: it.name, change: -qty, balance_after: balance,
      type: 'ISSUE', reference: billNo, note: 'Issued against bill', created_at,
    });
  }
  return billRows[0];
}

/** Cancel a bill and put its stock back. */
export async function cancelBill(client, billId, reason) {
  const { rows } = await client.query('SELECT * FROM bills WHERE id = $1 FOR UPDATE', [billId]);
  const bill = rows[0];
  if (!bill) throw new HttpError(404, 'Bill not found');
  if (bill.status === 'CANCELLED') throw new HttpError(400, 'Bill is already cancelled');

  const { rows: lines } = await client.query('SELECT * FROM bill_items WHERE bill_id = $1 ORDER BY item_id', [billId]);
  for (const line of lines) {
    if (!line.item_id) continue; // item was deleted from the catalogue
    await adjustStock(client, line.item_id, line.quantity, {
      type: 'ISSUE_CANCEL', reference: bill.bill_no, note: reason || 'Bill cancelled — stock returned',
    });
  }
  const { rows: updated } = await client.query(
    "UPDATE bills SET status = 'CANCELLED', cancelled_at = now(), notes = COALESCE(notes || E'\\n', '') || $2 WHERE id = $1 RETURNING *",
    [billId, `Cancelled: ${reason || 'no reason given'}`]
  );
  return updated[0];
}

export async function createPurchaseOrder(client, { supplier_id, expected_date, notes, items, created_at, request_id }) {
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'Add at least one item to the purchase order');
  const ids = items.map((l) => l.item_id);
  const { rows: found } = await client.query('SELECT id, name, price FROM items WHERE id = ANY($1::int[])', [ids]);
  const byId = new Map(found.map((r) => [r.id, r]));

  const lines = items.map((l) => {
    const it = byId.get(Number(l.item_id));
    const qty = parseInt(l.quantity, 10);
    if (!it || !Number.isFinite(qty) || qty <= 0) throw new HttpError(400, 'Every line needs a valid item and a quantity above 0');
    const cost = l.unit_cost === undefined || l.unit_cost === '' ? it.price : Number(l.unit_cost);
    if (!Number.isFinite(cost) || cost < 0) throw new HttpError(400, `Invalid unit cost for "${it.name}"`);
    return { it, qty, cost, lineTotal: round2(qty * cost), request_item_id: l.request_item_id };
  });
  const total = round2(lines.reduce((s, l) => s + l.lineTotal, 0));

  const { rows: seq } = await client.query("SELECT nextval('purchase_orders_id_seq') AS id");
  const poId = seq[0].id;
  const poNo = `SHPC-PO-${pad(poId)}`;
  const { rows } = await client.query(
    `INSERT INTO purchase_orders (id, po_no, supplier_id, expected_date, notes, total, created_at, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, now()),$8) RETURNING *`,
    [poId, poNo, supplier_id || null, expected_date || null, notes || null, total, created_at || null, request_id || null]
  );
  for (const l of lines) {
    await client.query(
      'INSERT INTO purchase_order_items (po_id, item_id, item_name, quantity, unit_cost, line_total) VALUES ($1,$2,$3,$4,$5,$6)',
      [poId, l.it.id, l.it.name, l.qty, l.cost, l.lineTotal]
    );
    if (l.request_item_id) {
      await client.query('UPDATE request_items SET po_id = $1 WHERE id = $2', [poId, l.request_item_id]);
    }
  }
  return rows[0];
}

export const OPEN_PO = ['PENDING', 'CONFIRMED', 'DISPATCHED'];

/** Mark a PO received and add its quantities to stock. */
export async function receivePurchaseOrder(client, poId) {
  const { rows } = await client.query('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [poId]);
  const po = rows[0];
  if (!po) throw new HttpError(404, 'Purchase order not found');
  if (!OPEN_PO.includes(po.status)) throw new HttpError(400, `Purchase order is already ${po.status.toLowerCase()}`);
  const { rows: lines } = await client.query('SELECT * FROM purchase_order_items WHERE po_id = $1 ORDER BY item_id', [poId]);
  for (const l of lines) {
    if (!l.item_id) continue;
    await adjustStock(client, l.item_id, l.quantity, { type: 'PURCHASE', reference: po.po_no, note: 'Goods received' });
  }
  const { rows: updated } = await client.query(
    "UPDATE purchase_orders SET status = 'RECEIVED', received_at = now() WHERE id = $1 RETURNING *",
    [poId]
  );
  return updated[0];
}

/** Vendor confirmed (PENDING -> CONFIRMED) or goods dispatched (-> DISPATCHED). */
export async function advancePurchaseOrder(client, poId, next) {
  const allowed = { CONFIRMED: ['PENDING'], DISPATCHED: ['PENDING', 'CONFIRMED'] }[next];
  const { rows } = await client.query('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [poId]);
  const po = rows[0];
  if (!po) throw new HttpError(404, 'Purchase order not found');
  if (!allowed.includes(po.status)) throw new HttpError(400, `Order is ${po.status.toLowerCase()} and cannot be moved to ${next.toLowerCase()}`);
  const { rows: updated } = await client.query(
    `UPDATE purchase_orders SET status = $2,
            confirmed_at = COALESCE(confirmed_at, now()),
            dispatched_at = CASE WHEN $2 = 'DISPATCHED' THEN now() ELSE dispatched_at END
      WHERE id = $1 RETURNING *`,
    [poId, next]
  );
  return updated[0];
}

/** Cancel an open PO. Request lines it covered go back to the request queue. */
export async function cancelPurchaseOrder(client, poId) {
  const { rows } = await client.query(
    'UPDATE purchase_orders SET status = \'CANCELLED\' WHERE id = $1 AND status = ANY($2) RETURNING *', [poId, OPEN_PO]);
  if (!rows[0]) throw new HttpError(400, 'Only open purchase orders can be cancelled');
  const { rows: freed } = await client.query(
    'UPDATE request_items SET po_id = NULL WHERE po_id = $1 RETURNING request_id', [poId]);
  const requestIds = [...new Set(freed.map((r) => r.request_id))];
  if (requestIds.length) {
    await client.query("UPDATE requests SET status = 'PENDING', ordered_at = NULL WHERE id = ANY($1) AND status = 'ORDERED'", [requestIds]);
    await client.query(
      `UPDATE requests SET notes = COALESCE(notes || ' · ', '') || $2 WHERE id = ANY($1)`,
      [requestIds, `Order ${rows[0].po_no} was cancelled, choose a vendor again`]);
  }
  return rows[0];
}

/** A department asks for items. Brand, strength and unit are filled from the catalogue unless given. */
export async function createRequest(client, { department_id, requested_by, priority, notes, items, created_at }) {
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'Add at least one item to the request');
  if (!department_id) throw new HttpError(400, 'Choose the department making the request');
  const ids = items.map((l) => l.item_id);
  const { rows: found } = await client.query(
    `SELECT i.id, i.name, i.manufacturer, i.strength, i.unit, g.id AS group_id, g.name AS group_name
       FROM items i JOIN categories c ON c.id = i.category_id LEFT JOIN categories g ON g.id = c.parent_id
      WHERE i.id = ANY($1::int[])`, [ids]);

  // A department may only request items from its own product groups (e.g. only Pharmacy orders medicines)
  const { rows: allowed } = await client.query(
    `SELECT d.name, array_remove(array_agg(g.name ORDER BY g.name), NULL) AS groups,
            array_remove(array_agg(g.id), NULL) AS group_ids
       FROM departments d LEFT JOIN department_groups dg ON dg.department_id = d.id
       LEFT JOIN categories g ON g.id = dg.category_id
      WHERE d.id = $1 GROUP BY d.name`, [department_id]);
  if (!allowed[0]) throw new HttpError(400, 'Department not found');
  const dept = allowed[0];
  const blocked = found.filter((it) => !dept.group_ids.includes(it.group_id));
  if (blocked.length) {
    throw new HttpError(400, `${dept.name} cannot request ${blocked.map((b) => `"${b.name}" (${b.group_name})`).join(', ')}. `
      + (dept.groups.length ? `It can request: ${dept.groups.join(', ')}.` : 'No product groups are set for it yet (Vendors → Departments).'));
  }
  const byId = new Map(found.map((r) => [r.id, r]));
  const lines = items.map((l) => {
    const it = byId.get(Number(l.item_id));
    const qty = parseInt(l.quantity, 10);
    if (!it || !Number.isFinite(qty) || qty <= 0) throw new HttpError(400, 'Every line needs an item and a quantity above 0');
    return { it, qty, brand: l.brand?.trim() || it.manufacturer, strength: l.strength?.trim() || it.strength };
  });

  const { rows: seq } = await client.query("SELECT nextval('requests_id_seq') AS id");
  const id = seq[0].id;
  const { rows } = await client.query(
    `INSERT INTO requests (id, request_no, department_id, requested_by, priority, notes, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, now())) RETURNING *`,
    [id, `SHPC-REQ-${pad(id)}`, department_id || null, requested_by || null,
      priority === 'URGENT' ? 'URGENT' : 'NORMAL', notes || null, created_at || null]
  );
  for (const l of lines) {
    await client.query(
      `INSERT INTO request_items (request_id, item_id, item_name, brand, strength, unit, quantity)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, l.it.id, l.it.name, l.brand, l.strength, l.it.unit, l.qty]
    );
  }
  return rows[0];
}

/**
 * Turn a request into purchase orders: one PO per chosen vendor.
 * lines: [{ request_item_id, supplier_id, quantity, unit_cost }] — lines without a vendor are left for later.
 */
export async function placeRequestOrder(client, requestId, { lines, expected_date, created_at }) {
  const { rows } = await client.query(
    `SELECT r.*, d.name AS department_name FROM requests r LEFT JOIN departments d ON d.id = r.department_id
      WHERE r.id = $1 FOR UPDATE OF r`, [requestId]);
  const req = rows[0];
  if (!req) throw new HttpError(404, 'Request not found');
  if (req.status !== 'PENDING') throw new HttpError(400, `Request is already ${req.status.toLowerCase()}`);

  const { rows: open } = await client.query(
    'SELECT * FROM request_items WHERE request_id = $1 AND po_id IS NULL', [requestId]);
  const openById = new Map(open.map((r) => [r.id, r]));
  const bySupplier = new Map();
  for (const l of lines || []) {
    const ri = openById.get(Number(l.request_item_id));
    const supplierId = Number(l.supplier_id);
    if (!ri || !supplierId) continue;
    if (!ri.item_id) throw new HttpError(400, `"${ri.item_name}" is no longer in the catalogue`);
    if (!bySupplier.has(supplierId)) bySupplier.set(supplierId, []);
    bySupplier.get(supplierId).push({
      item_id: ri.item_id, quantity: l.quantity ?? ri.quantity, unit_cost: l.unit_cost, request_item_id: ri.id,
    });
  }
  if (!bySupplier.size) throw new HttpError(400, 'Choose a vendor for at least one item');

  const orders = [];
  for (const [supplierId, items] of bySupplier) {
    orders.push(await createPurchaseOrder(client, {
      supplier_id: supplierId, expected_date, items, created_at, request_id: req.id,
      notes: `For ${req.request_no}${req.department_name ? ` · ${req.department_name}` : ''}`,
    }));
  }
  const { rows: left } = await client.query(
    'SELECT count(*) AS n FROM request_items WHERE request_id = $1 AND po_id IS NULL', [requestId]);
  if (left[0].n === 0) {
    await client.query("UPDATE requests SET status = 'ORDERED', ordered_at = COALESCE($2, now()) WHERE id = $1", [requestId, created_at || null]);
  }
  return { orders, remaining: left[0].n };
}
