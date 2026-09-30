// The REST API of the original Express server, reimplemented over the in-browser database.
// Every handler returns the same JSON shape the server returned.
import { getDb, transact } from './store.js';
import {
  HttpError, adjustStock, createBill, cancelBill, createPurchaseOrder, receivePurchaseOrder, advancePurchaseOrder,
  cancelPurchaseOrder, createRequest, placeRequestOrder, guessStrength, nextId, round2, toInt,
  conflict, badRef, badRange, OPEN_PO,
} from './services.js';
import { dateOf, diffDays, isoDate, nowIso, today } from './dates.js';

const blank = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : v);
const sum = (rows, fn) => rows.reduce((s, r) => s + fn(r), 0);
const has = (v, q) => String(v ?? '').toLowerCase().includes(q);
const byText = (a, b) => String(a).localeCompare(String(b));
// Postgres sorts NULL last on ascending order
const nullsLast = (v) => (v === null || v === undefined ? Number.POSITIVE_INFINITY : v);
const ratio = (i) => (i.reorder_level ? i.quantity / i.reorder_level : null);
const byRatio = (a, b) => nullsLast(ratio(a)) - nullsLast(ratio(b));

function required(body, fields) {
  const missing = fields.filter((f) => blank(body[f]) === null);
  if (missing.length) throw new HttpError(400, `Missing required field(s): ${missing.join(', ')}`);
}

const catOf = (db, id) => db.categories.find((c) => c.id === id);
const groupOf = (db, cat) => (cat && cat.parent_id != null ? catOf(db, cat.parent_id) : null);
const supplierOf = (db, id) => (id == null ? null : db.suppliers.find((s) => s.id === id));
const deptOf = (db, id) => (id == null ? null : db.departments.find((d) => d.id === id));

/* ---------------------------------------------------------------- Dashboard */

function dashboard() {
  const db = getDb();
  const items = db.items;
  const bills = db.bills.filter((b) => b.status === 'COMPLETED');
  const day = today();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const since30 = Date.now() - 30 * 864e5;
  const recent30 = bills.filter((b) => new Date(b.created_at).getTime() >= since30);
  const in90 = isoDate(90);
  const openPos = db.purchase_orders.filter((p) => OPEN_PO.includes(p.status));

  const billLines30 = recent30.flatMap((b) => db.bill_items.filter((l) => l.bill_id === b.id));

  const consumptionByGroup = db.categories.filter((g) => g.parent_id == null).map((g) => {
    const subIds = new Set(db.categories.filter((s) => s.parent_id === g.id).map((s) => s.id));
    const itemIds = new Set(items.filter((i) => subIds.has(i.category_id)).map((i) => i.id));
    return { id: g.id, name: g.name, value: round2(sum(billLines30.filter((l) => itemIds.has(l.item_id)), (l) => l.line_total)) };
  }).sort((a, b) => b.value - a.value);

  const daily = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = isoDate(-i);
    const dayBills = bills.filter((b) => dateOf(b.created_at) === d);
    daily.push({ day: d, value: round2(sum(dayBills, (b) => b.total)), bills: dayBills.length });
  }

  const deptTotals = new Map();
  for (const b of recent30) {
    const dp = deptOf(db, b.department_id);
    if (!dp) continue;
    const t = deptTotals.get(dp.name) || { name: dp.name, value: 0, bills: 0 };
    t.value += b.total;
    t.bills += 1;
    deptTotals.set(dp.name, t);
  }
  const departments = [...deptTotals.values()].map((t) => ({ ...t, value: round2(t.value) }))
    .sort((a, b) => b.value - a.value).slice(0, 8);

  const itemTotals = new Map();
  for (const l of billLines30) {
    const key = `${l.item_name}\u0000${l.unit}`;
    const t = itemTotals.get(key) || { name: l.item_name, unit: l.unit, qty: 0, value: 0 };
    t.qty += l.quantity;
    t.value += l.line_total;
    itemTotals.set(key, t);
  }
  const topItems = [...itemTotals.values()].map((t) => ({ ...t, value: round2(t.value) }))
    .sort((a, b) => b.value - a.value).slice(0, 8);

  const lowStock = items.filter((i) => i.quantity <= i.reorder_level)
    .sort((a, b) => byRatio(a, b) || a.quantity - b.quantity).slice(0, 10)
    .map((i) => ({ id: i.id, sku: i.sku, name: i.name, unit: i.unit, quantity: i.quantity, reorder_level: i.reorder_level, category: catOf(db, i.category_id)?.name }));

  const recentBills = [...db.bills].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6)
    .map((b) => ({ id: b.id, bill_no: b.bill_no, total: b.total, status: b.status, created_at: b.created_at, department: deptOf(db, b.department_id)?.name ?? null }));

  return {
    totals: {
      items: items.length,
      units: sum(items, (i) => i.quantity),
      stock_value: round2(sum(items, (i) => i.quantity * i.price)),
      out_of_stock: items.filter((i) => i.quantity === 0).length,
      low_stock: items.filter((i) => i.quantity > 0 && i.quantity <= i.reorder_level).length,
      expiring: items.filter((i) => i.expiry_date && i.expiry_date <= in90).length,
    },
    bills: {
      today_count: bills.filter((b) => dateOf(b.created_at) === day).length,
      today_value: round2(sum(bills.filter((b) => dateOf(b.created_at) === day), (b) => b.total)),
      month_value: round2(sum(bills.filter((b) => new Date(b.created_at).getTime() >= monthStart), (b) => b.total)),
      month_count: bills.filter((b) => new Date(b.created_at).getTime() >= monthStart).length,
    },
    purchaseOrders: { open_count: openPos.length, open_value: round2(sum(openPos, (p) => p.total)) },
    consumptionByGroup,
    daily,
    departments,
    topItems,
    lowStock,
    recentBills,
  };
}

