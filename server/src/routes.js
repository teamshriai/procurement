import { Router } from 'express';
import { query, withTransaction } from './db.js';
import {
  HttpError, adjustStock, createBill, cancelBill, createPurchaseOrder, receivePurchaseOrder,
  advancePurchaseOrder, cancelPurchaseOrder, createRequest, placeRequestOrder, guessStrength,
} from './services.js';

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const blank = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : v);

function required(body, fields) {
  const missing = fields.filter((f) => blank(body[f]) === null);
  if (missing.length) throw new HttpError(400, `Missing required field(s): ${missing.join(', ')}`);
}

/* ---------------------------------------------------------------- Dashboard */

router.get('/dashboard', wrap(async (_req, res) => {
  const [totals, bills, pos, byGroup, daily, depts, topItems, lowStock, recent] = await Promise.all([
    query(`SELECT count(*) AS items,
                  COALESCE(sum(quantity),0) AS units,
                  COALESCE(sum(quantity * price),0) AS stock_value,
                  count(*) FILTER (WHERE quantity = 0) AS out_of_stock,
                  count(*) FILTER (WHERE quantity > 0 AND quantity <= reorder_level) AS low_stock,
                  count(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date <= current_date + 90) AS expiring
             FROM items`),
    query(`SELECT count(*) FILTER (WHERE created_at::date = current_date) AS today_count,
                  COALESCE(sum(total) FILTER (WHERE created_at::date = current_date),0) AS today_value,
                  COALESCE(sum(total) FILTER (WHERE created_at >= date_trunc('month', now())),0) AS month_value,
                  count(*) FILTER (WHERE created_at >= date_trunc('month', now())) AS month_count
             FROM bills WHERE status = 'COMPLETED'`),
    query(`SELECT count(*) AS open_count, COALESCE(sum(total),0) AS open_value
             FROM purchase_orders WHERE status IN ('PENDING','CONFIRMED','DISPATCHED')`),
    query(`SELECT g.id, g.name, COALESCE(sum(bi.line_total),0) AS value
             FROM categories g
             LEFT JOIN categories s ON s.parent_id = g.id
             LEFT JOIN items i ON i.category_id = s.id
             LEFT JOIN (SELECT bi.item_id, bi.line_total FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
                         WHERE b.status = 'COMPLETED' AND b.created_at >= now() - interval '30 days') bi ON bi.item_id = i.id
            WHERE g.parent_id IS NULL
            GROUP BY g.id, g.name ORDER BY value DESC`),
    query(`SELECT d::date AS day, COALESCE(sum(b.total),0) AS value, count(b.id) AS bills
             FROM generate_series(current_date - 13, current_date, interval '1 day') d
             LEFT JOIN bills b ON b.created_at::date = d::date AND b.status = 'COMPLETED'
            GROUP BY d ORDER BY d`),
    query(`SELECT dp.name, sum(b.total) AS value, count(*) AS bills
             FROM bills b JOIN departments dp ON dp.id = b.department_id
            WHERE b.status = 'COMPLETED' AND b.created_at >= now() - interval '30 days'
            GROUP BY dp.name ORDER BY value DESC LIMIT 8`),
    query(`SELECT bi.item_name AS name, bi.unit, sum(bi.quantity) AS qty, sum(bi.line_total) AS value
             FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
            WHERE b.status = 'COMPLETED' AND b.created_at >= now() - interval '30 days'
            GROUP BY bi.item_name, bi.unit ORDER BY value DESC LIMIT 8`),
    query(`SELECT i.id, i.sku, i.name, i.unit, i.quantity, i.reorder_level, c.name AS category
             FROM items i JOIN categories c ON c.id = i.category_id
            WHERE i.quantity <= i.reorder_level
            ORDER BY (i.quantity::float / NULLIF(i.reorder_level,0)) NULLS LAST, i.quantity LIMIT 10`),
    query(`SELECT b.id, b.bill_no, b.total, b.status, b.created_at, d.name AS department
             FROM bills b LEFT JOIN departments d ON d.id = b.department_id
            ORDER BY b.created_at DESC LIMIT 6`),
  ]);
  res.json({
    totals: totals.rows[0],
    bills: bills.rows[0],
    purchaseOrders: pos.rows[0],
    consumptionByGroup: byGroup.rows,
    daily: daily.rows,
    departments: depts.rows,
    topItems: topItems.rows,
    lowStock: lowStock.rows,
    recentBills: recent.rows,
  });
}));

