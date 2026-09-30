import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Printer, Ban, Loader2, CheckCircle2 } from 'lucide-react';
import { api } from '../api';
import { useToast } from '../context';
import { useFetch, Loading, ErrorBox, StatusBadge, Modal, Field } from '../components/ui';
import { money, number, dateTime, asset } from '../utils';

export function DocHeader({ title, number: docNo, children }) {
  return (
    <div className="doc-head">
      <div className="doc-brand">
        <img src={asset('logo.png')} alt="" width="46" height="46" />
        <div>
          <strong>Shri Health Procurement Centre</strong>
          <span>Pharmacy Procurement · Medicines</span>
        </div>
      </div>
      <div className="doc-title">
        <h2>{title}</h2>
        <div className="mono">{docNo}</div>
        {children}
      </div>
    </div>
  );
}

export default function BillView() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const bill = useFetch(`/bills/${id}`);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [justCreated, setJustCreated] = useState(false);

  // Coming straight from billing: show a confirmation with a print shortcut
  useEffect(() => {
    if (params.get('print') === '1') {
      setJustCreated(true);
      params.delete('print');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const cancel = async () => {
    setBusy(true);
    try {
      await api.post(`/bills/${id}/cancel`, { reason });
      toast.success('Bill cancelled — stock returned to inventory');
      setCancelOpen(false);
      bill.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (bill.error) return <ErrorBox error={bill.error} onRetry={bill.reload} />;
  if (!bill.data) return <Loading />;
  const b = bill.data;

  return (
    <>
      <div className="page-header no-print">
        <Link to="/bills" className="btn btn-ghost"><ArrowLeft size={17} /> All bills</Link>
        <div className="page-actions">
          {b.status === 'COMPLETED' && (
            <button className="btn btn-ghost danger" onClick={() => setCancelOpen(true)}><Ban size={17} /> Cancel bill</button>
          )}
          <button className="btn btn-primary" onClick={() => window.print()}><Printer size={17} /> Print</button>
        </div>
      </div>

      {justCreated && b.status === 'COMPLETED' && (
        <div className="callout callout-success no-print">
          <CheckCircle2 size={18} />
          <div><strong>Bill generated.</strong> Stock for all {b.items.length} item(s) has been deducted from inventory.</div>
          <button className="btn btn-sm btn-primary" onClick={() => window.print()}><Printer size={15} /> Print now</button>
        </div>
      )}

      <article className="card doc print-area">
        <DocHeader title="Stock Issue Bill" number={b.bill_no}>
          <StatusBadge status={b.status} />
        </DocHeader>

        <div className="doc-meta">
          <div>
            <span className="muted small">Issued to</span>
            <strong>{b.department_name || '—'}</strong>
            {b.department_location && <span className="muted">{b.department_location}</span>}
            {b.department_head && <span className="muted">Head: {b.department_head}</span>}
          </div>
          <div>
            <span className="muted small">Requested by</span>
            <strong>{b.requested_by || '—'}</strong>
            {b.patient_ref && <span className="muted">Patient / Ref: {b.patient_ref}</span>}
          </div>
          <div>
            <span className="muted small">Date</span>
            <strong>{dateTime(b.created_at)}</strong>
            {b.cancelled_at && <span className="text-critical">Cancelled {dateTime(b.cancelled_at)}</span>}
          </div>
        </div>

        <div className="table-wrap">
          <table className="table doc-table">
            <thead>
              <tr><th>#</th><th>Item</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">GST</th><th className="num">Amount</th></tr>
            </thead>
            <tbody>
              {b.items.map((l, idx) => (
                <tr key={l.id}>
                  <td className="muted">{idx + 1}</td>
                  <td><div className="cell-title">{l.item_name}</div><div className="muted small mono">{l.sku}</div></td>
                  <td className="num">{number(l.quantity)} {l.unit}</td>
                  <td className="num">{money(l.unit_price)}</td>
                  <td className="num">{l.gst_rate}%<div className="muted small">{money(l.tax_amount)}</div></td>
                  <td className="num"><strong>{money(l.line_total)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="doc-foot">
          <div className="doc-notes">
            {b.notes && (<><span className="muted small">Notes</span><p>{b.notes}</p></>)}
            <div className="signatures">
              <div>Issued by (Stores)</div>
              <div>Received by</div>
            </div>
          </div>
          <div className="bill-summary doc-summary">
            <div><span>Subtotal</span><span>{money(b.subtotal)}</span></div>
            <div><span>GST</span><span>{money(b.tax_total)}</span></div>
            {b.discount > 0 && <div><span>Discount</span><span>− {money(b.discount)}</span></div>}
            <div className="bill-total"><span>Total</span><span>{money(b.total)}</span></div>
          </div>
        </div>
      </article>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        size="sm"
        title={`Cancel ${b.bill_no}?`}
        footer={(
          <>
            <button className="btn btn-ghost" onClick={() => setCancelOpen(false)}>Keep bill</button>
            <button className="btn btn-danger" onClick={cancel} disabled={busy}>{busy && <Loader2 size={16} className="spin" />} Cancel bill</button>
          </>
        )}
      >
        <p>All {b.items.length} item(s) on this bill will be returned to stock.</p>
        <Field label="Reason">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong department, items returned" autoFocus />
        </Field>
      </Modal>
    </>
  );
}