/* --------------------------------------------------------------- Categories */

function listCategories() {
  const db = getDb();
  // parent_id NULLS FIRST: top-level groups, then their sub-categories
  return [...db.categories].sort((a, b) => (a.parent_id ?? -1) - (b.parent_id ?? -1) || a.id - b.id).map((c) => {
    const its = db.items.filter((i) => i.category_id === c.id);
    return { ...c, item_count: its.length, units: sum(its, (i) => i.quantity), stock_value: round2(sum(its, (i) => i.quantity * i.price)) };
  });
}

function categoryNameTaken(db, name, parentId, exceptId) {
  // UNIQUE (name, parent_id): NULL parents never collide
  return parentId != null && db.categories.some((c) => c.id !== exceptId && c.name === name && c.parent_id === parentId);
}

function createCategory({ body }) {
  required(body, ['name']);
  return transact((db) => {
    const name = body.name.trim();
    const parentId = blank(body.parent_id) === null ? null : toInt(body.parent_id);
    if (parentId !== null && !catOf(db, parentId)) throw badRef();
    if (categoryNameTaken(db, name, parentId, null)) throw conflict('name, parent_id', `${name}, ${parentId}`);
    const row = {
      id: nextId(db, 'categories'), name, parent_id: parentId, icon: blank(body.icon), description: blank(body.description), created_at: nowIso(),
    };
    db.categories.push(row);
    return row;
  });
}

function updateCategory({ params, body }) {
  required(body, ['name']);
  return transact((db) => {
    const row = catOf(db, toInt(params.id));
    if (!row) throw new HttpError(404, 'Category not found');
    const name = body.name.trim();
    if (categoryNameTaken(db, name, row.parent_id, row.id)) throw conflict('name, parent_id', `${name}, ${row.parent_id}`);
    row.name = name;
    row.icon = blank(body.icon);
    row.description = blank(body.description);
    return row;
  });
}

function deleteCategory({ params }) {
  return transact((db) => {
    const id = toInt(params.id);
    const ids = new Set(db.categories.filter((c) => c.id === id || c.parent_id === id).map((c) => c.id));
    const n = db.items.filter((i) => ids.has(i.category_id)).length;
    if (n > 0) throw new HttpError(400, `This category still has ${n} item(s). Move or delete them first.`);
    db.categories = db.categories.filter((c) => !ids.has(c.id));
    db.department_groups = db.department_groups.filter((g) => !ids.has(g.category_id));
    return null;
  });
}

