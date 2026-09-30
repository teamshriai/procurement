import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Inbox, ClipboardCheck, Clock, Truck, AlertTriangle, AlarmClock, Siren, CheckCheck, PackageCheck, Loader2, Plus, ClipboardList,
} from 'lucide-react';
import { api } from '../api';
import { useToast } from '../context';
import { useFetch, PageHeader, Loading, ErrorBox, Empty, StatusBadge } from '../components/ui';
import { money, number, date, dateTime } from '../utils';

// Each box is filled with the colour of what it means
const TILES = [
  { key: 'requests', label: 'New requests', icon: Inbox, fill: 'blue', to: '/requests',
    sub: (c) => (c.urgentRequests ? `${c.urgentRequests} urgent · waiting for a vendor` : 'waiting for a vendor') },
  { key: 'open', label: 'Orders placed', icon: ClipboardCheck, fill: 'navy', sub: () => 'all open orders' },
  { key: 'pending', label: 'Yet to be confirmed', icon: Clock, fill: 'violet', sub: () => 'vendor has not confirmed' },
  { key: 'dispatched', label: 'On the way', icon: Truck, fill: 'teal', sub: () => 'dispatched by vendor' },
  { key: 'received', label: 'Delivered', icon: PackageCheck, fill: 'green', sub: () => 'received in the last 30 days' },
  { key: 'warning', label: 'Delay warning', icon: AlertTriangle, fill: 'amber', sub: () => 'up to 9 days late, or due in 2 days' },
  { key: 'delayed10', label: 'Delayed 10+ days', icon: AlarmClock, fill: 'orange', sub: () => '10 to 19 days late' },
  { key: 'delayed20', label: 'Delayed 20+ days', icon: Siren, fill: 'red', sub: () => '20 or more days late' },
];

const FILTERS = {
  open: () => true,
  received: () => true,
  pending: (o) => o.status === 'PENDING',
  dispatched: (o) => o.status === 'DISPATCHED',
  warning: (o) => o.delay === 'warning',
  delayed10: (o) => o.delay === 'delayed10',
  delayed20: (o) => o.delay === 'delayed20',
};

// The one next step for an open order
const NEXT = {
  PENDING: { action: 'confirm', label: 'Confirm', icon: CheckCheck, cls: 'btn-ghost', done: 'confirmed by vendor' },
  CONFIRMED: { action: 'dispatch', label: 'On the way', icon: Truck, cls: 'btn-ghost', done: 'marked on the way' },
  DISPATCHED: { action: 'receive', label: 'Received', icon: PackageCheck, cls: 'btn-success', done: 'received and added to stock' },
};

function DelayCell({ o }) {
  const d = o.days_late;
  let chip = null;
  if (d === null) chip = <span className="muted small">No date</span>;
  else if (d > 0) chip = <span className={`badge ${o.delay === 'warning' ? 'badge-warning' : 'badge-critical'}`}>{d} day{d === 1 ? '' : 's'} late</span>;
  else if (d === 0) chip = <span className={`badge ${o.delay ? 'badge-warning' : 'badge-info'}`}>Due today</span>;
  else if (o.delay) chip = <span className="badge badge-warning">Due in {-d} day{d === -1 ? '' : 's'}</span>;
  else chip = <span className="badge badge-good">On time</span>;
  return <>{chip}<div className="muted small">Expected {date(o.expected_date)}</div></>;
}

export default function Home() {
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const show = FILTERS[params.get('show')] ? params.get('show') : 'open';
  const { data, error, reload } = useFetch('/tracker');
  const [busy, setBusy] = useState(null);

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;

  const { counts, orders, received = [] } = data;
  const rows = show === 'received' ? received : orders.filter(FILTERS[show]);
  const tile = TILES.find((t) => t.key === show);

  const advance = async (e, o) => {
    e.stopPropagation();
    const next = NEXT[o.status];
    setBusy(o.id);
    try {
      await api.post(`/purchase-orders/${o.id}/${next.action}`);
      toast.success(`${o.po_no} ${next.done}`);
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Order tracker"
        actions={(
          <>
            <Link to="/restock" className="btn btn-ghost"><Plus size={17} /> Restock</Link>
            <Link to="/requests" className="btn btn-primary"><ClipboardList size={17} /> New request</Link>
          </>
        )}
      />

      <div className="tiles tiles-4">
        {TILES.map((t) => {
          const Icon = t.icon;
          const body = (
            <>
              <div className="stat-icon"><Icon size={20} /></div>
              <div className="stat-body">
                <span className="stat-label">{t.label}</span>
                <strong className="stat-value">{number(counts[t.key] ?? 0)}</strong>
                <span className="stat-sub">{t.sub(counts)}</span>
              </div>
            </>
          );
          const cls = `card stat tile tile-fill fill-${t.fill} ${show === t.key ? 'active' : ''}`;
          return t.to ? (
            <Link key={t.key} to={t.to} className={cls}>{body}</Link>
          ) : (
            <button key={t.key} type="button" className={cls} onClick={() => setParams(t.key === 'open' ? {} : { show: t.key })}>
              {body}
            </button>
          );
        })}
      </div>

      <section className="card">
        <div className="card-head">
          <h3>{tile.label} <span className="muted small">{rows.length} order{rows.length === 1 ? '' : 's'}</span></h3>
          {show !== 'open' && <button className="btn btn-link" onClick={() => setParams({})}>Show all open orders</button>}
        </div>
        {rows.length === 0 ? <Empty title="No orders here" /> : (
          <div className="table-wrap">
            <table className="table hover">
              <thead>
                <tr><th>Order</th><th>Vendor</th><th>For</th><th>Delivery</th><th>Status</th><th className="num">Value</th><th className="num">Next step</th></tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const next = NEXT[o.status];
                  const Icon = next?.icon;
                  return (
                    <tr key={o.id} className="clickable" onClick={() => navigate(`/purchase-orders/${o.id}`)}>
                      <td><div className="cell-title mono">{o.po_no}</div><div className="muted small">{o.line_count} item{o.line_count === 1 ? '' : 's'}</div></td>
                      <td><div>{o.supplier_name || '—'}</div>{o.supplier_phone && <div className="muted small">{o.supplier_phone}</div>}</td>
                      <td>{o.request_no
                        ? <><div>{o.department_name || '—'}</div><div className="muted small mono">{o.request_no}</div></>
                        : <span className="muted">Restock</span>}
                      </td>
                      <td>{o.status === 'RECEIVED'
                        ? <><span className="badge badge-good">Delivered</span><div className="muted small">{dateTime(o.received_at)}</div></>
                        : <DelayCell o={o} />}
                      </td>
                      <td><StatusBadge status={o.status} /></td>
                      <td className="num"><strong>{money(o.total)}</strong></td>
                      <td className="num">
                        {next && <button className={`btn btn-sm ${next.cls}`} onClick={(e) => advance(e, o)} disabled={busy === o.id}>
                          {busy === o.id ? <Loader2 size={15} className="spin" /> : <Icon size={15} />} {next.label}
                        </button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
