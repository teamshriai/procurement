import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { api } from '../api';
import { useToast } from '../context';
import {
  useFetch, PageHeader, Loading, ErrorBox, Modal, Field, Confirm, GroupIcon, ICON_CHOICES,
} from '../components/ui';
import { categoryTree, moneyShort, number } from '../utils';

export default function Categories() {
  const toast = useToast();
  const cats = useFetch('/categories');
  const tree = useMemo(() => categoryTree(cats.data || []), [cats.data]);
  const [editing, setEditing] = useState(null); // { id?, parent_id?, name, icon, description }
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (editing.id) await api.put(`/categories/${editing.id}`, editing);
      else await api.post('/categories', editing);
      toast.success(editing.id ? 'Category updated' : 'Category added');
      setEditing(null);
      cats.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/categories/${deleting.id}`);
      toast.success('Category deleted');
      setDeleting(null);
      cats.reload();
    } catch (err) {
      toast.error(err.message);
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  };

  if (cats.error) return <ErrorBox error={cats.error} onRetry={cats.reload} />;
  const isGroup = editing && !editing.parent_id;

  return (
    <>
      <PageHeader
        title="Categories"
        actions={<button className="btn btn-primary" onClick={() => setEditing({ name: '', icon: 'pill', description: '' })}><Plus size={17} /> Add Group</button>}
      />
      {cats.loading && !cats.data ? <Loading /> : (
        <div className="cat-cards">
          {tree.map((g) => (
            <section key={g.id} className="card cat-card">
              <div className="cat-card-head">
                <div className="stat-icon"><GroupIcon name={g.icon} size={20} /></div>
                <div className="grow">
                  <h3>{g.name}</h3>
                  <div className="muted small">{g.description || `${g.children.length} sub-categories`}</div>
                </div>
                <div className="row-actions">
                  <button className="icon-btn" title="Edit group" onClick={() => setEditing({ ...g })}><Pencil size={16} /></button>
                  <button className="icon-btn danger" title="Delete group" onClick={() => setDeleting(g)}><Trash2 size={16} /></button>
                </div>
              </div>
              <div className="cat-card-kpis">
                <div><span>Items</span><strong>{number(g.item_count_total)}</strong></div>
                <div><span>Units</span><strong>{number(g.units_total)}</strong></div>
                <div><span>Value</span><strong>{moneyShort(g.stock_value_total)}</strong></div>
              </div>
              <ul className="sub-list">
                {g.children.map((c) => (
                  <li key={c.id}>
                    <Link to="/inventory" state={{ category: c.id }} className="grow">{c.name}</Link>
                    <span className="muted small">{c.item_count} items</span>
                    <button className="icon-btn" title="Rename" onClick={() => setEditing({ ...c })}><Pencil size={14} /></button>
                    <button className="icon-btn danger" title="Delete" onClick={() => setDeleting(c)}><Trash2 size={14} /></button>
                  </li>
                ))}
              </ul>
              <button className="btn btn-link btn-sm" onClick={() => setEditing({ name: '', parent_id: g.id })}><Plus size={15} /> Add sub-category</button>
            </section>
          ))}
        </div>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        size="sm"
        title={editing?.id ? `Edit ${isGroup ? 'group' : 'sub-category'}` : isGroup ? 'Add main group' : 'Add sub-category'}
        footer={(
          <>
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button type="submit" form="cat-form" className="btn btn-primary" disabled={busy}>{busy && <Loader2 size={16} className="spin" />} Save</button>
          </>
        )}
      >
        {editing && (
          <form id="cat-form" className="stack" onSubmit={save}>
            {!isGroup && !editing.id && (
              <div className="muted small">Under <strong>{tree.find((g) => g.id === editing.parent_id)?.name}</strong></div>
            )}
            <Field label="Name *">
              <input required autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            {isGroup && (
              <>
                <Field label="Icon">
                  <div className="icon-choices">
                    {ICON_CHOICES.map((ic) => (
                      <button type="button" key={ic} className={editing.icon === ic ? 'active' : ''} onClick={() => setEditing({ ...editing, icon: ic })} aria-label={ic}>
                        <GroupIcon name={ic} />
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Description">
                  <input value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
                </Field>
              </>
            )}
          </form>
        )}
      </Modal>

      <Confirm
        open={!!deleting}
        title="Delete category?"
        message={deleting && `“${deleting.name}”${deleting.children ? ' and all its sub-categories' : ''} will be deleted. Categories that still contain items cannot be deleted.`}
        busy={busy}
        onConfirm={remove}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