/* -------------------------------------------------------------------- Items */

function itemView(db, i) {
  const c = catOf(db, i.category_id);
  const g = groupOf(db, c);
  const s = supplierOf(db, i.supplier_id);
  return { ...i, category_name: c?.name ?? null, group_id: c ? c.parent_id : null, group_name: g?.name ?? null, supplier_name: s?.name ?? null };
}

function listItems({ query }) {
  const db = getDb();
  const { q, category_id, status, supplier_id } = query;
  const ql = q ? q.toLowerCase() : null;
  const in90 = isoDate(90);
  return db.items.filter((i) => {
    const c = catOf(db, i.category_id);
    if (ql && !(has(i.name, ql) || has(i.sku, ql) || has(i.manufacturer, ql) || has(i.strength, ql))) return false;
    if (category_id && !(c.id === Number(category_id) || c.parent_id === Number(category_id))) return false;
    if (supplier_id && i.supplier_id !== Number(supplier_id)) return false;
    if (status === 'low' && !(i.quantity > 0 && i.quantity <= i.reorder_level)) return false;
    if (status === 'out' && i.quantity !== 0) return false;
    if (status === 'reorder' && !(i.quantity <= i.reorder_level)) return false;
    if (status === 'in' && !(i.quantity > i.reorder_level)) return false;
    if (status === 'expiring' && !(i.expiry_date && i.expiry_date <= in90)) return false;
    return true;
  }).map((i) => itemView(db, i)).sort((a, b) =>
    nullsLast(a.group_id) - nullsLast(b.group_id) || a.category_id - b.category_id || byText(a.name, b.name));
}

function getItem({ params }) {
  const db = getDb();
  const item = db.items.find((i) => i.id === toInt(params.id));
  if (!item) throw new HttpError(404, 'Item not found');
  const movements = db.stock_movements.filter((m) => m.item_id === item.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id).slice(0, 50);
  return { ...itemView(db, item), movements };
}

const ITEM_FIELDS = ['sku', 'name', 'category_id', 'supplier_id', 'unit', 'price', 'reorder_level', 'gst_rate',
  'manufacturer', 'strength', 'batch_no', 'expiry_date', 'location', 'description'];

function itemValues(body) {
  if (blank(body.strength) === null) body = { ...body, strength: guessStrength(body.name) };
  const price = Number(body.price);
  if (!Number.isFinite(price) || price < 0) throw new HttpError(400, 'Price must be 0 or more');
  const out = {};
  for (const f of ITEM_FIELDS) {
    if (f === 'price') out[f] = price;
    else if (f === 'reorder_level') out[f] = parseInt(body.reorder_level, 10) || 0;
    else if (f === 'gst_rate') out[f] = Number(body.gst_rate) || 0;
    else {
      const v = blank(typeof body[f] === 'string' ? body[f].trim() : body[f]);
      out[f] = (f === 'category_id' || f === 'supplier_id') && v !== null ? toInt(v) : v;
    }
  }
  if (out.reorder_level < 0) throw badRange();
  return out;
}

function checkItemRefs(db, v, exceptId) {
  if (!catOf(db, v.category_id)) throw badRef();
  if (v.supplier_id != null && !supplierOf(db, v.supplier_id)) throw badRef();
  if (db.items.some((i) => i.id !== exceptId && i.sku === v.sku)) throw conflict('sku', v.sku);
}

function nextSku(db, categoryId) {
  const c = catOf(db, Number(categoryId));
  const top = c ? (groupOf(db, c) || c) : null;
  const prefix = (top ? top.name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() : '') || 'ITM';
  let n = db.items.filter((i) => i.sku.startsWith(`${prefix}-`)).length + 1;
  for (;;) {
    const sku = `${prefix}-${String(n).padStart(4, '0')}`;
    if (!db.items.some((i) => i.sku === sku)) return sku;
    n += 1;
  }
}