/* --------------------------------------------------------------- Categories */

router.get('/categories', wrap(async (_req, res) => {
  const { rows } = await query(`
    SELECT c.*, COALESCE(x.item_count,0) AS item_count, COALESCE(x.units,0) AS units, COALESCE(x.value,0) AS stock_value
      FROM categories c
      LEFT JOIN (SELECT category_id, count(*) AS item_count, sum(quantity) AS units, sum(quantity*price) AS value
                   FROM items GROUP BY category_id) x ON x.category_id = c.id
     ORDER BY c.parent_id NULLS FIRST, c.id`);
  res.json(rows);
}));

router.post('/categories', wrap(async (req, res) => {
  required(req.body, ['name']);
  const { name, parent_id, icon, description } = req.body;
  const { rows } = await query(
    'INSERT INTO categories (name, parent_id, icon, description) VALUES ($1,$2,$3,$4) RETURNING *',
    [name.trim(), blank(parent_id), blank(icon), blank(description)]
  );
  res.status(201).json(rows[0]);
}));

router.put('/categories/:id', wrap(async (req, res) => {
  required(req.body, ['name']);
  const { name, icon, description } = req.body;
  const { rows } = await query(
    'UPDATE categories SET name=$1, icon=$2, description=$3 WHERE id=$4 RETURNING *',
    [name.trim(), blank(icon), blank(description), req.params.id]
  );
  if (!rows[0]) throw new HttpError(404, 'Category not found');
  res.json(rows[0]);
}));

router.delete('/categories/:id', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT count(*) AS n FROM items i JOIN categories c ON c.id = i.category_id
      WHERE c.id = $1 OR c.parent_id = $1`, [req.params.id]);
  if (rows[0].n > 0) throw new HttpError(400, `This category still has ${rows[0].n} item(s). Move or delete them first.`);
  await query('DELETE FROM categories WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));

/* -------------------------------------------------------------------- Items */

const ITEM_SELECT = `
  SELECT i.*, c.name AS category_name, c.parent_id AS group_id, g.name AS group_name, s.name AS supplier_name
    FROM items i
    JOIN categories c ON c.id = i.category_id
    LEFT JOIN categories g ON g.id = c.parent_id
    LEFT JOIN suppliers s ON s.id = i.supplier_id`;

router.get('/items', wrap(async (req, res) => {
  const where = [];
  const params = [];
  const { q, category_id, status, supplier_id } = req.query;
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(`(lower(i.name) LIKE $${params.length} OR lower(i.sku) LIKE $${params.length} OR lower(COALESCE(i.manufacturer,'')) LIKE $${params.length} OR lower(COALESCE(i.strength,'')) LIKE $${params.length})`);
  }
  if (category_id) {
    params.push(category_id);
    where.push(`(c.id = $${params.length} OR c.parent_id = $${params.length})`);
  }
  if (supplier_id) {
    params.push(supplier_id);
    where.push(`i.supplier_id = $${params.length}`);
  }
  if (status === 'low') where.push('i.quantity > 0 AND i.quantity <= i.reorder_level');
  if (status === 'out') where.push('i.quantity = 0');
  if (status === 'reorder') where.push('i.quantity <= i.reorder_level');
  if (status === 'in') where.push('i.quantity > i.reorder_level');
  if (status === 'expiring') where.push('i.expiry_date IS NOT NULL AND i.expiry_date <= current_date + 90');
  const sql = `${ITEM_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY g.id, c.id, i.name`;
  const { rows } = await query(sql, params);
  res.json(rows);
}));

router.get('/items/:id', wrap(async (req, res) => {
  const { rows } = await query(`${ITEM_SELECT} WHERE i.id = $1`, [req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'Item not found');
  const { rows: movements } = await query(
    'SELECT * FROM stock_movements WHERE item_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50', [req.params.id]);
  res.json({ ...rows[0], movements });
}));

const ITEM_FIELDS = ['sku', 'name', 'category_id', 'supplier_id', 'unit', 'price', 'reorder_level', 'gst_rate',
  'manufacturer', 'strength', 'batch_no', 'expiry_date', 'location', 'description'];

function itemValues(body) {
  if (blank(body.strength) === null) body = { ...body, strength: guessStrength(body.name) };
  const price = Number(body.price);
  if (!Number.isFinite(price) || price < 0) throw new HttpError(400, 'Price must be 0 or more');
  return ITEM_FIELDS.map((f) => {
    if (f === 'price') return price;
    if (f === 'reorder_level') return parseInt(body.reorder_level, 10) || 0;
    if (f === 'gst_rate') return Number(body.gst_rate) || 0;
    return blank(typeof body[f] === 'string' ? body[f].trim() : body[f]);
  });
}

async function nextSku(categoryId) {
  const { rows } = await query(
    `SELECT upper(left(regexp_replace(COALESCE(g.name, c.name), '[^A-Za-z]', '', 'g'), 3)) AS prefix
       FROM categories c LEFT JOIN categories g ON g.id = c.parent_id WHERE c.id = $1`, [categoryId]);
  const prefix = rows[0]?.prefix || 'ITM';
  const { rows: r2 } = await query(`SELECT count(*) AS n FROM items WHERE sku LIKE $1`, [`${prefix}-%`]);
  let n = r2[0].n + 1;
  for (;;) {
    const sku = `${prefix}-${String(n).padStart(4, '0')}`;
    const { rows: ex } = await query('SELECT 1 FROM items WHERE sku = $1', [sku]);
    if (!ex.length) return sku;
    n += 1;
  }
}

router.post('/items', wrap(async (req, res) => {
  required(req.body, ['name', 'category_id', 'unit']);
  const body = { ...req.body };
  if (blank(body.sku) === null) body.sku = await nextSku(body.category_id);
  const openingQty = Math.max(parseInt(body.quantity, 10) || 0, 0);
  const item = await withTransaction(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO items (${ITEM_FIELDS.join(',')}, quantity)
       VALUES (${ITEM_FIELDS.map((_, i) => `$${i + 1}`).join(',')}, 0) RETURNING *`,
      itemValues(body)
    );
    if (openingQty > 0) return adjustStock(c, rows[0].id, openingQty, { type: 'OPENING', note: 'Opening stock' });
    return rows[0];
  });
  res.status(201).json(item);
}));

