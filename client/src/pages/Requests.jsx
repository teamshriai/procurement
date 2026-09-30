import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Trash2, Send, Loader2, ShoppingCart, Ban, Zap } from 'lucide-react';
import { api } from '../api';
import { useToast } from '../context';
import { useFetch, PageHeader, Loading, ErrorBox, Empty, StatusBadge, Confirm } from '../components/ui';
import { requestsChanged } from '../components/Layout';
import { VendorSelect, NewPrice, oldPrice, priceDecided } from '../components/Pricing';
import { money, number, dateTime } from '../utils';

const isoDate = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/* ------------------------------------------------------------- Item search */
// Every word typed must appear in the name, brand, strength or code, so "para 650" finds Paracetamol 650mg.

function ItemSearch({ items, exclude, onPick, disabled, placeholder }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const matches = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return items
      .filter((i) => !exclude.has(i.id))
      .filter((i) => {
        const hay = `${i.name} ${i.manufacturer || ''} ${i.strength || ''} ${i.sku}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 10);
  }, [q, items, exclude]);

  const pick = (item) => { onPick(item); setQ(''); setHi(0); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, matches.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    if (e.key === 'Enter' && matches[hi]) { e.preventDefault(); pick(matches[hi]); }
  };

  return (
    <div className="picker">
      <div className="search">
        <Search size={16} />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKey}
          disabled={disabled}
          placeholder={placeholder}
        />
      </div>
      {open && matches.length > 0 && (
        <ul className="picker-list">
          {matches.map((i, idx) => (
            <li key={i.id}>
              <button type="button" className={idx === hi ? 'hi' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)}>
                <span><strong>{i.name}</strong></span>
                <span className="muted small">
                  {[i.manufacturer, i.strength, i.unit].filter(Boolean).join(' · ')} · {number(i.quantity)} in stock
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- New request */

function NewRequest({ items, departments, groupNames, onSent }) {
  const toast = useToast();
  const [dept, setDept] = useState('');
  const [by, setBy] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);
  const qtyRefs = useRef({});
  const lastAdded = useRef(null);

  const exclude = useMemo(() => new Set(lines.map((l) => l.item.id)), [lines]);

  // Each department only sees the product groups it may request (only Pharmacy gets medicines)
  const department = departments.find((d) => String(d.id) === String(dept));
  const allowed = useMemo(() => new Set(department?.group_ids || []), [department]);
  const allowedItems = useMemo(() => items.filter((i) => allowed.has(i.group_id)), [items, allowed]);
  // Only departments allowed to request something are listed; with just one (Pharmacy) it is picked for you
  const requesters = departments.filter((d) => (d.group_ids ? d.group_ids.length > 0 : d.name === 'Pharmacy'));
  useEffect(() => {
    if (!dept && requesters.length === 1) setDept(String(requesters[0].id));
  }, [dept, requesters]);
  const chooseDept = (id) => {
    setDept(id);
    const next = new Set(departments.find((d) => String(d.id) === String(id))?.group_ids || []);
    const dropped = lines.filter((l) => !next.has(l.item.group_id));
    if (dropped.length) {
      setLines((ls) => ls.filter((l) => next.has(l.item.group_id)));
      toast.error(`Removed ${dropped.length} item(s) this department cannot request`);
    }
  };
  const update = (id, k, v) => setLines((ls) => ls.map((l) => (l.item.id === id ? { ...l, [k]: v } : l)));

  // Brand, strength and unit fill in from the catalogue; the cursor jumps to quantity
  const add = (item) => {
    lastAdded.current = item.id;
    setLines((ls) => [...ls, { item, quantity: 10, brand: item.manufacturer || '', strength: item.strength || '' }]);
  };
  useEffect(() => {
    const el = qtyRefs.current[lastAdded.current];
    if (el) { el.focus(); el.select(); lastAdded.current = null; }
  }, [lines]);

  const send = async () => {
    if (!dept) { toast.error('Choose the department making the request'); return; }
    if (!lines.length) { toast.error('Add at least one medicine'); return; }
    setBusy(true);
    try {
      const r = await api.post('/requests', {
        department_id: dept, requested_by: by, priority: urgent ? 'URGENT' : 'NORMAL', notes,
        items: lines.map((l) => ({ item_id: l.item.id, quantity: l.quantity, brand: l.brand, strength: l.strength })),
      });
      toast.success(`Request ${r.request_no} sent to procurement`);
      setLines([]); setNotes(''); setUrgent(false);
      onSent();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card request-form">
      <div className="card-head"><h3>New request</h3></div>
      <div className="request-top">
        <select value={dept} onChange={(e) => chooseDept(e.target.value)} aria-label="Department">
          <option value="">Department…</option>
          {requesters.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Requested by" aria-label="Requested by" />
        <ItemSearch
          items={allowedItems} exclude={exclude} onPick={add} disabled={!department}
          placeholder={department ? 'Type a medicine: name, brand or strength (e.g. para 500)…' : 'Choose your department first'}
        />
      </div>

      {lines.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr><th>Medicine</th><th>Brand</th><th>Strength</th><th>Unit</th><th className="num">In stock</th><th className="num">Quantity</th><th /></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.item.id}>
                    <td><div className="cell-title">{l.item.name}</div><div className="muted small mono">{l.item.sku}</div></td>
                    <td><input className="input-sm" value={l.brand} onChange={(e) => update(l.item.id, 'brand', e.target.value)} /></td>
                    <td><input className="input-sm input-short" value={l.strength} onChange={(e) => update(l.item.id, 'strength', e.target.value)} /></td>
                    <td className="muted">{l.item.unit}</td>
                    <td className="num muted">{number(l.item.quantity)}</td>
                    <td className="num">
                      <input
                        ref={(el) => { qtyRefs.current[l.item.id] = el; }}
                        className="input-num" type="number" min="1" value={l.quantity}
                        onChange={(e) => update(l.item.id, 'quantity', e.target.value)}
                      />
                    </td>
                    <td><button className="icon-btn danger" onClick={() => setLines((ls) => ls.filter((x) => x.item.id !== l.item.id))} aria-label="Remove"><Trash2 size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="request-foot">
            <label className="check"><input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgent</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note for procurement (optional)" />
            <button className="btn btn-primary" onClick={send} disabled={busy}>
              {busy ? <Loader2 size={16} className="spin" /> : <Send size={16} />} Send request
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------- One request in the queue */

function RequestCard({ request, suppliers, onChanged }) {
  const toast = useToast();
  const open = request.items.filter((l) => !l.po_id && l.item_id);
  const [draft, setDraft] = useState(() => Object.fromEntries(open.map((l) => [l.id, {
    supplier_id: l.default_supplier_id ? String(l.default_supplier_id) : '',
    quantity: l.quantity,
    unit_cost: '', // procurement must decide: same as old, or a new price
  }])));
  const [expected, setExpected] = useState(isoDate(7));
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const set = (id, patch) => setDraft((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  // A different vendor means a different old price, so the price decision starts again
  const chooseVendor = (line, supplierId) => set(line.id, { supplier_id: supplierId, unit_cost: '' });
  const allVendors = (supplierId) => open.forEach((l) => chooseVendor(l, supplierId));
  const allSamePrice = () => open.forEach((l) => {
    const d = draft[l.id];
    if (d?.supplier_id && !priceDecided(d.unit_cost)) set(l.id, { unit_cost: String(oldPrice(l, d.supplier_id)) });
  });

  const chosen = open.filter((l) => draft[l.id]?.supplier_id);
  const vendorCount = new Set(chosen.map((l) => draft[l.id].supplier_id)).size;
  const undecided = chosen.filter((l) => !priceDecided(draft[l.id].unit_cost)).length;
  const total = chosen.reduce((s, l) => s + (Number(draft[l.id].quantity) || 0) * (Number(draft[l.id].unit_cost) || 0), 0);
  const pending = request.status === 'PENDING';

  const place = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/requests/${request.id}/order`, {
        expected_date: expected,
        lines: chosen.map((l) => ({ request_item_id: l.id, ...draft[l.id] })),
      });
      toast.success(`Placed ${res.orders.map((o) => o.po_no).join(', ')}${res.remaining ? ` · ${res.remaining} item(s) still need a vendor` : ''}`);
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await api.post(`/requests/${request.id}/cancel`);
      toast.success(`${request.request_no} cancelled`);
      setCancelling(false);
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`card request-card ${request.priority === 'URGENT' && pending ? 'urgent' : ''}`}>
      <div className="card-head">
        <div>
          <h3>
            {request.department_name || 'No department'}
            {request.priority === 'URGENT' && <span className="badge badge-critical"><Zap size={12} /> Urgent</span>}
            {!pending && <StatusBadge status={request.status} />}
          </h3>
          <span className="muted small">
            <span className="mono">{request.request_no}</span> · {request.requested_by || '—'} · {dateTime(request.created_at)}
            {request.notes ? ` · “${request.notes}”` : ''}
          </span>
        </div>
        {pending && open.length > 1 && (
          <div className="page-actions">
          {undecided > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={allSamePrice}>Same price for all</button>}
          <select className="select-sm" value="" onChange={(e) => e.target.value && allVendors(e.target.value)} aria-label="Same vendor for all items">
            <option value="">Same vendor for all…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          </div>
        )}
      </div>

      <div className="table-wrap">
        <table className="table compact">
          <thead>
            <tr><th>Medicine</th><th className="num">In stock</th><th className="num">Qty</th><th>Vendor</th><th className="num">Old price</th><th>New price (₹)</th><th className="num">Amount</th></tr>
          </thead>
          <tbody>
            {request.items.map((l) => {
              const d = draft[l.id];
              if (!pending || !d) {
                return (
                  <tr key={l.id}>
                    <td><div className="cell-title">{l.item_name}</div><div className="muted small">{[l.brand, l.strength].filter(Boolean).join(' · ')} <span className="mono">{l.sku || 'removed from catalogue'}</span></div></td>
                    <td className="num muted">{l.in_stock === null ? '—' : number(l.in_stock)}</td>
                    <td className="num">{number(l.quantity)} <span className="muted small">{l.unit}</span></td>
                    <td colSpan={4}>
                      {l.po_no
                        ? <><Link to={`/purchase-orders/${l.po_id}`} className="mono">{l.po_no}</Link> <span className="muted small">{l.po_supplier}</span> <StatusBadge status={l.po_status} /></>
                        : <span className="muted">Not ordered</span>}
                    </td>
                  </tr>
                );
              }
              const old = oldPrice(l, d.supplier_id);
              return (
                <tr key={l.id}>
                  <td><div className="cell-title">{l.item_name}</div><div className="muted small">{[l.brand, l.strength].filter(Boolean).join(' · ')} <span className="mono">{l.sku}</span></div></td>
                  <td className="num muted">{number(l.in_stock)}</td>
                  <td className="num"><input className="input-num" type="number" min="1" value={d.quantity} onChange={(e) => set(l.id, { quantity: e.target.value })} /> <span className="muted small">{l.unit}</span></td>
                  <td><VendorSelect line={l} suppliers={suppliers} value={d.supplier_id} onChange={(v) => chooseVendor(l, v)} allowSkip /></td>
                  <td className="num muted">{d.supplier_id ? money(old) : '—'}</td>
                  <td>{d.supplier_id ? <NewPrice old={old} value={d.unit_cost} onChange={(v) => set(l.id, { unit_cost: v })} /> : <span className="muted">—</span>}</td>
                  <td className="num">{d.supplier_id && priceDecided(d.unit_cost) ? money((Number(d.quantity) || 0) * (Number(d.unit_cost) || 0)) : <span className="muted">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pending && (
        <div className="request-foot">
          <button className="btn btn-link danger" onClick={() => setCancelling(true)}><Ban size={14} /> Cancel request</button>
          <label className="inline-field">Deliver by <input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></label>
          <span className="muted foot-total">Total <strong>{money(total)}</strong></span>
          {undecided > 0 && <span className="text-warning small">Set the new price for {undecided} item{undecided === 1 ? '' : 's'}</span>}
          <button className="btn btn-primary" onClick={place} disabled={busy || !chosen.length || undecided > 0}>
            {busy ? <Loader2 size={16} className="spin" /> : <ShoppingCart size={16} />}
            {vendorCount > 1 ? ` Place ${vendorCount} orders` : ' Place order'}
          </button>
        </div>
      )}

      <Confirm
        open={cancelling}
        title="Cancel this request?"
        message={`${request.request_no} from ${request.department_name || 'this department'} will be closed without ordering.`}
        confirmLabel="Cancel request"
        busy={busy}
        onConfirm={cancel}
        onClose={() => setCancelling(false)}
      />
    </section>
  );
}

/* -------------------------------------------------------------------- Page */

export default function Requests() {
  const [status, setStatus] = useState('PENDING');
  const [deptFilter, setDeptFilter] = useState('');
  const reqs = useFetch('/requests', { status });
  const cats = useFetch('/categories');
  const pendingCount = useFetch('/requests/summary');
  const items = useFetch('/items');
  const depts = useFetch('/departments');
  const sups = useFetch('/suppliers');

  const changed = () => { reqs.reload(); pendingCount.reload(); items.reload(); requestsChanged(); };
  const rows = (reqs.data || []).filter((r) => !deptFilter || String(r.department_id) === deptFilter);
  const groupNames = useMemo(() => new Map((cats.data || []).filter((c) => !c.parent_id).map((c) => [c.id, c.name])), [cats.data]);

  return (
    <>
      <PageHeader title="Requests" />
      <NewRequest items={items.data || []} departments={depts.data || []} groupNames={groupNames} onSent={changed} />

      <div className="toolbar queue-bar">
        <div className="segmented">
          {[['PENDING', `Waiting for vendor${pendingCount.data ? ` (${pendingCount.data.pending})` : ''}`], ['ORDERED', 'Ordered'], ['CANCELLED', 'Cancelled'], ['', 'All']].map(([v, l]) => (
            <button key={v} className={status === v ? 'active' : ''} onClick={() => setStatus(v)}>{l}</button>
          ))}
        </div>
        {(depts.data || []).filter((d) => d.group_ids?.length).length > 1 && (
          <select className="select-sm" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} aria-label="Filter by department">
            <option value="">All departments</option>
            {(depts.data || []).filter((d) => d.group_ids?.length).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        <div className="toolbar-summary muted small">{rows.length} request{rows.length === 1 ? '' : 's'}</div>
      </div>

      {reqs.error ? <ErrorBox error={reqs.error} onRetry={reqs.reload} />
        : (reqs.loading && !reqs.data) || !sups.data ? <Loading />
          : rows.length === 0 ? <section className="card"><Empty title={status === 'PENDING' ? 'No requests waiting' : 'No requests'} /></section>
            : rows.map((r) => (
              <RequestCard key={`${r.id}-${r.status}-${r.items.filter((l) => l.po_id).length}`} request={r} suppliers={sups.data} onChanged={changed} />
            ))}
    </>
  );
}
