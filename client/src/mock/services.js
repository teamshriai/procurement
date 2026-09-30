// Core stock-changing operations, ported from the original Express/Postgres server.
// Every function works on the in-browser database object and is expected to run inside
// store.transact(), which rolls the whole database back if anything throws.
import { nowIso, toIso } from './dates.js';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// Friendly versions of the Postgres constraint errors the server used to map.
export const conflict = (cols, vals) => new HttpError(409, `Already exists: Key (${cols})=(${vals}) already exists.`);
export const badRef = () => new HttpError(400, 'This record is referenced elsewhere and cannot be changed that way');
export const badRange = () => new HttpError(400, 'Value out of allowed range (quantities and prices cannot be negative)');
export const badValue = () => new HttpError(400, 'Invalid value supplied');

export const round2 = (n) => Math.round(n * 100) / 100;
export const pad = (n) => String(n).padStart(5, '0');
export const nextId = (db, table) => {
  db.seq[table] += 1;
  return db.seq[table];
};

/** Integer id from a route param or form value; anything else is an invalid value. */
export const toInt = (v) => {
  const n = Number(v);
  if (v === '' || v === null || v === undefined || !Number.isInteger(n)) throw badValue();
  return n;
};

/** Pull a strength such as 500mg, 4.5g, 40IU/ml or 5% out of an item name. */
export function guessStrength(name) {
  const m = /\d+(?:\.\d+)?\s?(?:(?:mg|mcg|g|ml|IU)(?:\/\d*\s?ml)?\b|%)/i.exec(name || '');
  return m ? m[0] : null;
}

export function recordMovement(db, { item_id, item_name, change, balance_after, type, reference, note, created_at }) {
  db.stock_movements.push({
    id: nextId(db, 'stock_movements'),
    item_id, item_name, change, balance_after, type,
    reference: reference || null,
    note: note || null,
    created_at: toIso(created_at),
  });
}

/** Increase or decrease one item's stock and log it. */
export function adjustStock(db, itemId, change, { type = 'ADJUSTMENT', reference, note } = {}) {
  const item = db.items.find((i) => i.id === Number(itemId));
  if (!item) throw new HttpError(404, 'Item not found');
  const next = item.quantity + change;
  if (next < 0) throw new HttpError(400, `Only ${item.quantity} in stock for "${item.name}"`);
  item.quantity = next;
  item.updated_at = nowIso();
  recordMovement(db, { item_id: item.id, item_name: item.name, change, balance_after: next, type, reference, note });
  return item;
}

/**
 * Create a bill (stock issue): validates stock for every line, decrements
 * inventory, logs movements. Throws 400 with per-line details on shortage.
 */
export function createBill(db, { department_id, requested_by, patient_ref, notes, discount = 0, items, created_at }) {
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'Add at least one item to the bill');

  // Merge duplicate lines
  const merged = new Map();
  for (const line of items) {
    const qty = parseInt(line.quantity, 10);
    if (!line.item_id || !Number.isFinite(qty) || qty <= 0) throw new HttpError(400, 'Every line needs an item and a quantity above 0');
    const id = Number(line.item_id);
    merged.set(id, (merged.get(id) || 0) + qty);
  }
  if (department_id && !db.departments.some((d) => d.id === Number(department_id))) throw badRef();

  const byId = new Map(db.items.filter((i) => merged.has(i.id)).map((i) => [i.id, i]));

  const shortages = [];
  for (const [id, qty] of merged) {
    const it = byId.get(id);
    if (!it) shortages.push({ item_id: id, name: 'Unknown item', requested: qty, available: 0 });
    else if (it.quantity < qty) shortages.push({ item_id: it.id, name: it.name, requested: qty, available: it.quantity });
  }
  if (shortages.length) throw new HttpError(400, 'Insufficient stock for some items', { shortages });

  let subtotal = 0;
  let taxTotal = 0;
  const lines = [];
  for (const [id, qty] of merged) {
    const it = byId.get(id);
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

  const billId = nextId(db, 'bills');
  const billNo = `SHPC-INV-${pad(billId)}`;
  const bill = {
    id: billId, bill_no: billNo, department_id: department_id ? Number(department_id) : null,
    requested_by: requested_by || null, patient_ref: patient_ref || null, notes: notes || null,
    subtotal, tax_total: taxTotal, discount: disc, total, status: 'COMPLETED',
    created_at: toIso(created_at), cancelled_at: null,
  };
  db.bills.push(bill);

  for (const { it, qty, tax, lineTotal } of lines) {
    db.bill_items.push({
      id: nextId(db, 'bill_items'), bill_id: billId, item_id: it.id, item_name: it.name, sku: it.sku, unit: it.unit,
      quantity: qty, unit_price: it.price, gst_rate: it.gst_rate, tax_amount: tax, line_total: lineTotal,
    });
    const balance = it.quantity - qty;
    it.quantity = balance;
    it.updated_at = nowIso();
    recordMovement(db, {
      item_id: it.id, item_name: it.name, change: -qty, balance_after: balance,
      type: 'ISSUE', reference: billNo, note: 'Issued against bill', created_at,
    });
  }
  return bill;
}

