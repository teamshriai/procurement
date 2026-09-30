import { useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Download, Truck } from 'lucide-react';
import { useFetch, PageHeader, Loading, ErrorBox, Empty, StockBadge } from '../components/ui';
import { BarList } from '../components/charts';
import Overview from './Dashboard';
import { categoryTree, money, moneyShort, number, date, daysUntil, downloadCSV } from '../utils';

const TABS = [
  ['overview', 'Overview'],
  ['reorder', 'Reorder list'],
  ['expiry', 'Expiry watch'],
  ['valuation', 'Stock valuation'],
  ['departments', 'Department consumption'],
];

export default function Reports() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';
  const items = useFetch('/items');
  const cats = useFetch('/categories');
  const depts = useFetch('/departments');

  const reorder = useMemo(() => (items.data || [])
    .filter((i) => i.quantity <= i.reorder_level)
    .map((i) => ({ ...i, suggested: Math.max(i.reorder_level * 2 - i.quantity, 1) }))
    .sort((a, b) => a.quantity / (a.reorder_level || 1) - b.quantity / (b.reorder_level || 1)), [items.data]);

  const expiry = useMemo(() => (items.data || [])
    .filter((i) => i.expiry_date && daysUntil(i.expiry_date) <= 90)
    .map((i) => ({ ...i, days: daysUntil(i.expiry_date) }))
    .sort((a, b) => a.days - b.days), [items.data]);

  const tree = useMemo(() => categoryTree(cats.data || []).sort((a, b) => b.stock_value_total - a.stock_value_total), [cats.data]);

  const loading = (items.loading && !items.data) || (cats.loading && !cats.data);
  const error = items.error || cats.error;

  const exportTab = () => {
    const d = new Date().toISOString().slice(0, 10);
    if (tab === 'reorder') {
      downloadCSV(`reorder-${d}.csv`, reorder, [
        { label: 'SKU', value: 'sku' }, { label: 'Item', value: 'name' }, { label: 'Category', value: 'category_name' },
        { label: 'Supplier', value: 'supplier_name' }, { label: 'On hand', value: 'quantity' }, { label: 'Reorder level', value: 'reorder_level' },
        { label: 'Suggested order', value: 'suggested' }, { label: 'Unit', value: 'unit' }, { label: 'Est. cost', value: (r) => (r.suggested * r.price).toFixed(2) },
      ]);
    } else if (tab === 'expiry') {
      downloadCSV(`expiry-${d}.csv`, expiry, [
        { label: 'SKU', value: 'sku' }, { label: 'Item', value: 'name' }, { label: 'Batch', value: 'batch_no' },
        { label: 'Expiry', value: 'expiry_date' }, { label: 'Days left', value: 'days' }, { label: 'Quantity', value: 'quantity' },
        { label: 'Value at risk', value: (r) => (r.quantity * r.price).toFixed(2) },
      ]);
    } else if (tab === 'valuation') {
      const rows = tree.flatMap((g) => g.children.map((c) => ({ group: g.name, ...c })));
      downloadCSV(`valuation-${d}.csv`, rows, [
        { label: 'Group', value: 'group' }, { label: 'Category', value: 'name' }, { label: 'Items', value: 'item_count' },
        { label: 'Units', value: 'units' }, { label: 'Value', value: (r) => r.stock_value.toFixed(2) },
      ]);
    } else {
      downloadCSV(`department-consumption-${d}.csv`, depts.data || [], [
        { label: 'Department', value: 'name' }, { label: 'Bills', value: 'bill_count' }, { label: 'Total issued', value: 'total_value' },
      ]);
    }
  };

  const totalValue = tree.reduce((s, g) => s + g.stock_value_total, 0);
  const reorderCost = reorder.reduce((s, i) => s + i.suggested * i.price, 0);
  const atRisk = expiry.reduce((s, i) => s + i.quantity * i.price, 0);

  return (
    <>
      <PageHeader
        title="Reports"
        actions={tab !== 'overview' && <button className="btn btn-ghost" onClick={exportTab}><Download size={17} /> Export this report</button>}
      />
      <div className="tabs">
        {TABS.map(([k, l]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setParams({ tab: k })}>{l}</button>
        ))}
      </div>

      {tab === 'overview' ? <Overview /> : error ? <ErrorBox error={error} /> : loading ? <Loading /> : (
        <section className="card">
          {tab === 'reorder' && (
            <>
              <div className="card-head">
                <div>
                  <h3>{reorder.length} items at or below reorder level</h3>
                  <span className="muted small">Suggested order brings stock to twice the reorder level · estimated cost {money(reorderCost)}</span>
                </div>
                <Link to="/restock" className="btn btn-primary btn-sm"><Truck size={15} /> Restock these</Link>
              </div>
              {reorder.length === 0 ? <Empty title="Nothing to reorder" /> : (
                <div className="table-wrap">
                  <table className="table compact">
                    <thead><tr><th>Item</th><th>Supplier</th><th className="num">On hand</th><th className="num">Reorder at</th><th className="num">Suggested</th><th className="num">Est. cost</th><th>Status</th></tr></thead>
                    <tbody>
                      {reorder.map((i) => (
                        <tr key={i.id}>
                          <td><div className="cell-title">{i.name}</div><div className="muted small"><span className="mono">{i.sku}</span> · {i.category_name}</div></td>
                          <td className="muted">{i.supplier_name || '—'}</td>
                          <td className="num"><strong>{number(i.quantity)}</strong> <span className="muted small">{i.unit}</span></td>
                          <td className="num muted">{number(i.reorder_level)}</td>
                          <td className="num"><strong>{number(i.suggested)}</strong></td>
                          <td className="num">{money(i.suggested * i.price)}</td>
                          <td><StockBadge item={i} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {tab === 'expiry' && (
            <>
              <div className="card-head">
                <div>
                  <h3>{expiry.length} batches expiring within 90 days</h3>
                  <span className="muted small">Value at risk {money(atRisk)}. Issue these first, or return them to the supplier.</span>
                </div>
              </div>
              {expiry.length === 0 ? <Empty title="No batches expiring soon" /> : (
                <div className="table-wrap">
                  <table className="table compact">
                    <thead><tr><th>Item</th><th>Batch</th><th>Expiry</th><th className="num">Days left</th><th className="num">Qty</th><th className="num">Value at risk</th></tr></thead>
                    <tbody>
                      {expiry.map((i) => (
                        <tr key={i.id}>
                          <td><div className="cell-title">{i.name}</div><div className="muted small mono">{i.sku}</div></td>
                          <td className="mono small">{i.batch_no || '—'}</td>
                          <td>{date(i.expiry_date)}</td>
                          <td className="num"><span className={`chip ${i.days < 0 ? 'chip-critical' : i.days <= 30 ? 'chip-critical' : 'chip-warning'}`}>{i.days < 0 ? 'Expired' : `${i.days} days`}</span></td>
                          <td className="num">{number(i.quantity)} <span className="muted small">{i.unit}</span></td>
                          <td className="num">{money(i.quantity * i.price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {tab === 'valuation' && (
            <>
              <div className="card-head">
                <div><h3>Inventory value {money(totalValue)}</h3><span className="muted small">Quantity on hand × current unit price, by group</span></div>
              </div>
              <div className="grid-2 inner">
                <BarList data={tree.map((g) => ({ name: g.name, value: g.stock_value_total }))} valueFormat={moneyShort} />
                <div className="table-wrap">
                  <table className="table compact">
                    <thead><tr><th>Group / category</th><th className="num">Items</th><th className="num">Units</th><th className="num">Value</th></tr></thead>
                    {tree.map((g) => (
                      <tbody key={g.id}>
                        <tr className="section-row"><td>{g.name}</td><td className="num">{g.item_count_total}</td><td className="num">{number(g.units_total)}</td><td className="num">{money(g.stock_value_total)}</td></tr>
                        {g.children.map((c) => (
                          <tr key={c.id}><td className="indent">{c.name}</td><td className="num muted">{c.item_count}</td><td className="num muted">{number(c.units)}</td><td className="num">{money(c.stock_value)}</td></tr>
                        ))}
                      </tbody>
                    ))}
                  </table>
                </div>
              </div>
            </>
          )}

          {tab === 'departments' && (
            <>
              <div className="card-head"><div><h3>Consumption by department</h3><span className="muted small">All completed bills</span></div></div>
              <div className="grid-2 inner">
                <BarList data={[...(depts.data || [])].sort((a, b) => b.total_value - a.total_value).map((d) => ({ name: d.name, value: d.total_value }))} valueFormat={moneyShort} />
                <div className="table-wrap">
                  <table className="table compact">
                    <thead><tr><th>Department</th><th className="num">Bills</th><th className="num">Total issued</th><th className="num">Avg / bill</th></tr></thead>
                    <tbody>
                      {[...(depts.data || [])].sort((a, b) => b.total_value - a.total_value).map((d) => (
                        <tr key={d.id}>
                          <td>{d.name}</td>
                          <td className="num">{d.bill_count}</td>
                          <td className="num"><strong>{money(d.total_value)}</strong></td>
                          <td className="num muted">{d.bill_count ? money(d.total_value / d.bill_count) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
