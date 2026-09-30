import { useMemo, useState } from 'react';
import { Search, XCircle, AlertTriangle, TrendingDown, Truck, Boxes, ShoppingCart, Loader2 } from 'lucide-react';
import { api } from '../api';
import { useToast } from '../context';
import { useFetch, PageHeader, Loading, ErrorBox, Empty } from '../components/ui';
import { VendorSelect, NewPrice, oldPrice, priceDecided } from '../components/Pricing';
import { money, number } from '../utils';

const isoDate = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

// out = none left, low = at or below reorder level, soon = within 1.5x reorder level
const level = (i) => {
  if (i.quantity === 0) return 'out';
  if (i.quantity <= i.reorder_level) return 'low';
  if (i.quantity <= i.reorder_level * 1.5) return 'soon';
  return 'ok';
};

const TILES = [
  { key: 'need', label: 'Needs restock', icon: AlertTriangle, fill: 'orange', test: (i) => ['out', 'low'].includes(level(i)), sub: 'out of stock or low' },
  { key: 'out', label: 'Out of stock', icon: XCircle, fill: 'red', test: (i) => level(i) === 'out', sub: 'nothing left' },
  { key: 'low', label: 'Low stock', icon: AlertTriangle, fill: 'amber', test: (i) => level(i) === 'low', sub: 'at or below reorder level' },
  { key: 'soon', label: 'Getting low', icon: TrendingDown, fill: 'yellow', test: (i) => level(i) === 'soon', sub: 'close to reorder level' },
  { key: 'onorder', label: 'Already on order', icon: Truck, fill: 'teal', test: (i) => i.on_order > 0, sub: 'waiting for delivery' },
  { key: 'all', label: 'All medicines', icon: Boxes, fill: 'navy', test: () => true, sub: 'full catalogue' },
];

const LEVEL_BADGE = {
  out: ['badge-critical', 'Out of stock'],
  low: ['badge-warning', 'Low'],
  soon: ['badge-info', 'Getting low'],
  ok: ['badge-good', 'OK'],
};

// Bring stock up to twice the reorder level, counting what is already on order
const suggestedQty = (i) => {
  const s = i.reorder_level * 2 - i.quantity - i.on_order;
  return s > 0 ? s : Math.max(i.reorder_level, 1);
};