function createItem({ body }) {
  required(body, ['name', 'category_id', 'unit']);
  return transact((db) => {
    const b = { ...body };
    if (blank(b.sku) === null) b.sku = nextSku(db, b.category_id);
    const openingQty = Math.max(parseInt(b.quantity, 10) || 0, 0);
    const v = itemValues(b);
    checkItemRefs(db, v, null);
    const stamp = nowIso();
    const row = { id: nextId(db, 'items'), ...v, quantity: 0, created_at: stamp, updated_at: stamp };
    db.items.push(row);
    if (openingQty > 0) return adjustStock(db, row.id, openingQty, { type: 'OPENING', note: 'Opening stock' });
    return row;
  });
}

function updateItem({ params, body }) {
  required(body, ['name', 'category_id', 'unit', 'sku']);
  return transact((db) => {
    const v = itemValues(body);
    const row = db.items.find((i) => i.id === toInt(params.id));
    if (!row) throw new HttpError(404, 'Item not found');
    checkItemRefs(db, v, row.id);
    Object.assign(row, v, { updated_at: nowIso() });
    return row;
  });
}

function setPrice({ params, body }) {
  return transact((db) => {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) throw new HttpError(400, 'Price must be 0 or more');
    const row = db.items.find((i) => i.id === toInt(params.id));
    if (!row) throw new HttpError(404, 'Item not found');
    row.price = price;
    row.updated_at = nowIso();
    return row;
  });
}

// Increase / decrease stock: { change: +5 | -3, note }  or  { set: 120, note }
function setStock({ params, body }) {
  return transact((db) => {
    const id = toInt(params.id);
    const item = db.items.find((i) => i.id === id);
    let change = parseInt(body.change, 10);
    if (body.set !== undefined) {
      const target = parseInt(body.set, 10);
      if (!Number.isFinite(target) || target < 0) throw new HttpError(400, 'Quantity must be 0 or more');
      if (!item) throw new HttpError(404, 'Item not found');
      change = target - item.quantity;
    }
    if (!Number.isFinite(change)) throw new HttpError(400, 'Provide a numeric change');
    if (!item) throw new HttpError(404, 'Item not found');
    if (change === 0) return item;
    return adjustStock(db, id, change, { type: 'ADJUSTMENT', note: blank(body.note) || 'Manual adjustment' });
  });
}

function deleteItem({ params }) {
  return transact((db) => {
    const id = toInt(params.id);
    if (!db.items.some((i) => i.id === id)) throw new HttpError(404, 'Item not found');
    db.items = db.items.filter((i) => i.id !== id);
    // ON DELETE SET NULL on everything that pointed at the item
    for (const t of ['stock_movements', 'bill_items', 'purchase_order_items', 'request_items']) {
      db[t].forEach((r) => { if (r.item_id === id) r.item_id = null; });
    }
    return null;
  });
}

/* ------------------------------------------------------ Suppliers & Depts */

/** Replace the product groups a department may request. Ignored when group_ids is not sent. */
function saveDepartmentGroups(db, departmentId, groupIds) {
  if (!Array.isArray(groupIds)) return;
  const wanted = new Set(groupIds.map(Number));
  db.department_groups = db.department_groups.filter((g) => g.department_id !== departmentId);
  for (const c of db.categories) {
    if (c.parent_id == null && wanted.has(c.id)) db.department_groups.push({ department_id: departmentId, category_id: c.id });
  }
}

