import { useEffect, useState } from 'react';
import { Search, Download } from 'lucide-react';
import { useFetch, PageHeader, Loading, ErrorBox, Empty } from '../components/ui';
import { movementLabel } from '../components/ItemModals';
import { number, dateTime, downloadCSV } from '../utils';

const TYPES = ['OPENING', 'ADJUSTMENT', 'ISSUE', 'ISSUE_CANCEL', 'PURCHASE'];

function refLink(ref) {
  if (!ref) return '—';
  return <span className="mono small">{ref}</span>;
}

export default function StockLedger() {
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const moves = useFetch('/movements', { type, q: debounced, limit: 500 });
  const rows = moves.data || [];

  const exportCsv = () => downloadCSV('stock-ledger.csv', rows, [
    { label: 'Date', value: (r) => new Date(r.created_at).toISOString() }, { label: 'SKU', value: 'sku' },
    { label: 'Item', value: 'item_name' }, { label: 'Type', value: (r) => movementLabel(r.type) },
    { label: 'Change', value: 'change' }, { label: 'Balance', value: 'balance_after' },
    { label: 'Reference', value: 'reference' }, { label: 'Note', value: 'note' },
  ]);

  return (
    <>
      <PageHeader
        title="Stock Ledger"
        actions={<button className="btn btn-ghost" onClick={exportCsv} disabled={!rows.length}><Download size={17} /> Export</button>}
      />
      <section className="card">
        <div className="toolbar">
          <div className="search"><Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Item name or reference (bill / PO no.)…" /></div>
          <select className="select-sm" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All movement types</option>
            {TYPES.map((t) => <option key={t} value={t}>{movementLabel(t)}</option>)}
          </select>
          <div className="toolbar-summary muted small">Showing latest {rows.length}</div>
        </div>
        {moves.error ? <ErrorBox error={moves.error} onRetry={moves.reload} /> : moves.loading && !moves.data ? <Loading /> : rows.length === 0 ? <Empty title="No movements" /> : (
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr><th>Date</th><th>Item</th><th>Type</th><th className="num">Change</th><th className="num">Balance</th><th>Reference</th><th>Note</th></tr></thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td className="muted nowrap">{dateTime(m.created_at)}</td>
                    <td><div className="cell-title">{m.item_name}</div><div className="muted small mono">{m.sku || 'deleted item'}</div></td>
                    <td><span className={`type-tag type-${m.type.toLowerCase()}`}>{movementLabel(m.type)}</span></td>
                    <td className="num"><span className={`delta ${m.change > 0 ? 'pos' : 'neg'}`}>{m.change > 0 ? '+' : ''}{number(m.change)}</span></td>
                    <td className="num">{number(m.balance_after)} <span className="muted small">{m.unit}</span></td>
                    <td>{refLink(m.reference)}</td>
                    <td className="muted small">{m.note || ''}</td>
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