export default function Restock() {
  const toast = useToast();
  const stock = useFetch('/restock');
  const sups = useFetch('/suppliers');
  const [show, setShow] = useState('need');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [draft, setDraft] = useState({}); // item id -> { selected, supplier_id, quantity, unit_cost }
  const [expected, setExpected] = useState(isoDate(7));
  const [busy, setBusy] = useState(false);

  const items = useMemo(() => (stock.data || []).map((i) => ({ ...i, default_supplier_id: i.supplier_id })), [stock.data]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const categories = useMemo(() => [...new Set(items.map((i) => i.category_name))].sort(), [items]);

  const line = (i) => draft[i.id] || {
    // Out-of-stock and low items that are not already on order start ticked
    selected: ['out', 'low'].includes(level(i)) && i.on_order === 0,
    supplier_id: i.supplier_id ? String(i.supplier_id) : '',
    quantity: suggestedQty(i),
    unit_cost: '',
  };
  const set = (i, patch) => setDraft((d) => ({ ...d, [i.id]: { ...line(i), ...(d[i.id] || {}), ...patch } }));

  const tile = TILES.find((t) => t.key === show);
  const rows = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((i) => tile.test(i)
      && (!category || i.category_name === category)
      && words.every((w) => `${i.name} ${i.sku} ${i.manufacturer || ''} ${i.category_name}`.toLowerCase().includes(w)));
  }, [items, tile, q, category]); // eslint-disable-line react-hooks/exhaustive-deps

  if (stock.error) return <ErrorBox error={stock.error} onRetry={stock.reload} />;
  if (!stock.data || !sups.data) return <Loading />;

  const selected = items.filter((i) => line(i).selected);
  const noVendor = selected.filter((i) => !line(i).supplier_id).length;
  const undecided = selected.filter((i) => !priceDecided(line(i).unit_cost)).length;
  const vendorCount = new Set(selected.map((i) => line(i).supplier_id).filter(Boolean)).size;
  const total = selected.reduce((s, i) => s + (Number(line(i).quantity) || 0) * (Number(line(i).unit_cost) || 0), 0);
  const allShownSelected = rows.length > 0 && rows.every((i) => line(i).selected);

  const selectShown = (on) => rows.forEach((i) => set(i, { selected: on }));
  const samePriceSelected = () => selected.forEach((i) => {
    const l = line(i);
    if (l.supplier_id && !priceDecided(l.unit_cost)) set(i, { unit_cost: String(oldPrice(i, l.supplier_id)) });
  });

  const place = async () => {
    setBusy(true);
    try {
      const res = await api.post('/restock/order', {
        expected_date: expected,
        lines: selected.map((i) => {
          const l = line(i);
          return { item_id: i.id, supplier_id: l.supplier_id, quantity: l.quantity, unit_cost: l.unit_cost };
        }),
      });
      toast.success(`Placed ${res.orders.map((o) => o.po_no).join(', ')}`);
      setDraft({});
      stock.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const problem = !selected.length ? 'Tick the items to restock'
    : noVendor ? `Choose a vendor for ${noVendor} item${noVendor === 1 ? '' : 's'}`
      : undecided ? `Set the new price for ${undecided} item${undecided === 1 ? '' : 's'}` : null;

  return (
    <>
      <PageHeader title="Restock" />

      <div className="tiles">
        {TILES.map((t) => {
          const Icon = t.icon;
          const n = items.filter(t.test).length;
          return (
            <button key={t.key} type="button" onClick={() => setShow(t.key)}
              className={`card stat tile tile-fill fill-${t.fill} ${show === t.key ? 'active' : ''}`}>
              <div className="stat-icon"><Icon size={20} /></div>
              <div className="stat-body">
                <span className="stat-label">{t.label}</span>
                <strong className="stat-value">{number(n)}</strong>
                <span className="stat-sub">{t.sub}</span>
              </div>
            </button>
          );
        })}
      </div>

      <section className="card restock-card">
        <div className="toolbar">
          <div className="search"><Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search medicine, code or brand…" /></div>
          <select className="select-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          {undecided > 0 && <button className="btn btn-ghost btn-sm" onClick={samePriceSelected}>Same price for all ticked</button>}
          <div className="toolbar-summary muted small">{rows.length} shown</div>
        </div>

        {rows.length === 0 ? <Empty title="Nothing here" /> : (
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th><input type="checkbox" checked={allShownSelected} onChange={(e) => selectShown(e.target.checked)} aria-label="Tick all shown" /></th>
                  <th>Medicine</th><th>Stock</th><th className="num">On order</th><th className="num">Order qty</th>
                  <th>Vendor</th><th className="num">Old price</th><th>New price (₹)</th><th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => {
                  const l = line(i);
                  const lv = level(i);
                  const old = oldPrice(i, l.supplier_id);
                  return (
                    <tr key={i.id} className={l.selected ? 'row-selected' : ''}>
                      <td><input type="checkbox" checked={l.selected} onChange={(e) => set(i, { selected: e.target.checked })} aria-label={`Tick ${i.name}`} /></td>
                      <td>
                        <div className="cell-title">{i.name}</div>
                        <div className="muted small"><span className="mono">{i.sku}</span> · {i.category_name}{i.manufacturer ? ` · ${i.manufacturer}` : ''}</div>
                      </td>
                      <td className="nowrap">
                        <div><strong className={lv === 'out' ? 'text-critical' : lv === 'low' ? 'text-warning' : ''}>{number(i.quantity)}</strong> <span className="muted small">/ {number(i.reorder_level)} {i.unit}</span></div>
                        <div className="stock-line">
                          <div className="stock-meter"><div style={{ width: `${Math.min((i.quantity / ((i.reorder_level || 1) * 2)) * 100, 100)}%` }} /></div>
                          <span className={`badge ${LEVEL_BADGE[lv][0]}`}>{LEVEL_BADGE[lv][1]}</span>
                        </div>
                      </td>
                      <td className="num">{i.on_order ? <strong>{number(i.on_order)}</strong> : <span className="muted">—</span>}</td>
                      <td className="num"><input className="input-num" type="number" min="1" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value, selected: true })} /></td>
                      <td><VendorSelect line={i} suppliers={sups.data} value={l.supplier_id} onChange={(v) => set(i, { supplier_id: v, unit_cost: '', selected: true })} /></td>
                      <td className="num muted">{money(old)}</td>
                      <td><NewPrice old={old} value={l.unit_cost} onChange={(v) => set(i, { unit_cost: v, selected: true })} /></td>
                      <td className="num">{priceDecided(l.unit_cost) ? money((Number(l.quantity) || 0) * Number(l.unit_cost)) : <span className="muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="order-bar">
        <span><strong>{selected.length}</strong> item{selected.length === 1 ? '' : 's'} ticked{vendorCount ? ` · ${vendorCount} vendor${vendorCount === 1 ? '' : 's'}` : ''}</span>
        {problem && <span className="text-warning small">{problem}</span>}
        <label className="inline-field">Deliver by <input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></label>
        <span className="muted">Total <strong>{money(total)}</strong></span>
        <button className="btn btn-primary" onClick={place} disabled={busy || !!problem}>
          {busy ? <Loader2 size={16} className="spin" /> : <ShoppingCart size={16} />}
          {vendorCount > 1 ? ` Place ${vendorCount} orders` : ' Place order'}
        </button>
      </div>
    </>
  );
}
