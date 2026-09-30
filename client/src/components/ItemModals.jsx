import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Minus, Equal, X } from 'lucide-react';
import { api } from '../api';
import { useToast } from '../context';
import { Modal, Field, Loading, StockBadge } from './ui';
import { UNITS, GST_RATES, categoryTree, money, number, dateTime, date } from '../utils';

const EMPTY = {
  name: '', sku: '', category_id: '', supplier_id: '', unit: 'pcs', price: '', quantity: '', reorder_level: '10',
  gst_rate: '12', manufacturer: '', strength: '', batch_no: '', expiry_date: '', location: '', description: '',
};

export function ItemFormModal({ open, item, categories, suppliers, defaultCategory, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const tree = useMemo(() => categoryTree(categories || []), [categories]);

  useEffect(() => {
    if (!open) return;
    if (item) {
      const f = {};
      for (const k of Object.keys(EMPTY)) f[k] = item[k] === null || item[k] === undefined ? '' : String(item[k]);
      setForm(f);
    } else {
      setForm({ ...EMPTY, category_id: defaultCategory ? String(defaultCategory) : '' });
    }
  }, [open, item, defaultCategory]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const saved = item ? await api.put(`/items/${item.id}`, form) : await api.post('/items', form);
      toast.success(item ? `Updated “${saved.name}”` : `Added “${saved.name}” (${saved.sku})`);
      onSaved(saved);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={item ? `Edit item · ${item.sku}` : 'Add new item'}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="item-form" className="btn btn-primary" disabled={busy}>
            {busy && <Loader2 size={16} className="spin" />} {item ? 'Save changes' : 'Add item'}
          </button>
        </>
      )}
    >
      <form id="item-form" className="form-grid" onSubmit={submit}>
        <Field label="Item name *" span={2}>
          <input required value={form.name} onChange={set('name')} placeholder="e.g. Paracetamol 500mg Tablets (10s)" autoFocus />
        </Field>
        <Field label="Category *">
          <select required value={form.category_id} onChange={set('category_id')}>
            <option value="">Select category…</option>
            {tree.map((g) => (
              <optgroup key={g.id} label={g.name}>
                {g.children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="SKU / Item code" hint={item ? undefined : 'Leave blank to auto-generate'}>
          <input value={form.sku} onChange={set('sku')} required={!!item} placeholder="Auto" className="mono" />
        </Field>
        <Field label="Unit *">
          <select value={form.unit} onChange={set('unit')}>
            {[...new Set([...UNITS, form.unit])].map((u) => <option key={u}>{u}</option>)}
          </select>
        </Field>
        <Field label="Price per unit (₹) *">
          <input required type="number" min="0" step="0.01" value={form.price} onChange={set('price')} />
        </Field>
        <Field label="GST %">
          <select value={form.gst_rate} onChange={set('gst_rate')}>
            {[...new Set([...GST_RATES.map(String), form.gst_rate])].map((g) => <option key={g} value={g}>{g}%</option>)}
          </select>
        </Field>
        {!item && (
          <Field label="Opening quantity">
            <input type="number" min="0" step="1" value={form.quantity} onChange={set('quantity')} placeholder="0" />
          </Field>
        )}
        <Field label="Reorder level" hint="Alert when stock falls to this">
          <input type="number" min="0" step="1" value={form.reorder_level} onChange={set('reorder_level')} />
        </Field>
        <Field label="Supplier">
          <select value={form.supplier_id} onChange={set('supplier_id')}>
            <option value="">— None —</option>
            {(suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Manufacturer / Brand">
          <input value={form.manufacturer} onChange={set('manufacturer')} />
        </Field>
        <Field label="Strength" hint="e.g. 500mg. Leave blank to read it from the name">
          <input value={form.strength} onChange={set('strength')} />
        </Field>
        <Field label="Batch no.">
          <input value={form.batch_no} onChange={set('batch_no')} />
        </Field>
        <Field label="Expiry date">
          <input type="date" value={form.expiry_date} onChange={set('expiry_date')} />
        </Field>
        <Field label="Store location">
          <input value={form.location} onChange={set('location')} placeholder="e.g. Main Store / Rack 4" />
        </Field>
        <Field label="Description / notes" span={2}>
          <textarea rows={2} value={form.description} onChange={set('description')} />
        </Field>
      </form>
    </Modal>
  );
}

export function AdjustStockModal({ item, onClose, onSaved }) {
  const toast = useToast();
  const [mode, setMode] = useState('add');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setMode('add'); setAmount(''); setNote(''); }, [item]);
  if (!item) return null;

  const n = parseInt(amount, 10);
  const valid = Number.isFinite(n) && n >= 0 && !(mode !== 'set' && n === 0);
  const result = !valid ? null : mode === 'add' ? item.quantity + n : mode === 'remove' ? item.quantity - n : n;

  const submit = async (e) => {
    e.preventDefault();
    if (!valid || result < 0) return;
    setBusy(true);
    try {
      const body = mode === 'set' ? { set: n, note } : { change: mode === 'add' ? n : -n, note };
      const saved = await api.patch(`/items/${item.id}/stock`, body);
      toast.success(`Stock for “${item.name}” is now ${number(saved.quantity)} ${saved.unit}`);
      onSaved(saved);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Adjust stock"
      footer={(
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="adjust-form" className="btn btn-primary" disabled={busy || !valid || result < 0}>
            {busy && <Loader2 size={16} className="spin" />} Update stock
          </button>
        </>
      )}
    >
      <form id="adjust-form" onSubmit={submit} className="stack">
        <div>
          <div className="cell-title">{item.name}</div>
          <div className="muted small">Currently <strong>{number(item.quantity)} {item.unit}</strong> on hand</div>
        </div>
        <div className="segmented">
          <button type="button" className={mode === 'add' ? 'active' : ''} onClick={() => setMode('add')}><Plus size={15} /> Add</button>
          <button type="button" className={mode === 'remove' ? 'active' : ''} onClick={() => setMode('remove')}><Minus size={15} /> Remove</button>
          <button type="button" className={mode === 'set' ? 'active' : ''} onClick={() => setMode('set')}><Equal size={15} /> Set to</button>
        </div>
        <Field label={mode === 'set' ? 'New quantity' : 'Quantity'}>
          <input type="number" min="0" step="1" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Reason / note">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Physical count, damaged, received from donor" />
        </Field>
        {valid && (
          <div className={`callout ${result < 0 ? 'callout-error' : ''}`}>
            {result < 0 ? `Cannot remove more than ${item.quantity} ${item.unit}.` : <>New balance: <strong>{number(result)} {item.unit}</strong></>}
          </div>
        )}
      </form>
    </Modal>
  );
}

const TYPE_LABEL = {
  OPENING: 'Opening', ADJUSTMENT: 'Adjustment', ISSUE: 'Issued (bill)', ISSUE_CANCEL: 'Bill cancelled', PURCHASE: 'Purchase receipt',
};
export const movementLabel = (t) => TYPE_LABEL[t] || t;

export function ItemDrawer({ itemId, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!itemId) return;
    setData(null);
    api.get(`/items/${itemId}`).then(setData).catch(() => setData({ error: true }));
  }, [itemId]);
  if (!itemId) return null;
  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer">
        <div className="modal-head">
          <h2>Item details</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="drawer-body">
          {!data ? <Loading /> : data.error ? <p>Could not load item.</p> : (
            <>
              <div className="drawer-hero">
                <div className="muted small mono">{data.sku}</div>
                <h3>{data.name}</h3>
                <div className="muted small">{data.group_name} › {data.category_name}</div>
                <div className="drawer-kpis">
                  <div><span>On hand</span><strong>{number(data.quantity)} {data.unit}</strong></div>
                  <div><span>Price</span><strong>{money(data.price)}</strong></div>
                  <div><span>Value</span><strong>{money(data.price * data.quantity)}</strong></div>
                </div>
                <StockBadge item={data} />
              </div>
              <dl className="details">
                <dt>Reorder level</dt><dd>{number(data.reorder_level)} {data.unit}</dd>
                <dt>GST</dt><dd>{data.gst_rate}%</dd>
                <dt>Supplier</dt><dd>{data.supplier_name || '—'}</dd>
                <dt>Manufacturer</dt><dd>{data.manufacturer || '—'}</dd>
                <dt>Strength</dt><dd>{data.strength || '—'}</dd>
                <dt>Batch</dt><dd>{data.batch_no || '—'}</dd>
                <dt>Expiry</dt><dd>{date(data.expiry_date)}</dd>
                <dt>Location</dt><dd>{data.location || '—'}</dd>
                {data.description && (<><dt>Notes</dt><dd>{data.description}</dd></>)}
              </dl>
              <h4>Stock history</h4>
              <ul className="timeline">
                {data.movements.map((m) => (
                  <li key={m.id}>
                    <span className={`delta ${m.change > 0 ? 'pos' : 'neg'}`}>{m.change > 0 ? '+' : ''}{number(m.change)}</span>
                    <div>
                      <div><strong>{movementLabel(m.type)}</strong> {m.reference && <span className="mono muted small">· {m.reference}</span>}</div>
                      <div className="muted small">{dateTime(m.created_at)} · balance {number(m.balance_after)}{m.note ? ` · ${m.note}` : ''}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