router.put('/items/:id', wrap(async (req, res) => {
  required(req.body, ['name', 'category_id', 'unit', 'sku']);
  const vals = itemValues(req.body);
  const { rows } = await query(
    `UPDATE items SET ${ITEM_FIELDS.map((f, i) => `${f} = $${i + 1}`).join(', ')}, updated_at = now()
      WHERE id = $${ITEM_FIELDS.length + 1} RETURNING *`,
    [...vals, req.params.id]
  );
  if (!rows[0]) throw new HttpError(404, 'Item not found');
  res.json(rows[0]);
}));

// Quick price change
router.patch('/items/:id/price', wrap(async (req, res) => {
  const price = Number(req.body.price);
  if (!Number.isFinite(price) || price < 0) throw new HttpError(400, 'Price must be 0 or more');
  const { rows } = await query('UPDATE items SET price = $1, updated_at = now() WHERE id = $2 RETURNING *', [price, req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'Item not found');
  res.json(rows[0]);
}));

// Increase / decrease stock: { change: +5 | -3, note }  or  { set: 120, note }
router.patch('/items/:id/stock', wrap(async (req, res) => {
  const item = await withTransaction(async (c) => {
    let change = parseInt(req.body.change, 10);
    if (req.body.set !== undefined) {
      const target = parseInt(req.body.set, 10);
      if (!Number.isFinite(target) || target < 0) throw new HttpError(400, 'Quantity must be 0 or more');
      const { rows } = await c.query('SELECT quantity FROM items WHERE id = $1', [req.params.id]);
      if (!rows[0]) throw new HttpError(404, 'Item not found');
      change = target - rows[0].quantity;
    }
    if (!Number.isFinite(change)) throw new HttpError(400, 'Provide a numeric change');
    if (change === 0) {
      const { rows } = await c.query('SELECT * FROM items WHERE id = $1', [req.params.id]);
      return rows[0];
    }
    return adjustStock(c, req.params.id, change, { type: 'ADJUSTMENT', note: blank(req.body.note) || 'Manual adjustment' });
  });
  res.json(item);
}));

router.delete('/items/:id', wrap(async (req, res) => {
  const { rowCount } = await query('DELETE FROM items WHERE id = $1', [req.params.id]);
  if (!rowCount) throw new HttpError(404, 'Item not found');
  res.status(204).end();
}));

/* ------------------------------------------------------ Suppliers & Depts */

/** Replace the product groups a department may request. Ignored when group_ids is not sent. */
async function saveDepartmentGroups(departmentId, groupIds) {
  if (!Array.isArray(groupIds)) return;
  await withTransaction(async (c) => {
    await c.query('DELETE FROM department_groups WHERE department_id = $1', [departmentId]);
    await c.query(
      `INSERT INTO department_groups (department_id, category_id)
       SELECT $1, id FROM categories WHERE parent_id IS NULL AND id = ANY($2::int[])`,
      [departmentId, groupIds.map(Number)]);
  });
}

function crud(table, fields, requiredFields) {
  router.get(`/${table}`, wrap(async (_req, res) => {
    const extra = table === 'suppliers'
      ? `, (SELECT count(*) FROM items i WHERE i.supplier_id = t.id) AS item_count,
           (SELECT count(*) FROM purchase_orders p WHERE p.supplier_id = t.id) AS po_count`
      : `, (SELECT count(*) FROM bills b WHERE b.department_id = t.id AND b.status='COMPLETED') AS bill_count,
           (SELECT COALESCE(sum(total),0) FROM bills b WHERE b.department_id = t.id AND b.status='COMPLETED') AS total_value,
           COALESCE((SELECT array_agg(category_id ORDER BY category_id) FROM department_groups g WHERE g.department_id = t.id), '{}') AS group_ids`;
    const { rows } = await query(`SELECT t.* ${extra} FROM ${table} t ORDER BY t.name`);
    res.json(rows);
  }));
  router.post(`/${table}`, wrap(async (req, res) => {
    required(req.body, requiredFields);
    const { rows } = await query(
      `INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
      fields.map((f) => blank(req.body[f]))
    );
    if (table === 'departments') await saveDepartmentGroups(rows[0].id, req.body.group_ids);
    res.status(201).json(rows[0]);
  }));
  router.put(`/${table}/:id`, wrap(async (req, res) => {
    required(req.body, requiredFields);
    const { rows } = await query(
      `UPDATE ${table} SET ${fields.map((f, i) => `${f}=$${i + 1}`).join(', ')} WHERE id=$${fields.length + 1} RETURNING *`,
      [...fields.map((f) => blank(req.body[f])), req.params.id]
    );
    if (!rows[0]) throw new HttpError(404, 'Record not found');
    if (table === 'departments') await saveDepartmentGroups(rows[0].id, req.body.group_ids);
    res.json(rows[0]);
  }));
  router.delete(`/${table}/:id`, wrap(async (req, res) => {
    await query(`DELETE FROM ${table} WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  }));
}
crud('suppliers', ['name', 'contact_person', 'phone', 'email', 'address', 'gst_number'], ['name']);
crud('departments', ['name', 'head', 'location'], ['name']);

/* -------------------------------------------------------------------- Bills */

router.get('/bills', wrap(async (req, res) => {
  const where = [];
  const params = [];
  const { q, department_id, status, from, to } = req.query;
  if (q) { params.push(`%${q.toLowerCase()}%`); where.push(`(lower(b.bill_no) LIKE $${params.length} OR lower(COALESCE(b.requested_by,'')) LIKE $${params.length} OR lower(COALESCE(b.patient_ref,'')) LIKE $${params.length})`); }
  if (department_id) { params.push(department_id); where.push(`b.department_id = $${params.length}`); }
  if (status) { params.push(status); where.push(`b.status = $${params.length}`); }
  if (from) { params.push(from); where.push(`b.created_at::date >= $${params.length}`); }
  if (to) { params.push(to); where.push(`b.created_at::date <= $${params.length}`); }
  const { rows } = await query(
    `SELECT b.*, d.name AS department_name,
            (SELECT count(*) FROM bill_items bi WHERE bi.bill_id = b.id) AS line_count
       FROM bills b LEFT JOIN departments d ON d.id = b.department_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY b.created_at DESC LIMIT 500`, params);
  res.json(rows);
}));

router.get('/bills/:id', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT b.*, d.name AS department_name, d.location AS department_location, d.head AS department_head
       FROM bills b LEFT JOIN departments d ON d.id = b.department_id WHERE b.id = $1`, [req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'Bill not found');
  const { rows: items } = await query('SELECT * FROM bill_items WHERE bill_id = $1 ORDER BY id', [req.params.id]);
  res.json({ ...rows[0], items });
}));

router.post('/bills', wrap(async (req, res) => {
  const bill = await withTransaction((c) => createBill(c, req.body));
  res.status(201).json(bill);
}));

router.post('/bills/:id/cancel', wrap(async (req, res) => {
  const bill = await withTransaction((c) => cancelBill(c, req.params.id, blank(req.body?.reason)));
  res.json(bill);
}));

/* ---------------------------------------------------------- Purchase orders */

// Open orders are sorted into one tracking bucket each, by how late they are against the expected date:
//   warning   = 1-9 days late, or due within 2 days and not yet on the way
//   delayed10 = 10-19 days late, delayed20 = 20+ days late
const PO_SELECT = `
  SELECT p.*, s.name AS supplier_name, s.phone AS supplier_phone, r.request_no, d.name AS department_name,
         (SELECT count(*) FROM purchase_order_items x WHERE x.po_id = p.id) AS line_count,
         CASE WHEN p.expected_date IS NULL THEN NULL ELSE current_date - p.expected_date END AS days_late,
         CASE
           WHEN p.status NOT IN ('PENDING','CONFIRMED','DISPATCHED') OR p.expected_date IS NULL THEN NULL
           WHEN current_date - p.expected_date >= 20 THEN 'delayed20'
           WHEN current_date - p.expected_date >= 10 THEN 'delayed10'
           WHEN current_date - p.expected_date >= 1 THEN 'warning'
           WHEN current_date - p.expected_date >= -2 AND p.status <> 'DISPATCHED' THEN 'warning'
         END AS delay
    FROM purchase_orders p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN requests r ON r.id = p.request_id
    LEFT JOIN departments d ON d.id = r.department_id`;

router.get('/purchase-orders', wrap(async (req, res) => {
  const params = [];
  let where = '';
  if (req.query.status === 'OPEN') where = "WHERE p.status IN ('PENDING','CONFIRMED','DISPATCHED')";
  else if (req.query.status) { params.push(req.query.status); where = 'WHERE p.status = $1'; }
  const { rows } = await query(`${PO_SELECT} ${where} ORDER BY p.created_at DESC`, params);
  res.json(rows);
}));

// Home page: counts for every tracking tile plus all open orders
router.get('/tracker', wrap(async (_req, res) => {
  const [orders, reqs, received] = await Promise.all([
    query(`SELECT * FROM (${PO_SELECT} WHERE p.status IN ('PENDING','CONFIRMED','DISPATCHED')) o
            ORDER BY o.days_late DESC NULLS LAST, o.created_at DESC`),
    query(`SELECT count(*) AS n, count(*) FILTER (WHERE priority = 'URGENT') AS urgent
             FROM requests WHERE status = 'PENDING'`),
    query(`${PO_SELECT} WHERE p.status = 'RECEIVED' AND p.received_at >= now() - interval '30 days'
            ORDER BY p.received_at DESC`),
  ]);
  const o = orders.rows;
  const counts = {
    requests: reqs.rows[0].n,
    urgentRequests: reqs.rows[0].urgent,
    open: o.length,
    pending: o.filter((x) => x.status === 'PENDING').length,
    dispatched: o.filter((x) => x.status === 'DISPATCHED').length,
    warning: o.filter((x) => x.delay === 'warning').length,
    delayed10: o.filter((x) => x.delay === 'delayed10').length,
    delayed20: o.filter((x) => x.delay === 'delayed20').length,
    received: received.rows.length,
  };
  res.json({ counts, orders: o, received: received.rows });
}));

router.get('/purchase-orders/:id', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT p.*, s.name AS supplier_name, s.address AS supplier_address, s.phone AS supplier_phone,
            s.email AS supplier_email, s.gst_number AS supplier_gst, s.contact_person AS supplier_contact,
            r.request_no, d.name AS department_name
       FROM purchase_orders p LEFT JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN requests r ON r.id = p.request_id LEFT JOIN departments d ON d.id = r.department_id
      WHERE p.id = $1`, [req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'Purchase order not found');
  const { rows: items } = await query(
    `SELECT x.*, i.sku, i.unit FROM purchase_order_items x LEFT JOIN items i ON i.id = x.item_id
      WHERE x.po_id = $1 ORDER BY x.id`, [req.params.id]);
  res.json({ ...rows[0], items });
}));

