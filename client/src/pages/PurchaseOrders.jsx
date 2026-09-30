import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useFetch, PageHeader, Loading, ErrorBox, Empty, StatusBadge } from '../components/ui';
import { money, date, dateTime } from '../utils';

export default function PurchaseOrders() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const pos = useFetch('/purchase-orders', { status });
  const rows = pos.data || [];

  return (
    <>
      <PageHeader
        title="All orders"
        actions={<Link to="/restock" className="btn btn-primary"><Plus size={17} /> Restock</Link>}
      />
      <section className="card">
        <div className="toolbar">
          <div className="segmented">
            {[['', 'All'], ['OPEN', 'Open'], ['RECEIVED', 'Received'], ['CANCELLED', 'Cancelled']].map(([v, l]) => (
              <button key={v} className={status === v ? 'active' : ''} onClick={() => setStatus(v)}>{l}</button>
            ))}
          </div>
          <div className="toolbar-summary muted small">{rows.length} orders · {money(rows.reduce((s, p) => s + p.total, 0))}</div>
        </div>
        {pos.error ? <ErrorBox error={pos.error} onRetry={pos.reload} /> : pos.loading && !pos.data ? <Loading /> : rows.length === 0 ? <Empty title="No purchase orders" /> : (
          <div className="table-wrap">
            <table className="table hover">
              <thead><tr><th>PO no.</th><th>Vendor</th><th>For</th><th>Created</th><th>Expected</th><th className="num">Lines</th><th className="num">Total</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => navigate(`/purchase-orders/${p.id}`)}>
                    <td className="mono"><Link to={`/purchase-orders/${p.id}`}>{p.po_no}</Link></td>
                    <td>{p.supplier_name || '—'}</td>
                    <td className="muted">{p.request_no ? <>{p.department_name} <span className="mono small">{p.request_no}</span></> : 'Restock'}</td>
                    <td className="muted">{dateTime(p.created_at)}</td>
                    <td className="muted">{date(p.expected_date)}</td>
                    <td className="num">{p.line_count}</td>
                    <td className="num"><strong>{money(p.total)}</strong></td>
                    <td><StatusBadge status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