function crud(table, fields, requiredFields) {
  const isDept = table === 'departments';
  const checkName = (db, name, exceptId) => {
    if (db[table].some((r) => r.id !== exceptId && r.name === name)) throw conflict('name', name);
  };
  return {
    list() {
      const db = getDb();
      return [...db[table]].sort((a, b) => byText(a.name, b.name)).map((t) => {
        if (!isDept) {
          return {
            ...t,
            item_count: db.items.filter((i) => i.supplier_id === t.id).length,
            po_count: db.purchase_orders.filter((p) => p.supplier_id === t.id).length,
          };
        }
        const done = db.bills.filter((b) => b.department_id === t.id && b.status === 'COMPLETED');
        return {
          ...t,
          bill_count: done.length,
          total_value: round2(sum(done, (b) => b.total)),
          group_ids: db.department_groups.filter((g) => g.department_id === t.id).map((g) => g.category_id).sort((a, b) => a - b),
        };
      });
    },
    create({ body }) {
      required(body, requiredFields);
      return transact((db) => {
        const vals = Object.fromEntries(fields.map((f) => [f, blank(body[f])]));
        checkName(db, vals.name, null);
        const row = { id: nextId(db, table), ...vals, created_at: nowIso() };
        db[table].push(row);
        if (isDept) saveDepartmentGroups(db, row.id, body.group_ids);
        return row;
      });
    },
    update({ params, body }) {
      required(body, requiredFields);
      return transact((db) => {
        const row = db[table].find((r) => r.id === toInt(params.id));
        if (!row) throw new HttpError(404, 'Record not found');
        const vals = Object.fromEntries(fields.map((f) => [f, blank(body[f])]));
        checkName(db, vals.name, row.id);
        Object.assign(row, vals);
        if (isDept) saveDepartmentGroups(db, row.id, body.group_ids);
        return row;
      });
    },
    remove({ params }) {
      return transact((db) => {
        const id = toInt(params.id);
        db[table] = db[table].filter((r) => r.id !== id);
        // ON DELETE SET NULL / CASCADE on everything that pointed at it
        if (isDept) {
          db.bills.forEach((b) => { if (b.department_id === id) b.department_id = null; });
          db.requests.forEach((r) => { if (r.department_id === id) r.department_id = null; });
          db.department_groups = db.department_groups.filter((g) => g.department_id !== id);
        } else {
          db.items.forEach((i) => { if (i.supplier_id === id) i.supplier_id = null; });
          db.purchase_orders.forEach((p) => { if (p.supplier_id === id) p.supplier_id = null; });
        }
        return null;
      });
    },
  };
}
const suppliers = crud('suppliers', ['name', 'contact_person', 'phone', 'email', 'address', 'gst_number'], ['name']);
const departments = crud('departments', ['name', 'head', 'location'], ['name']);

/* -------------------------------------------------------------------- Bills */

function listBills({ query }) {
  const db = getDb();
  const { q, department_id, status, from, to } = query;
  const ql = q ? q.toLowerCase() : null;
  return db.bills.filter((b) => {
    if (ql && !(has(b.bill_no, ql) || has(b.requested_by, ql) || has(b.patient_ref, ql))) return false;
    if (department_id && b.department_id !== Number(department_id)) return false;
    if (status && b.status !== status) return false;
    if (from && dateOf(b.created_at) < from) return false;
    if (to && dateOf(b.created_at) > to) return false;
    return true;
  }).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id).slice(0, 500).map((b) => ({
    ...b,
    department_name: deptOf(db, b.department_id)?.name ?? null,
    line_count: db.bill_items.filter((l) => l.bill_id === b.id).length,
  }));
}

function getBill({ params }) {
  const db = getDb();
  const b = db.bills.find((x) => x.id === toInt(params.id));
  if (!b) throw new HttpError(404, 'Bill not found');
  const d = deptOf(db, b.department_id);
  return {
    ...b,
    department_name: d?.name ?? null,
    department_location: d?.location ?? null,
    department_head: d?.head ?? null,
    items: db.bill_items.filter((l) => l.bill_id === b.id).sort((a, c) => a.id - c.id),
  };
}

/* ---------------------------------------------------------- Purchase orders */

// Open orders are sorted into one tracking bucket each, by how late they are against the expected date:
//   warning   = 1-9 days late, or due within 2 days and not yet on the way
//   delayed10 = 10-19 days late, delayed20 = 20+ days late
function poRow(db, p) {
  const s = supplierOf(db, p.supplier_id);
  const r = p.request_id == null ? null : db.requests.find((x) => x.id === p.request_id);
  const d = r ? deptOf(db, r.department_id) : null;
  const late = p.expected_date ? diffDays(today(), p.expected_date) : null;
  let delay = null;
  if (OPEN_PO.includes(p.status) && late !== null) {
    if (late >= 20) delay = 'delayed20';
    else if (late >= 10) delay = 'delayed10';
    else if (late >= 1) delay = 'warning';
    else if (late >= -2 && p.status !== 'DISPATCHED') delay = 'warning';
  }
  return {
    ...p,
    supplier_name: s?.name ?? null,
    supplier_phone: s?.phone ?? null,
    request_no: r?.request_no ?? null,
    department_name: d?.name ?? null,
    line_count: db.purchase_order_items.filter((x) => x.po_id === p.id).length,
    days_late: late,
    delay,
  };
}