router.post('/purchase-orders', wrap(async (req, res) => {
  const po = await withTransaction((c) => createPurchaseOrder(c, req.body));
  res.status(201).json(po);
}));

router.post('/purchase-orders/:id/receive', wrap(async (req, res) => {
  const po = await withTransaction((c) => receivePurchaseOrder(c, req.params.id));
  res.json(po);
}));

router.post('/purchase-orders/:id/confirm', wrap(async (req, res) => {
  res.json(await withTransaction((c) => advancePurchaseOrder(c, req.params.id, 'CONFIRMED')));
}));

router.post('/purchase-orders/:id/dispatch', wrap(async (req, res) => {
  res.json(await withTransaction((c) => advancePurchaseOrder(c, req.params.id, 'DISPATCHED')));
}));

router.post('/purchase-orders/:id/cancel', wrap(async (req, res) => {
  res.json(await withTransaction((c) => cancelPurchaseOrder(c, req.params.id)));
}));

/** Vendors who have supplied each item before, with their last price: Map(item_id -> [{ supplier_id, orders, last_cost }]) */
async function vendorHistory(itemIds) {
  const { rows } = await query(
    `SELECT x.item_id, p.supplier_id, count(*) AS orders,
            (array_agg(x.unit_cost ORDER BY p.created_at DESC))[1] AS last_cost
       FROM purchase_order_items x JOIN purchase_orders p ON p.id = x.po_id
      WHERE x.item_id = ANY($1::int[]) AND p.status <> 'CANCELLED' AND p.supplier_id IS NOT NULL
      GROUP BY x.item_id, p.supplier_id`, [itemIds]);
  const byItem = new Map();
  for (const h of rows) {
    if (!byItem.has(h.item_id)) byItem.set(h.item_id, []);
    byItem.get(h.item_id).push({ supplier_id: h.supplier_id, orders: h.orders, last_cost: h.last_cost });
  }
  return byItem;
}

