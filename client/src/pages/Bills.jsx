import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Download, ShoppingCart } from 'lucide-react';
import { useFetch, PageHeader, Loading, ErrorBox, Empty, StatusBadge } from '../components/ui';
import { money, dateTime, downloadCSV } from '../utils';

export default function Bills() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ q: '', department_id: '', status: '', from: '', to: '' });
  const bills = useFetch('/bills', filters);
  const depts = useFetch('/departments');
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  const rows = bills.data || [];
  const completed = rows.filter((b) => b.status === 'COMPLETED');
  const sum = completed.reduce((s, b) => s + b.total, 0);

  const exportCsv = () => downloadCSV('bills.csv', rows, [
    { label: 'Bill no', value: 'bill_no' }, { label: 'Date', value: (r) => new Date(r.created_at).toISOString() },
    { label: 'Department', value: 'department_name' }, { label: 'Requested by', value: 'requested_by' },
    { label: 'Patient/ref', value: 'patient_ref' }, { label: 'Lines', value: 'line_count' },
    { label: 'Subtotal', value: 'subtotal' }, { label: 'GST', value: 'tax_total' }, { label: 'Discount', value: 'discount' },
    { label: 'Total', value: 'total' }, { label: 'Status', value: 'status' },
  ]);

  return (
    <>
      <PageHeader
        title="Bills"
        actions={(
          <>
            <button className="btn btn-ghost" onClick={exportCsv} disabled={!rows.length}><Download size={17} /> Export</button>
            <Link to="/billing" className="btn btn-primary"><ShoppingCart size={17} /> New Bill</Link>
          </>
        )}
      />
      <section className="card">
        <div className="toolbar wrap">
          <div className="search">
            <Search size={16} />
            <input value={filters.q} onChange={set('q')} placeholder="Bill no, requester, patient ref…" />
          </div>
          <select className="select-sm" value={filters.department_id} onChange={set('department_id')}>
            <option value="">All departments</option>
            {(depts.data || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select className="select-sm" value={filters.status} onChange={set('status')}>
            <option value="">Any status</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <label className="inline-field">From <input type="date" value={filters.from} onChange={set('from')} /></label>
          <label className="inline-field">To <input type="date" value={filters.to} onChange={set('to')} /></label>
          <div className="toolbar-summary muted small">{rows.length} bills · {money(sum)} completed</div>
        </div>
        {bills.error ? <ErrorBox error={bills.error} onRetry={bills.reload} /> : bills.loading && !bills.data ? <Loading /> : rows.length === 0 ? <Empty title="No bills found" /> : (
          <div className="table-wrap">
            <table className="table hover">
              <thead>
                <tr><th>Bill no.</th><th>Date</th><th>Department</th><th>Requested by</th><th className="num">Lines</th><th className="num">Total</th><th>Status</th></tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} onClick={() => navigate(`/bills/${b.id}`)} className="clickable">
                    <td className="mono"><Link to={`/bills/${b.id}`}>{b.bill_no}</Link></td>
                    <td className="muted">{dateTime(b.created_at)}</td>
                    <td>{b.department_name || '—'}</td>
                    <td className="muted">{b.requested_by || '—'}{b.patient_ref ? ` · ${b.patient_ref}` : ''}</td>
                    <td className="num">{b.line_count}</td>
                    <td className="num"><strong>{money(b.total)}</strong></td>
                    <td><StatusBadge status={b.status} /></td>
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
