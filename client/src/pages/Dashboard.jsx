import { Link } from 'react-router-dom';
import {
  Boxes, IndianRupee, AlertTriangle, ReceiptText, Truck, CalendarClock, ArrowRight,
} from 'lucide-react';
import { useFetch, Loading, ErrorBox, StatusBadge, Empty } from '../components/ui';
import { BarList, ColumnChart } from '../components/charts';
import { money, moneyShort, number, dateTime } from '../utils';

function Stat({ icon: Icon, label, value, sub, to, tone }) {
  const body = (
    <>
      <div className={`stat-icon ${tone ? `tone-${tone}` : ''}`}><Icon size={20} /></div>
      <div className="stat-body">
        <span className="stat-label">{label}</span>
        <strong className="stat-value">{value}</strong>
        {sub && <span className="stat-sub">{sub}</span>}
      </div>
    </>
  );
  return to ? <Link to={to} className="card stat">{body}</Link> : <div className="card stat">{body}</div>;
}

export default function Overview() {
  const { data, loading, error, reload } = useFetch('/dashboard');

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const { totals, bills, purchaseOrders, consumptionByGroup, daily, departments, topItems, lowStock, recentBills } = data;

  return (
    <>
      <div className="stats-grid">
        <Stat icon={Boxes} label="Items in catalogue" value={number(totals.items)} sub={`${number(totals.units)} units on hand`} to="/inventory" />
        <Stat icon={IndianRupee} label="Inventory value" value={moneyShort(totals.stock_value)} sub="at current prices" to="/reports?tab=valuation" />
        <Stat icon={ReceiptText} label="Issued this month" value={moneyShort(bills.month_value)} sub={`${bills.month_count} bills · today ${moneyShort(bills.today_value)}`} to="/bills" />
        <Stat icon={AlertTriangle} tone="warning" label="Reorder needed" value={number(totals.low_stock + totals.out_of_stock)} sub={`${totals.out_of_stock} out of stock · ${totals.low_stock} low`} to="/reports?tab=reorder" />
        <Stat icon={CalendarClock} tone="critical" label="Expiring ≤ 90 days" value={number(totals.expiring)} sub="batches to review" to="/reports?tab=expiry" />
        <Stat icon={Truck} label="Open purchase orders" value={number(purchaseOrders.open_count)} sub={`${moneyShort(purchaseOrders.open_value)} pending receipt`} to="/" />
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h3>Daily issue value</h3>
            <span className="muted small">Last 14 days</span>
          </div>
          <ColumnChart
            data={daily}
            x="day"
            y="value"
            xFormat={(d, i, full) => {
              const dt = new Date(`${d}T00:00:00`);
              if (full) return dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
              return i % 2 === 0 || i === daily.length - 1 ? dt.getDate() : '';
            }}
            yFormat={(v, full) => (full ? money(v) : moneyShort(v))}
            tooltipExtra={(d) => `${d.bills} bill${d.bills === 1 ? '' : 's'}`}
          />
        </section>
        <section className="card">
          <div className="card-head">
            <h3>Consumption by group</h3>
            <span className="muted small">Last 30 days, issue value</span>
          </div>
          <BarList data={consumptionByGroup.slice(0, 7)} valueFormat={moneyShort} />
        </section>
      </div>

      <div className="grid-3">
        <section className="card span-2">
          <div className="card-head">
            <h3>Needs reordering</h3>
            <Link to="/reports?tab=reorder" className="link">Reorder report <ArrowRight size={14} /></Link>
          </div>
          {lowStock.length === 0 ? <Empty title="All items are above reorder level" /> : (
            <div className="table-wrap">
              <table className="table compact">
                <thead><tr><th>Item</th><th>Category</th><th className="num">On hand</th><th className="num">Reorder at</th><th /></tr></thead>
                <tbody>
                  {lowStock.map((i) => (
                    <tr key={i.id}>
                      <td><div className="cell-title">{i.name}</div><div className="muted small mono">{i.sku}</div></td>
                      <td className="muted">{i.category}</td>
                      <td className="num"><strong className={i.quantity === 0 ? 'text-critical' : 'text-warning'}>{number(i.quantity)}</strong> <span className="muted small">{i.unit}</span></td>
                      <td className="num muted">{number(i.reorder_level)}</td>
                      <td className="num"><div className="stock-meter"><div style={{ width: `${Math.min((i.quantity / (i.reorder_level || 1)) * 100, 100)}%` }} /></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="card">
          <div className="card-head"><h3>Department spend</h3><span className="muted small">30 days</span></div>
          <BarList data={departments} valueFormat={moneyShort} />
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h3>Recent bills</h3>
            <Link to="/bills" className="link">All bills <ArrowRight size={14} /></Link>
          </div>
          {recentBills.length === 0 ? <Empty title="No bills yet" /> : (
            <ul className="list">
              {recentBills.map((b) => (
                <li key={b.id}>
                  <Link to={`/bills/${b.id}`} className="list-row">
                    <div>
                      <div className="cell-title mono">{b.bill_no}</div>
                      <div className="muted small">{b.department || '—'} · {dateTime(b.created_at)}</div>
                    </div>
                    <div className="list-right">
                      <strong>{money(b.total)}</strong>
                      <StatusBadge status={b.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <div className="card-head"><h3>Most issued items</h3><span className="muted small">30 days, by value</span></div>
          <BarList data={topItems} valueFormat={moneyShort} />
        </section>
      </div>
    </>
  );
}