/** Cancel a bill and put its stock back. */
export function cancelBill(db, billId, reason) {
  const bill = db.bills.find((b) => b.id === Number(billId));
  if (!bill) throw new HttpError(404, 'Bill not found');
  if (bill.status === 'CANCELLED') throw new HttpError(400, 'Bill is already cancelled');

  const lines = db.bill_items.filter((l) => l.bill_id === bill.id).sort((a, b) => (a.item_id ?? 0) - (b.item_id ?? 0));
  for (const line of lines) {
    if (!line.item_id) continue; // item was deleted from the catalogue
    adjustStock(db, line.item_id, line.quantity, {
      type: 'ISSUE_CANCEL', reference: bill.bill_no, note: reason || 'Bill cancelled — stock returned',
    });
  }
  bill.status = 'CANCELLED';
  bill.cancelled_at = nowIso();
  bill.notes = `${bill.notes ? `${bill.notes}\n` : ''}Cancelled: ${reason || 'no reason given'}`;
  return bill;
}

export function createPurchaseOrder(db, { supplier_id, expected_date, notes, items, created_at, request_id }) {
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'Add at least one item to the purchase order');
  const byId = new Map(db.items.map((i) => [i.id, i]));

  const lines = items.map((l) => {
    const it = byId.get(Number(l.item_id));
    const qty = parseInt(l.quantity, 10);
    if (!it || !Number.isFinite(qty) || qty <= 0) throw new HttpError(400, 'Every line needs a valid item and a quantity above 0');
    const cost = l.unit_cost === undefined || l.unit_cost === '' ? it.price : Number(l.unit_cost);
    if (!Number.isFinite(cost) || cost < 0) throw new HttpError(400, `Invalid unit cost for "${it.name}"`);
    return { it, qty, cost, lineTotal: round2(qty * cost), request_item_id: l.request_item_id };
  });
  const total = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  if (supplier_id && !db.suppliers.some((s) => s.id === Number(supplier_id))) throw badRef();
  if (request_id && !db.requests.some((r) => r.id === Number(request_id))) throw badRef();

  const poId = nextId(db, 'purchase_orders');
  const po = {
    id: poId, po_no: `SHPC-PO-${pad(poId)}`, supplier_id: supplier_id ? Number(supplier_id) : null, status: 'PENDING',
    expected_date: expected_date || null, notes: notes || null, total, created_at: toIso(created_at), received_at: null,
    confirmed_at: null, dispatched_at: null, request_id: request_id ? Number(request_id) : null,
  };
  db.purchase_orders.push(po);
  for (const l of lines) {
    db.purchase_order_items.push({
      id: nextId(db, 'purchase_order_items'), po_id: poId, item_id: l.it.id, item_name: l.it.name,
      quantity: l.qty, unit_cost: l.cost, line_total: l.lineTotal,
    });
    if (l.request_item_id) {
      const ri = db.request_items.find((r) => r.id === Number(l.request_item_id));
      if (ri) ri.po_id = poId;
    }
  }
  return po;
}

export const OPEN_PO = ['PENDING', 'CONFIRMED', 'DISPATCHED'];

/** Mark a PO received and add its quantities to stock. */
export function receivePurchaseOrder(db, poId) {
  const po = db.purchase_orders.find((p) => p.id === Number(poId));
  if (!po) throw new HttpError(404, 'Purchase order not found');
  if (!OPEN_PO.includes(po.status)) throw new HttpError(400, `Purchase order is already ${po.status.toLowerCase()}`);
  const lines = db.purchase_order_items.filter((l) => l.po_id === po.id).sort((a, b) => (a.item_id ?? 0) - (b.item_id ?? 0));
  for (const l of lines) {
    if (!l.item_id) continue;
    adjustStock(db, l.item_id, l.quantity, { type: 'PURCHASE', reference: po.po_no, note: 'Goods received' });
  }
  po.status = 'RECEIVED';
  po.received_at = nowIso();
  return po;
}

/** Vendor confirmed (PENDING -> CONFIRMED) or goods dispatched (-> DISPATCHED). */
export function advancePurchaseOrder(db, poId, next) {
  const allowed = { CONFIRMED: ['PENDING'], DISPATCHED: ['PENDING', 'CONFIRMED'] }[next];
  const po = db.purchase_orders.find((p) => p.id === Number(poId));
  if (!po) throw new HttpError(404, 'Purchase order not found');
  if (!allowed.includes(po.status)) throw new HttpError(400, `Order is ${po.status.toLowerCase()} and cannot be moved to ${next.toLowerCase()}`);
  po.status = next;
  po.confirmed_at = po.confirmed_at || nowIso();
  if (next === 'DISPATCHED') po.dispatched_at = nowIso();
  return po;
}