/* ------------------------------------------------------------------ Restock */

// Every item with its stock level, quantity already on open orders, and past vendors
router.get('/restock', wrap(async (_req, res) => {
  const { rows } = await query(`
    SELECT i.id, i.sku, i.name, i.unit, i.quantity, i.reorder_level, i.price, i.manufacturer, i.strength,
           i.supplier_id, c.name AS category_name, g.id AS group_id, g.name AS group_name,
           COALESCE(o.on_order, 0) AS on_order
      FROM items i
      JOIN categories c ON c.id = i.category_id
      LEFT JOIN categories g ON g.id = c.parent_id
      LEFT JOIN (SELECT x.item_id, sum(x.quantity) AS on_order
                   FROM purchase_order_items x JOIN purchase_orders p ON p.id = x.po_id
                  WHERE p.status IN ('PENDING','CONFIRMED','DISPATCHED') GROUP BY x.item_id) o ON o.item_id = i.id
     ORDER BY (i.quantity::float / NULLIF(i.reorder_level, 0)) NULLS LAST, i.name`);
  const history = await vendorHistory(rows.map((r) => r.id));
  res.json(rows.map((r) => ({ ...r, vendors: history.get(r.id) || [] })));
}));

// lines: [{ item_id, supplier_id, quantity, unit_cost }] -> one purchase order per vendor
router.post('/restock/order', wrap(async (req, res) => {
  const { lines, expected_date } = req.body;
  const bySupplier = new Map();
  for (const l of lines || []) {
    const sid = Number(l.supplier_id);
    if (!sid) throw new HttpError(400, 'Choose a vendor for every selected item');
    if (!bySupplier.has(sid)) bySupplier.set(sid, []);
    bySupplier.get(sid).push(l);
  }
  if (!bySupplier.size) throw new HttpError(400, 'Select at least one item to restock');
  const orders = await withTransaction(async (c) => {
    const out = [];
    for (const [sid, items] of bySupplier) {
      out.push(await createPurchaseOrder(c, { supplier_id: sid, items, expected_date, notes: 'Restock' }));
    }
    return out;
  });
  res.status(201).json({ orders });
}));

