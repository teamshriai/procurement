import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Plus, Search, Download, Pencil, Trash2, History, ShoppingCart, ChevronRight, ChevronDown, Minus, Check, X, Layers,
} from 'lucide-react';
import { api } from '../api';
import { useCart, useToast } from '../context';
import {
  useFetch, PageHeader, Loading, ErrorBox, Empty, StockBadge, Confirm, GroupIcon,
} from '../components/ui';
import { ItemFormModal, AdjustStockModal, ItemDrawer } from '../components/ItemModals';
import { categoryTree, money, number, downloadCSV, stockStatus, daysUntil } from '../utils';

function PriceCell({ item, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(item.price);
  useEffect(() => setVal(item.price), [item.price]);
  if (!editing) {
    return (
      <button className="price-btn" onClick={() => setEditing(true)} title="Click to change price">
        {money(item.price)} <Pencil size={12} />
      </button>
    );
  }
  const save = async () => {
    const p = Number(val);
    if (!Number.isFinite(p) || p < 0) return;
    if (p !== item.price) await onSave(p);
    setEditing(false);
  };
  return (
    <div className="price-edit">
      <input
        type="number" min="0" step="0.01" value={val} autoFocus
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
      />
      <button className="icon-btn" onClick={save} aria-label="Save price"><Check size={15} /></button>
      <button className="icon-btn" onClick={() => setEditing(false)} aria-label="Cancel"><X size={15} /></button>
    </div>
  );
}

export default function Inventory() {
  const toast = useToast();
  const cart = useCart();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const items = useFetch('/items');
  const cats = useFetch('/categories');
  const sups = useFetch('/suppliers');

  const [q, setQ] = useState(params.get('q') || '');
  const [category, setCategory] = useState(location.state?.category ? { id: location.state.category, isGroup: false } : null);
  const [status, setStatus] = useState(params.get('status') || '');
  const [expanded, setExpanded] = useState({});
  const [selected, setSelected] = useState(new Set());
  const [formOpen, setFormOpen] = useState(params.get('new') === '1');
  const [editing, setEditing] = useState(null);
  const [adjusting, setAdjusting] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setQ(params.get('q') || ''); }, [params]);

  const tree = useMemo(() => categoryTree(cats.data || []), [cats.data]);

  const filtered = useMemo(() => {
    if (!items.data) return [];
    const needle = q.trim().toLowerCase();
    return items.data.filter((i) => {
      if (needle && !(`${i.name} ${i.sku} ${i.manufacturer || ''} ${i.category_name}`.toLowerCase().includes(needle))) return false;
      if (category) {
        if (category.isGroup ? i.group_id !== category.id : i.category_id !== category.id) return false;
      }
      if (status) {
        const s = stockStatus(i).key;
        if (status === 'reorder' && s === 'ok') return false;
        if (status === 'low' && s !== 'low') return false;
        if (status === 'out' && s !== 'out') return false;
        if (status === 'ok' && s !== 'ok') return false;
        if (status === 'expiring') {
          const d = daysUntil(i.expiry_date);
          if (d === null || d > 90) return false;
        }
      }
      return true;
    });
  }, [items.data, q, category, status]);

  // Group rows: group › category
  const sections = useMemo(() => {
    const map = new Map();
    for (const i of filtered) {
      const key = i.category_id;
      if (!map.has(key)) map.set(key, { key, group: i.group_name, category: i.category_name, items: [] });
      map.get(key).items.push(i);
    }
    return [...map.values()];
  }, [filtered]);

  const replaceItem = (saved) => {
    items.setData((list) => list.map((i) => (i.id === saved.id ? { ...i, ...saved } : i)));
  };

  const quickAdjust = async (item, change) => {
    try {
      const saved = await api.patch(`/items/${item.id}/stock`, { change, note: change > 0 ? 'Quick increase' : 'Quick decrease' });
      replaceItem(saved);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const savePrice = async (item, price) => {
    try {
      const saved = await api.patch(`/items/${item.id}/price`, { price });
      replaceItem(saved);
      toast.success(`Price of “${item.name}” set to ${money(price)}`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const doDelete = async () => {
    setBusy(true);
    try {
      await api.del(`/items/${deleting.id}`);
      items.setData((list) => list.filter((i) => i.id !== deleting.id));
      cart.remove(deleting.id);
      toast.success(`Deleted “${deleting.name}”`);
      setDeleting(null);
      cats.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const allVisibleSelected = filtered.length > 0 && filtered.every((i) => selected.has(i.id));
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(filtered.map((i) => i.id)));

  const addSelectedToBill = (go) => {
    const chosen = items.data.filter((i) => selected.has(i.id));
    const inStock = chosen.filter((i) => i.quantity > 0);
    inStock.forEach((i) => cart.add(i, 1));
    const skipped = chosen.length - inStock.length;
    toast.success(`Added ${inStock.length} item(s) to the bill${skipped ? ` · ${skipped} out of stock skipped` : ''}`);
    setSelected(new Set());
    if (go) navigate('/billing');
  };

  const exportCsv = () => downloadCSV(`inventory-${new Date().toISOString().slice(0, 10)}.csv`, filtered, [
    { label: 'SKU', value: 'sku' }, { label: 'Item', value: 'name' }, { label: 'Group', value: 'group_name' },
    { label: 'Category', value: 'category_name' }, { label: 'Unit', value: 'unit' }, { label: 'Quantity', value: 'quantity' },
    { label: 'Reorder level', value: 'reorder_level' }, { label: 'Price', value: 'price' }, { label: 'GST %', value: 'gst_rate' },
    { label: 'Stock value', value: (r) => (r.price * r.quantity).toFixed(2) }, { label: 'Supplier', value: 'supplier_name' },
    { label: 'Manufacturer', value: 'manufacturer' }, { label: 'Batch', value: 'batch_no' }, { label: 'Expiry', value: 'expiry_date' },
    { label: 'Location', value: 'location' },
  ]);

  const selectCategory = (c) => {
    setCategory(c);
    if (params.get('q')) { params.delete('q'); setParams(params, { replace: true }); }
  };

  if (items.error) return <ErrorBox error={items.error} onRetry={items.reload} />;

  const totalValue = filtered.reduce((s, i) => s + i.price * i.quantity, 0);
  const activeTitle = category
    ? (category.isGroup ? tree.find((g) => g.id === category.id)?.name : (cats.data || []).find((c) => c.id === category.id)?.name)
    : 'All items';

  return (
    <>
      <PageHeader
        title="Items & Stock"
        actions={(
          <>
            <button className="btn btn-ghost" onClick={exportCsv} disabled={!filtered.length}><Download size={17} /> Export</button>
            <button className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}><Plus size={17} /> Add Item</button>
          </>
        )}
      />

      <div className="inventory-layout">
        <aside className="card cat-panel">
          <button className={`cat-row ${!category ? 'active' : ''}`} onClick={() => selectCategory(null)}>
            <Layers size={18} /> <span>All items</span> <span className="count">{items.data?.length ?? '…'}</span>
          </button>
          {tree.map((g) => {
            const open = expanded[g.id] ?? (category?.isGroup === false && g.children.some((c) => c.id === category.id));
            return (
              <div key={g.id} className="cat-group">
                <div className={`cat-row ${category?.isGroup && category.id === g.id ? 'active' : ''}`}>
                  <button className="cat-toggle" onClick={() => setExpanded((e) => ({ ...e, [g.id]: !open }))} aria-label={open ? 'Collapse' : 'Expand'}>
                    {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </button>
                  <button className="cat-main" onClick={() => { selectCategory({ id: g.id, isGroup: true }); setExpanded((e) => ({ ...e, [g.id]: true })); }}>
                    <GroupIcon name={g.icon} size={17} /> <span>{g.name}</span>
                  </button>
                  <span className="count">{g.item_count_total}</span>
                </div>
                {open && g.children.map((c) => (
                  <button
                    key={c.id}
                    className={`cat-row cat-sub ${category && !category.isGroup && category.id === c.id ? 'active' : ''}`}
                    onClick={() => selectCategory({ id: c.id, isGroup: false })}
                  >
                    <span>{c.name}</span> <span className="count">{c.item_count}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </aside>

        <section className="card inv-main">
          <div className="toolbar">
            <div className="search">
              <Search size={16} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search in ${activeTitle}…`} />
            </div>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="select-sm">
              <option value="">All stock levels</option>
              <option value="ok">In stock</option>
              <option value="reorder">Needs reorder (low + out)</option>
              <option value="low">Low stock</option>
              <option value="out">Out of stock</option>
              <option value="expiring">Expiring in 90 days</option>
            </select>
            <div className="toolbar-summary muted small">
              {number(filtered.length)} items · {money(totalValue)}
            </div>
          </div>

          {selected.size > 0 && (
            <div className="selection-bar">
              <strong>{selected.size} selected</strong>
              <button className="btn btn-sm btn-ghost" onClick={() => addSelectedToBill(false)}><ShoppingCart size={15} /> Add to bill</button>
              <button className="btn btn-sm btn-primary" onClick={() => addSelectedToBill(true)}>Add &amp; go to billing <ChevronRight size={15} /></button>
              <button className="btn btn-sm btn-link" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          )}

          {items.loading && !items.data ? <Loading /> : filtered.length === 0 ? (
            <Empty title="No items match">Try a different search, category or stock filter.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table inv-table">
                <thead>
                  <tr>
                    <th className="chk"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} aria-label="Select all" /></th>
                    <th>Item</th>
                    <th className="num">Stock</th>
                    <th className="num">Unit price</th>
                    <th className="num col-value">Value</th>
                    <th>Status</th>
                    <th className="actions-col" />
                  </tr>
                </thead>
                {sections.map((s) => (
                  <tbody key={s.key}>
                    <tr className="section-row">
                      <td colSpan={7}><span className="muted">{s.group} ›</span> {s.category} <span className="muted small">({s.items.length})</span></td>
                    </tr>
                    {s.items.map((i) => {
                      const exp = daysUntil(i.expiry_date);
                      const inCart = cart.lines.some((l) => l.item.id === i.id);
                      return (
                        <tr key={i.id} className={selected.has(i.id) ? 'is-selected' : ''}>
                          <td className="chk"><input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} aria-label={`Select ${i.name}`} /></td>
                          <td>
                            <button className="cell-title link-plain" onClick={() => setViewing(i.id)}>{i.name}</button>
                            <div className="muted small">
                              <span className="mono">{i.sku}</span>
                              {i.manufacturer && <> · {i.manufacturer}</>}
                              {exp !== null && exp <= 90 && <span className={`chip ${exp < 0 ? 'chip-critical' : 'chip-warning'}`}>{exp < 0 ? 'Expired' : `Exp. in ${exp}d`}</span>}
                            </div>
                          </td>
                          <td className="num">
                            <div className="qty-ctrl">
                              <button onClick={() => quickAdjust(i, -1)} disabled={i.quantity === 0} aria-label="Decrease by 1"><Minus size={14} /></button>
                              <button className="qty-val" onClick={() => setAdjusting(i)} title="Adjust stock">
                                <strong>{number(i.quantity)}</strong> <span className="muted small">{i.unit}</span>
                              </button>
                              <button onClick={() => quickAdjust(i, 1)} aria-label="Increase by 1"><Plus size={14} /></button>
                            </div>
                          </td>
                          <td className="num"><PriceCell item={i} onSave={(p) => savePrice(i, p)} /></td>
                          <td className="num col-value">{money(i.price * i.quantity)}</td>
                          <td><StockBadge item={i} /></td>
                          <td className="actions-col">
                            <div className="row-actions">
                              <button
                                className={`icon-btn ${inCart ? 'is-on' : ''}`}
                                title={i.quantity === 0 ? 'Out of stock' : inCart ? 'In bill — add one more' : 'Add to bill'}
                                disabled={i.quantity === 0}
                                onClick={() => { cart.add(i, 1); toast.success(`Added “${i.name}” to bill`); }}
                              ><ShoppingCart size={16} /></button>
                              <button className="icon-btn" title="History" onClick={() => setViewing(i.id)}><History size={16} /></button>
                              <button className="icon-btn" title="Edit" onClick={() => { setEditing(i); setFormOpen(true); }}><Pencil size={16} /></button>
                              <button className="icon-btn danger" title="Delete" onClick={() => setDeleting(i)}><Trash2 size={16} /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                ))}
              </table>
            </div>
          )}
        </section>
      </div>

      <ItemFormModal
        open={formOpen}
        item={editing}
        categories={cats.data}
        suppliers={sups.data}
        defaultCategory={category && !category.isGroup ? category.id : null}
        onClose={() => { setFormOpen(false); if (params.get('new')) { params.delete('new'); setParams(params, { replace: true }); } }}
        onSaved={() => { setFormOpen(false); items.reload(); cats.reload(); }}
      />
      <AdjustStockModal item={adjusting} onClose={() => setAdjusting(null)} onSaved={(s) => { replaceItem(s); setAdjusting(null); }} />
      <ItemDrawer itemId={viewing} onClose={() => setViewing(null)} />
      <Confirm
        open={!!deleting}
        title="Delete item?"
        message={deleting && `“${deleting.name}” (${deleting.sku}) will be removed from the catalogue. Past bills keep their record of it.`}
        busy={busy}
        onConfirm={doDelete}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