/** Cancel an open PO. Request lines it covered go back to the request queue. */
export function cancelPurchaseOrder(db, poId) {
  const po = db.purchase_orders.find((p) => p.id === Number(poId));
  if (!po || !OPEN_PO.includes(po.status)) throw new HttpError(400, 'Only open purchase orders can be cancelled');
  po.status = 'CANCELLED';

  const freed = db.request_items.filter((ri) => ri.po_id === po.id);
  freed.forEach((ri) => { ri.po_id = null; });
  const requestIds = new Set(freed.map((ri) => ri.request_id));
  for (const r of db.requests) {
    if (!requestIds.has(r.id)) continue;
    if (r.status === 'ORDERED') {
      r.status = 'PENDING';
      r.ordered_at = null;
    }
    r.notes = `${r.notes ? `${r.notes} · ` : ''}Order ${po.po_no} was cancelled, choose a vendor again`;
  }
  return po;
}

/** A department asks for items. Brand, strength and unit are filled from the catalogue unless given. */
export function createRequest(db, { department_id, requested_by, priority, notes, items, created_at }) {
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'Add at least one item to the request');
  if (!department_id) throw new HttpError(400, 'Choose the department making the request');

  const catById = new Map(db.categories.map((c) => [c.id, c]));
  const ids = new Set(items.map((l) => Number(l.item_id)));
  const found = db.items.filter((i) => ids.has(i.id)).map((i) => {
    const c = catById.get(i.category_id);
    const g = c && c.parent_id != null ? catById.get(c.parent_id) : null;
    return { ...i, group_id: g ? g.id : null, group_name: g ? g.name : null };
  });

  // A department may only request items from its own product groups (e.g. only Pharmacy orders medicines)
  const dept = db.departments.find((d) => d.id === Number(department_id));
  if (!dept) throw new HttpError(400, 'Department not found');
  const groupIds = db.department_groups.filter((dg) => dg.department_id === dept.id).map((dg) => dg.category_id);
  const groups = groupIds.map((id) => catById.get(id)?.name).filter(Boolean).sort();
  const blocked = found.filter((it) => !groupIds.includes(it.group_id));
  if (blocked.length) {
    throw new HttpError(400, `${dept.name} cannot request ${blocked.map((b) => `"${b.name}" (${b.group_name})`).join(', ')}. `
      + (groups.length ? `It can request: ${groups.join(', ')}.` : 'No product groups are set for it yet (Vendors → Departments).'));
  }
  const byId = new Map(found.map((r) => [r.id, r]));
  const lines = items.map((l) => {
    const it = byId.get(Number(l.item_id));
    const qty = parseInt(l.quantity, 10);
    if (!it || !Number.isFinite(qty) || qty <= 0) throw new HttpError(400, 'Every line needs an item and a quantity above 0');
    return { it, qty, brand: l.brand?.trim() || it.manufacturer, strength: l.strength?.trim() || it.strength };
  });

  const id = nextId(db, 'requests');
  const request = {
    id, request_no: `SHPC-REQ-${pad(id)}`, department_id: dept.id, requested_by: requested_by || null,
    priority: priority === 'URGENT' ? 'URGENT' : 'NORMAL', notes: notes || null, status: 'PENDING',
    created_at: toIso(created_at), ordered_at: null,
  };
  db.requests.push(request);
  for (const l of lines) {
    db.request_items.push({
      id: nextId(db, 'request_items'), request_id: id, item_id: l.it.id, item_name: l.it.name,
      brand: l.brand ?? null, strength: l.strength ?? null, unit: l.it.unit, quantity: l.qty, po_id: null,
    });
  }
  return request;
}

/**
 * Turn a request into purchase orders: one PO per chosen vendor.
 * lines: [{ request_item_id, supplier_id, quantity, unit_cost }]; lines without a vendor are left for later.
 */
export function placeRequestOrder(db, requestId, { lines, expected_date, created_at }) {
  const req = db.requests.find((r) => r.id === Number(requestId));
  if (!req) throw new HttpError(404, 'Request not found');
  if (req.status !== 'PENDING') throw new HttpError(400, `Request is already ${req.status.toLowerCase()}`);
  const dept = db.departments.find((d) => d.id === req.department_id);

  const open = db.request_items.filter((r) => r.request_id === req.id && r.po_id == null);
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
    orders.push(createPurchaseOrder(db, {
      supplier_id: supplierId, expected_date, items, created_at, request_id: req.id,
      notes: `For ${req.request_no}${dept ? ` · ${dept.name}` : ''}`,
    }));
  }
  const remaining = db.request_items.filter((r) => r.request_id === req.id && r.po_id == null).length;
  if (remaining === 0) {
    req.status = 'ORDERED';
    req.ordered_at = toIso(created_at);
  }
  return { orders, remaining };
}