function listPurchaseOrders({ query }) {
  const db = getDb();
  return db.purchase_orders
    .filter((p) => (query.status === 'OPEN' ? OPEN_PO.includes(p.status) : !query.status || p.status === query.status))
    .map((p) => poRow(db, p))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
}

// Home page: counts for every tracking tile plus all open orders
function tracker() {
  const db = getDb();
  // days_late DESC NULLS LAST, then newest first
  const late = (x) => (x.days_late === null ? Number.NEGATIVE_INFINITY : x.days_late);
  const o = db.purchase_orders.filter((p) => OPEN_PO.includes(p.status)).map((p) => poRow(db, p))
    .sort((a, b) => (late(a) === late(b) ? 0 : late(b) - late(a)) || b.created_at.localeCompare(a.created_at));
  const since = Date.now() - 30 * 864e5;
  const received = db.purchase_orders.filter((p) => p.status === 'RECEIVED' && p.received_at && new Date(p.received_at).getTime() >= since)
    .map((p) => poRow(db, p)).sort((a, b) => b.received_at.localeCompare(a.received_at));
  const pending = db.requests.filter((r) => r.status === 'PENDING');
  return {
    counts: {
      requests: pending.length,
      urgentRequests: pending.filter((r) => r.priority === 'URGENT').length,
      open: o.length,
      pending: o.filter((x) => x.status === 'PENDING').length,
      dispatched: o.filter((x) => x.status === 'DISPATCHED').length,
      warning: o.filter((x) => x.delay === 'warning').length,
      delayed10: o.filter((x) => x.delay === 'delayed10').length,
      delayed20: o.filter((x) => x.delay === 'delayed20').length,
      received: received.length,
    },
    orders: o,
    received,
  };
}

function getPurchaseOrder({ params }) {
  const db = getDb();
  const p = db.purchase_orders.find((x) => x.id === toInt(params.id));
  if (!p) throw new HttpError(404, 'Purchase order not found');
  const s = supplierOf(db, p.supplier_id);
  const r = p.request_id == null ? null : db.requests.find((x) => x.id === p.request_id);
  const d = r ? deptOf(db, r.department_id) : null;
  return {
    ...p,
    supplier_name: s?.name ?? null,
    supplier_address: s?.address ?? null,
    supplier_phone: s?.phone ?? null,
    supplier_email: s?.email ?? null,
    supplier_gst: s?.gst_number ?? null,
    supplier_contact: s?.contact_person ?? null,
    request_no: r?.request_no ?? null,
    department_name: d?.name ?? null,
    items: db.purchase_order_items.filter((x) => x.po_id === p.id).sort((a, b) => a.id - b.id).map((x) => {
      const it = db.items.find((i) => i.id === x.item_id);
      return { ...x, sku: it?.sku ?? null, unit: it?.unit ?? null };
    }),
  };
}

/** Vendors who have supplied each item before, with their last price: Map(item_id -> [{ supplier_id, orders, last_cost }]) */
function vendorHistory(db, itemIds) {
  const wanted = new Set(itemIds);
  const pos = db.purchase_orders.filter((p) => p.status !== 'CANCELLED' && p.supplier_id != null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id); // newest first
  const acc = new Map(); // item_id -> Map(supplier_id -> { orders, last_cost })
  for (const p of pos) {
    for (const x of db.purchase_order_items) {
      if (x.po_id !== p.id || !wanted.has(x.item_id)) continue;
      if (!acc.has(x.item_id)) acc.set(x.item_id, new Map());
      const per = acc.get(x.item_id);
      const cur = per.get(p.supplier_id);
      if (cur) cur.orders += 1;
      else per.set(p.supplier_id, { supplier_id: p.supplier_id, orders: 1, last_cost: x.unit_cost });
    }
  }
  const byItem = new Map();
  for (const [itemId, per] of acc) byItem.set(itemId, [...per.values()].sort((a, b) => a.supplier_id - b.supplier_id));
  return byItem;
}

