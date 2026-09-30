import CrudPage from '../components/CrudPage';
import { useFetch } from '../components/ui';
import { money } from '../utils';

export default function Departments() {
  const cats = useFetch('/categories');
  const groups = (cats.data || []).filter((c) => !c.parent_id).map((c) => [c.id, c.name]);
  const groupName = new Map(groups);
  return (
    <CrudPage
      endpoint="/departments"
      title="Departments"
      singular="Department"
      deleteWarning="Existing bills keep their amounts but will no longer show a department."
      fields={[
        { key: 'name', label: 'Department name', required: true, span: 2 },
        { key: 'head', label: 'Head / In-charge' },
        { key: 'location', label: 'Location' },
        { key: 'group_ids', label: 'Can raise purchase requests for', type: 'checks', options: groups, span: 2 },
      ]}
      columns={[
        { label: 'Department', render: (r) => <><div className="cell-title">{r.name}</div><div className="muted small">{r.head || '—'} · {r.location || '—'}</div></> },
        { label: 'Can request', render: (r) => (
          <div className="chip-list">
            {r.group_ids.length ? r.group_ids.map((g) => <span key={g} className="badge badge-neutral">{groupName.get(g)}</span>) : <span className="muted small">Receives medicines only</span>}
          </div>
        ) },
        { label: 'Bills', className: 'num', render: (r) => r.bill_count },
        { label: 'Total issued', className: 'num', render: (r) => <strong>{money(r.total_value)}</strong> },
      ]}
    />
  );
}