/* ----------------------------------------------------------------- Requests */

router.get('/requests/summary', wrap(async (_req, res) => {
  const { rows } = await query("SELECT count(*) AS pending FROM requests WHERE status = 'PENDING'");
  res.json(rows[0]);
}));

router.get('/requests', wrap(async (req, res) => {
  const params = [];
  let where = '';
  if (req.query.status) { params.push(req.query.status); where = 'WHERE r.status = $1'; }
  const { rows: reqs } = await query(
    `SELECT r.*, d.name AS department_name FROM requests r LEFT JOIN departments d ON d.id = r.department_id
      ${where} ORDER BY (r.status = 'PENDING') DESC, (r.priority = 'URGENT') DESC, r.created_at DESC LIMIT 200`, params);
  const ids = reqs.map((r) => r.id);
  const { rows: lines } = await query(
    `SELECT ri.*, i.sku, i.quantity AS in_stock, i.price, i.supplier_id AS default_supplier_id,
            p.po_no, p.status AS po_status, s.name AS po_supplier
       FROM request_items ri
       LEFT JOIN items i ON i.id = ri.item_id
       LEFT JOIN purchase_orders p ON p.id = ri.po_id
       LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE ri.request_id = ANY($1::int[]) ORDER BY ri.id`, [ids]);
  const vendorsByItem = await vendorHistory([...new Set(lines.map((l) => l.item_id).filter(Boolean))]);
  const linesByReq = new Map(ids.map((id) => [id, []]));
  for (const l of lines) linesByReq.get(l.request_id).push({ ...l, vendors: vendorsByItem.get(l.item_id) || [] });
  res.json(reqs.map((r) => ({ ...r, items: linesByReq.get(r.id) })));
}));

