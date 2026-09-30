import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Printer, PackageCheck, Ban, CheckCheck, Truck } from 'lucide-react';
import { api } from '../api';
import { useToast } from '../context';
import { useFetch, Loading, ErrorBox, StatusBadge, Confirm } from '../components/ui';
import { DocHeader } from './BillView';
import { money, number, date, dateTime } from '../utils';

export default function PurchaseOrderView() {
  const { id } = useParams();
  const toast = useToast();
  const po = useFetch(`/purchase-orders/${id}`);
  const [action, setAction] = useState(null);
  const [busy, setBusy] = useState(false);

  const DONE = { confirm: 'Confirmed by vendor', dispatch: 'Marked on the way', receive: 'Goods received — stock updated', cancel: 'Order cancelled' };
  const run = async (act = action) => {
    setBusy(true);
    try {
      await api.post(`/purchase-orders/${id}/${act}`);
      toast.success(DONE[act]);
      setAction(null);
      po.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (po.error) return <ErrorBox error={po.error} onRetry={po.reload} />;
  if (!po.data) return <Loading />;
  const p = po.data;
  const open = ['PENDING', 'CONFIRMED', 'DISPATCHED'].includes(p.status);

  return (
    <>
      <div className="page-header no-print">
        <Link to="/" className="btn btn-ghost"><ArrowLeft size={17} /> Order tracker</Link>
        <div className="page-actions">
          {open && <button className="btn btn-ghost danger" onClick={() => setAction('cancel')} disabled={busy}><Ban size={17} /> Cancel order</button>}
          {p.status === 'PENDING' && <button className="btn btn-ghost" onClick={() => run('confirm')} disabled={busy}><CheckCheck size={17} /> Vendor confirmed</button>}
          {(p.status === 'PENDING' || p.status === 'CONFIRMED') && <button className="btn btn-ghost" onClick={() => run('dispatch')} disabled={busy}><Truck size={17} /> On the way</button>}
          {open && <button className="btn btn-success" onClick={() => run('receive')} disabled={busy}><PackageCheck size={17} /> Received</button>}
          <button className="btn btn-primary" onClick={() => window.print()}><Printer size={17} /> Print</button>
        </div>
      </div>

      <article className="card doc print-area">
        <DocHeader title="Purchase Order" number={p.po_no}><StatusBadge status={p.status} /></DocHeader>
        <div className="doc-meta">
          <div>
            <span className="muted small">Vendor</span>
            <strong>{p.supplier_name || '—'}</strong>
            {p.supplier_address && <span className="muted">{p.supplier_address}</span>}
            {p.supplier_gst && <span className="muted mono small">GSTIN {p.supplier_gst}</span>}
          </div>
          <div>
            <span className="muted small">Contact</span>
            <strong>{p.supplier_contact || '—'}</strong>
            {p.supplier_phone && <span className="muted">{p.supplier_phone}</span>}
            {p.supplier_email && <span className="muted">{p.supplier_email}</span>}
          </div>
          <div>
            <span className="muted small">Dates</span>
            <strong>Ordered {dateTime(p.created_at)}</strong>
            <span className="muted">Expected {date(p.expected_date)}</span>
            {p.confirmed_at && <span className="muted">Confirmed {dateTime(p.confirmed_at)}</span>}
            {p.dispatched_at && <span className="muted">Dispatched {dateTime(p.dispatched_at)}</span>}
            {p.request_no && <span className="muted">For {p.department_name} · <span className="mono">{p.request_no}</span></span>}
            {p.received_at && <span className="text-good">Received {dateTime(p.received_at)}</span>}
          </div>
        </div>
        <div className="table-wrap">
          <table className="table doc-table">
            <thead><tr><th>#</th><th>Item</th><th className="num">Qty</th><th className="num">Unit cost</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {p.items.map((l, i) => (
                <tr key={l.id}>
                  <td className="muted">{i + 1}</td>
                  <td><div className="cell-title">{l.item_name}</div><div className="muted small mono">{l.sku || '—'}</div></td>
                  <td className="num">{number(l.quantity)} {l.unit}</td>
                  <td className="num">{money(l.unit_cost)}</td>
                  <td className="num"><strong>{money(l.line_total)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="doc-foot">
          <div className="doc-notes">
            {p.notes && (<><span className="muted small">Notes</span><p>{p.notes}</p></>)}
            <div className="signatures"><div>Prepared by</div><div>Authorised signatory</div></div>
          </div>
          <div className="bill-summary doc-summary">
            <div className="bill-total"><span>Order total</span><span>{money(p.total)}</span></div>
          </div>
        </div>
      </article>

      <Confirm
        open={action === 'cancel'}
        title="Cancel this order?"
        message={p.request_no
          ? `The order will be cancelled and its items go back to request ${p.request_no} so another vendor can be chosen.`
          : 'The order will be marked cancelled. Stock will not change.'}
        confirmLabel="Cancel order"
        busy={busy}
        onConfirm={() => run()}
        onClose={() => setAction(null)}
      />
    </>
  );
}
