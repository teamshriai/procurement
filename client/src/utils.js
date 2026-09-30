const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const inrShort = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-IN');

export const money = (v) => inr.format(Number(v) || 0);
export const moneyShort = (v) => {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return inrShort.format(n);
};
export const number = (v) => num.format(Number(v) || 0);

export const dateTime = (v) =>
  v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const date = (v) =>
  v ? new Date(v.length === 10 ? `${v}T00:00:00` : v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const daysUntil = (d) => {
  if (!d) return null;
  const t = new Date(`${d}T00:00:00`);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((t - now) / 864e5);
};

export function stockStatus(item) {
  if (item.quantity === 0) return { key: 'out', label: 'Out of stock' };
  if (item.quantity <= item.reorder_level) return { key: 'low', label: 'Low stock' };
  return { key: 'ok', label: 'In stock' };
}

export function downloadCSV(filename, rows, columns) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(typeof c.value === 'function' ? c.value(r) : r[c.value])).join(',')).join('\n');
  const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Build [{...group, children:[...]}] from a flat category list. */
export function categoryTree(list) {
  const groups = list.filter((c) => !c.parent_id).map((g) => ({ ...g, children: [] }));
  const byId = new Map(groups.map((g) => [g.id, g]));
  for (const c of list) if (c.parent_id && byId.has(c.parent_id)) byId.get(c.parent_id).children.push(c);
  for (const g of groups) {
    g.item_count_total = g.item_count + g.children.reduce((s, c) => s + c.item_count, 0);
    g.stock_value_total = g.stock_value + g.children.reduce((s, c) => s + c.stock_value, 0);
    g.units_total = g.units + g.children.reduce((s, c) => s + c.units, 0);
  }
  return groups;
}

export const UNITS = ['pcs', 'box', 'pack', 'strip', 'bottle', 'vial', 'ampoule', 'tube', 'roll', 'pair', 'set', 'kit',
  'can', 'bag', 'kg', 'litre', 'ream', 'pad', 'jar', 'tin', 'sachet', 'syringe', 'pen', 'inhaler', 'respule'];
export const GST_RATES = [0, 5, 12, 18, 28];

/** URL of a file in client/public, correct wherever the app is served (site root or a sub-path). */
export const asset = (name) => `${import.meta.env.BASE_URL}${name}`;
