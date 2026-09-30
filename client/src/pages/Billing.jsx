import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Trash2, ShoppingCart, ReceiptText, Loader2, Plus, AlertTriangle } from 'lucide-react';
import { api } from '../api';
import { useCart, useToast } from '../context';
import { useFetch, PageHeader, Loading, ErrorBox, Empty, QtyStepper, GroupIcon, Field, Confirm } from '../components/ui';
import { categoryTree, money, number } from '../utils';

export default function Billing() {
  const toast = useToast();
  const cart = useCart();
  const navigate = useNavigate();
  const items = useFetch('/items');
  const cats = useFetch('/categories');
  const depts = useFetch('/departments');

  const [q, setQ] = useState('');
  const [group, setGroup] = useState(null);
  const [form, setForm] = useState({ department_id: '', requested_by: '', patient_ref: '', notes: '', discount: '' });
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [shortages, setShortages] = useState([]);

  const { sync } = cart;
  // Keep cart snapshots in step with the latest stock and prices
  useEffect(() => { if (items.data) sync(items.data); }, [items.data, sync]);

  const tree = useMemo(() => categoryTree(cats.data || []), [cats.data]);
  const products = useMemo(() => {
    if (!items.data) return [];
    const needle = q.trim().toLowerCase();
    return items.data.filter((i) => (!group || i.group_id === group)
      && (!needle || `${i.name} ${i.sku} ${i.manufacturer || ''}`.toLowerCase().includes(needle)));
  }, [items.data, q, group]);

  const discount = Math.max(Number(form.discount) || 0, 0);
  const gross = cart.totals.subtotal + cart.totals.tax;
  const total = Math.max(gross - discount, 0);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!cart.lines.length) return;
    if (!form.department_id) { toast.error('Select the requesting department'); return; }
    setBusy(true);
    setShortages([]);
    try {
      const bill = await api.post('/bills', {
        ...form,
        discount: Math.min(discount, gross),
        items: cart.lines.map((l) => ({ item_id: l.item.id, quantity: l.quantity })),
      });
      cart.clear();
      setForm({ department_id: '', requested_by: '', patient_ref: '', notes: '', discount: '' });
      toast.success(`Bill ${bill.bill_no} generated · stock updated`);
      navigate(`/bills/${bill.id}?print=1`);
    } catch (err) {
      if (err.data?.shortages) { setShortages(err.data.shortages); items.reload(); }
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (items.error) return <ErrorBox error={items.error} onRetry={items.reload} />;

  return (
    <>
      <PageHeader title="New Bill" />

      <div className="billing-layout">
        <section className="card billing-products">
          <div className="toolbar">
            <div className="search grow">
              <Search size={16} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product, SKU, brand…" autoFocus />
            </div>
          </div>
          <div className="chips-row">
            <button className={`chip-btn ${!group ? 'active' : ''}`} onClick={() => setGroup(null)}>All</button>
            {tree.map((g) => (
              <button key={g.id} className={`chip-btn ${group === g.id ? 'active' : ''}`} onClick={() => setGroup(g.id)}>
                <GroupIcon name={g.icon} size={14} /> {g.name}
              </button>
            ))}
          </div>
          {items.loading && !items.data ? <Loading /> : products.length === 0 ? <Empty title="No products found" /> : (
            <div className="product-grid">
              {products.map((p) => {
                const line = cart.lines.find((l) => l.item.id === p.id);
                const out = p.quantity === 0;
                const low = !out && p.quantity <= p.reorder_level;
                return (
                  <button
                    key={p.id}
                    className={`product ${line ? 'in-cart' : ''} ${out ? 'is-out' : ''}`}
                    disabled={out || (line && line.quantity >= p.quantity)}
                    onClick={() => cart.add(p, 1)}
                  >
                    <div className="product-top">
                      <span className="mono muted small">{p.sku}</span>
                      {line && <span className="product-qty">{line.quantity}</span>}
                    </div>
                    <div className="product-name">{p.name}</div>
                    <div className="muted small">{p.category_name}</div>
                    <div className="product-foot">
                      <strong>{money(p.price)}<span className="muted small"> /{p.unit}</span></strong>
                      <span className={`small ${out ? 'text-critical' : low ? 'text-warning' : 'muted'}`}>
                        {out ? 'Out of stock' : `${number(p.quantity)} left`}
                      </span>
                    </div>
                    {!out && <span className="product-add"><Plus size={14} /></span>}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <aside className="card bill-panel">
          <div className="card-head">
            <h3><ShoppingCart size={18} /> Current bill</h3>
            {cart.lines.length > 0 && <button className="btn btn-link btn-sm" onClick={() => setConfirmClear(true)}>Clear</button>}
          </div>

          <div className="form-grid tight">
            <Field label="Department *" span={2}>
              <select value={form.department_id} onChange={set('department_id')}>
                <option value="">Select requesting department…</option>
                {(depts.data || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Requested by">
              <input value={form.requested_by} onChange={set('requested_by')} placeholder="Name" />
            </Field>
            <Field label="Patient / ref no.">
              <input value={form.patient_ref} onChange={set('patient_ref')} placeholder="Optional" />
            </Field>
          </div>

          {shortages.length > 0 && (
            <div className="callout callout-error">
              <AlertTriangle size={16} />
              <div>
                <strong>Not enough stock:</strong>
                <ul>{shortages.map((s) => <li key={s.item_id}>{s.name}: requested {s.requested}, available {s.available}</li>)}</ul>
              </div>
            </div>
          )}

          {cart.lines.length === 0 ? (
            <Empty title="No items yet">Click products on the left, or select items in Items &amp; Stock and choose “Add to bill”.</Empty>
          ) : (
            <ul className="bill-lines">
              {cart.lines.map(({ item, quantity }) => (
                <li key={item.id}>
                  <div className="bill-line-info">
                    <div className="cell-title">{item.name}</div>
                    <div className="muted small">{money(item.price)} × {quantity} {item.unit} · GST {item.gst_rate}% · {number(item.quantity)} in stock</div>
                  </div>
                  <div className="bill-line-ctrl">
                    <QtyStepper value={quantity} max={item.quantity} onChange={(v) => cart.setQty(item.id, v)} />
                    <strong className="bill-line-total">{money(item.price * quantity * (1 + item.gst_rate / 100))}</strong>
                    <button className="icon-btn danger" onClick={() => cart.remove(item.id)} aria-label="Remove"><Trash2 size={15} /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="bill-summary">
            <div><span>Items</span><span>{cart.lines.length} lines · {number(cart.totals.count)} units</span></div>
            <div><span>Subtotal</span><span>{money(cart.totals.subtotal)}</span></div>
            <div><span>GST</span><span>{money(cart.totals.tax)}</span></div>
            <div className="discount-row">
              <span>Discount (₹)</span>
              <input type="number" min="0" step="0.01" value={form.discount} onChange={set('discount')} placeholder="0.00" />
            </div>
            <div className="bill-total"><span>Total</span><span>{money(total)}</span></div>
          </div>
          <Field label="Notes">
            <textarea rows={2} value={form.notes} onChange={set('notes')} placeholder="Ward, indent number, remarks…" />
          </Field>
          <button className="btn btn-primary btn-block btn-lg" disabled={!cart.lines.length || busy} onClick={submit}>
            {busy ? <Loader2 size={18} className="spin" /> : <ReceiptText size={18} />} Generate Bill · {money(total)}
          </button>
        </aside>
      </div>

      <Confirm
        open={confirmClear}
        title="Clear current bill?"
        message="All selected items will be removed from this bill."
        confirmLabel="Clear bill"
        onConfirm={() => { cart.clear(); setConfirmClear(false); }}
        onClose={() => setConfirmClear(false)}
      />
    </>
  );
}