/* ------------------------------------------------------------------ Restock */

// Every item with its stock level, quantity already on open orders, and past vendors
function restock() {
  const db = getDb();
  const openIds = new Set(db.purchase_orders.filter((p) => OPEN_PO.includes(p.status)).map((p) => p.id));
  const onOrder = new Map();
  for (const x of db.purchase_order_items) {
    if (openIds.has(x.po_id)) onOrder.set(x.item_id, (onOrder.get(x.item_id) || 0) + x.quantity);
  }
  const history = vendorHistory(db, db.items.map((i) => i.id));
  return [...db.items].sort((a, b) => byRatio(a, b) || byText(a.name, b.name)).map((i) => {
    const c = catOf(db, i.category_id);
    const g = groupOf(db, c);
    return {
      id: i.id, sku: i.sku, name: i.name, unit: i.unit, quantity: i.quantity, reorder_level: i.reorder_level, price: i.price,
      manufacturer: i.manufacturer, strength: i.strength, supplier_id: i.supplier_id,
      category_name: c?.name ?? null, group_id: g?.id ?? null, group_name: g?.name ?? null,
      on_order: onOrder.get(i.id) || 0,
      vendors: history.get(i.id) || [],
    };
  });
}

// lines: [{ item_id, supplier_id, quantity, unit_cost }] -> one purchase order per vendor
function restockOrder({ body }) {
  const { lines, expected_date } = body;
  const bySupplier = new Map();
  for (const l of lines || []) {
    const sid = Number(l.supplier_id);
    if (!sid) throw new HttpError(400, 'Choose a vendor for every selected item');
    if (!bySupplier.has(sid)) bySupplier.set(sid, []);
    bySupplier.get(sid).push(l);
  }
  if (!bySupplier.size) throw new HttpError(400, 'Select at least one item to restock');
  return transact((db) => {
    const orders = [];
    for (const [sid, items] of bySupplier) {
      orders.push(createPurchaseOrder(db, { supplier_id: sid, items, expected_date, notes: 'Restock' }));
    }
    return { orders };
  });
}

/* ----------------------------------------------------------------- Requests */

function requestsSummary() {
  return { pending: getDb().requests.filter((r) => r.status === 'PENDING').length };
}

function listRequests({ query }) {
  const db = getDb();
  const reqs = db.requests.filter((r) => !query.status || r.status === query.status)
    .sort((a, b) => Number(b.status === 'PENDING') - Number(a.status === 'PENDING')
      || Number(b.priority === 'URGENT') - Number(a.priority === 'URGENT')
      || b.created_at.localeCompare(a.created_at) || b.id - a.id)
    .slice(0, 200);
  const ids = new Set(reqs.map((r) => r.id));
  const lines = db.request_items.filter((l) => ids.has(l.request_id)).sort((a, b) => a.id - b.id);
  const vendorsByItem = vendorHistory(db, [...new Set(lines.map((l) => l.item_id).filter(Boolean))]);
  return reqs.map((r) => ({
    ...r,
    department_name: deptOf(db, r.department_id)?.name ?? null,
    items: lines.filter((l) => l.request_id === r.id).map((l) => {
      const it = db.items.find((i) => i.id === l.item_id);
      const p = l.po_id == null ? null : db.purchase_orders.find((x) => x.id === l.po_id);
      const s = p ? supplierOf(db, p.supplier_id) : null;
      return {
        ...l,
        sku: it?.sku ?? null, in_stock: it?.quantity ?? null, price: it?.price ?? null, default_supplier_id: it?.supplier_id ?? null,
        po_no: p?.po_no ?? null, po_status: p?.status ?? null, po_supplier: s?.name ?? null,
        vendors: vendorsByItem.get(l.item_id) || [],
      };
    }),
  }));
}