router.post('/requests', wrap(async (req, res) => {
  const r = await withTransaction((c) => createRequest(c, req.body));
  res.status(201).json(r);
}));

router.post('/requests/:id/order', wrap(async (req, res) => {
  const result = await withTransaction((c) => placeRequestOrder(c, req.params.id, req.body));
  res.status(201).json(result);
}));

router.post('/requests/:id/cancel', wrap(async (req, res) => {
  const { rows } = await query(
    "UPDATE requests SET status = 'CANCELLED' WHERE id = $1 AND status = 'PENDING' RETURNING *", [req.params.id]);
  if (!rows[0]) throw new HttpError(400, 'Only pending requests can be cancelled');
  res.json(rows[0]);
}));

/* ---------------------------------------------------------- Stock ledger */

router.get('/movements', wrap(async (req, res) => {
  const where = [];
  const params = [];
  if (req.query.type) { params.push(req.query.type); where.push(`m.type = $${params.length}`); }
  if (req.query.item_id) { params.push(req.query.item_id); where.push(`m.item_id = $${params.length}`); }
  if (req.query.q) { params.push(`%${req.query.q.toLowerCase()}%`); where.push(`(lower(m.item_name) LIKE $${params.length} OR lower(COALESCE(m.reference,'')) LIKE $${params.length})`); }
  const limit = Math.min(parseInt(req.query.limit, 10) || 300, 2000);
  const { rows } = await query(
    `SELECT m.*, i.sku, i.unit FROM stock_movements m LEFT JOIN items i ON i.id = m.item_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY m.created_at DESC, m.id DESC LIMIT ${limit}`, params);
  res.json(rows);
}));

export default router;