function cancelRequest({ params }) {
  return transact((db) => {
    const r = db.requests.find((x) => x.id === toInt(params.id));
    if (!r || r.status !== 'PENDING') throw new HttpError(400, 'Only pending requests can be cancelled');
    r.status = 'CANCELLED';
    return r;
  });
}

/* ---------------------------------------------------------- Stock ledger */

function listMovements({ query }) {
  const db = getDb();
  const ql = query.q ? query.q.toLowerCase() : null;
  const limit = Math.min(parseInt(query.limit, 10) || 300, 2000);
  return db.stock_movements.filter((m) => {
    if (query.type && m.type !== query.type) return false;
    if (query.item_id && m.item_id !== Number(query.item_id)) return false;
    if (ql && !(has(m.item_name, ql) || has(m.reference, ql))) return false;
    return true;
  }).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id).slice(0, limit).map((m) => {
    const it = db.items.find((i) => i.id === m.item_id);
    return { ...m, sku: it?.sku ?? null, unit: it?.unit ?? null };
  });
}

/* ------------------------------------------------------------------- Router */

const routes = [];
function add(method, path, handler) {
  const keys = [];
  const re = new RegExp(`^${path.replace(/:(\w+)/g, (_m, k) => { keys.push(k); return '([^/]+)'; })}$`);
  routes.push({ method, re, keys, handler });
}

add('GET', '/dashboard', dashboard);
add('GET', '/categories', listCategories);
add('POST', '/categories', createCategory);
add('PUT', '/categories/:id', updateCategory);
add('DELETE', '/categories/:id', deleteCategory);
add('GET', '/items', listItems);
add('GET', '/items/:id', getItem);
add('POST', '/items', createItem);
add('PUT', '/items/:id', updateItem);
add('PATCH', '/items/:id/price', setPrice);
add('PATCH', '/items/:id/stock', setStock);
add('DELETE', '/items/:id', deleteItem);
for (const [name, c] of [['suppliers', suppliers], ['departments', departments]]) {
  add('GET', `/${name}`, c.list);
  add('POST', `/${name}`, c.create);
  add('PUT', `/${name}/:id`, c.update);
  add('DELETE', `/${name}/:id`, c.remove);
}
add('GET', '/bills', listBills);
add('GET', '/bills/:id', getBill);
add('POST', '/bills', ({ body }) => transact((db) => createBill(db, body)));
add('POST', '/bills/:id/cancel', ({ params, body }) => transact((db) => cancelBill(db, toInt(params.id), blank(body?.reason))));
add('GET', '/purchase-orders', listPurchaseOrders);
add('GET', '/tracker', tracker);
add('GET', '/purchase-orders/:id', getPurchaseOrder);
add('POST', '/purchase-orders', ({ body }) => transact((db) => createPurchaseOrder(db, body)));
add('POST', '/purchase-orders/:id/receive', ({ params }) => transact((db) => receivePurchaseOrder(db, toInt(params.id))));
add('POST', '/purchase-orders/:id/confirm', ({ params }) => transact((db) => advancePurchaseOrder(db, toInt(params.id), 'CONFIRMED')));
add('POST', '/purchase-orders/:id/dispatch', ({ params }) => transact((db) => advancePurchaseOrder(db, toInt(params.id), 'DISPATCHED')));
add('POST', '/purchase-orders/:id/cancel', ({ params }) => transact((db) => cancelPurchaseOrder(db, toInt(params.id))));
add('GET', '/restock', restock);
add('POST', '/restock/order', restockOrder);
add('GET', '/requests/summary', requestsSummary);
add('GET', '/requests', listRequests);
add('POST', '/requests', ({ body }) => transact((db) => createRequest(db, body)));
add('POST', '/requests/:id/order', ({ params, body }) => transact((db) => placeRequestOrder(db, toInt(params.id), body)));
add('POST', '/requests/:id/cancel', cancelRequest);
add('GET', '/movements', listMovements);

/** Run one request against the in-browser API. Throws HttpError for anything the server would have rejected. */
export function dispatch(method, path, query, body) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(path);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    return r.handler({ params, query, body });
  }
  throw new HttpError(404, 'Not found');
}

