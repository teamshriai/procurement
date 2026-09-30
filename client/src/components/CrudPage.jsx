import { useState } from 'react';
import { Plus, Pencil, Trash2, Search, Loader2 } from 'lucide-react';
import { api } from '../api';
import { useToast } from '../context';
import { useFetch, PageHeader, Loading, ErrorBox, Empty, Modal, Field, Confirm } from './ui';

/**
 * Generic list + add/edit/delete page.
 * fields: [{ key, label, required, type, span }], columns: [{ label, render, className }]
 */
export default function CrudPage({ endpoint, title, subtitle, singular, fields, columns, deleteWarning }) {
  const toast = useToast();
  const list = useFetch(endpoint);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null); // {} for new
  const [form, setForm] = useState({});
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const openForm = (row) => {
    const f = {};
    for (const fl of fields) f[fl.key] = row?.[fl.key] ?? (fl.type === 'checks' ? [] : '');
    setForm(f);
    setEditing(row || {});
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (editing.id) await api.put(`${endpoint}/${editing.id}`, form);
      else await api.post(endpoint, form);
      toast.success(`${singular} ${editing.id ? 'updated' : 'added'}`);
      setEditing(null);
      list.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`${endpoint}/${deleting.id}`);
      toast.success(`${singular} deleted`);
      setDeleting(null);
      list.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const rows = (list.data || []).filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={<button className="btn btn-primary" onClick={() => openForm(null)}><Plus size={17} /> Add {singular}</button>}
      />
      <section className="card">
        <div className="toolbar">
          <div className="search"><Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${title.toLowerCase()}…`} /></div>
          <div className="toolbar-summary muted small">{rows.length} records</div>
        </div>
        {list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : list.loading && !list.data ? <Loading /> : rows.length === 0 ? <Empty /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>{columns.map((c) => <th key={c.label} className={c.className}>{c.label}</th>)}<th className="actions-col" /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    {columns.map((c) => <td key={c.label} className={c.className}>{c.render(r)}</td>)}
                    <td className="actions-col">
                      <div className="row-actions">
                        <button className="icon-btn" title="Edit" onClick={() => openForm(r)}><Pencil size={16} /></button>
                        <button className="icon-btn danger" title="Delete" onClick={() => setDeleting(r)}><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? `Edit ${singular.toLowerCase()}` : `Add ${singular.toLowerCase()}`}
        footer={(
          <>
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button type="submit" form="crud-form" className="btn btn-primary" disabled={busy}>{busy && <Loader2 size={16} className="spin" />} Save</button>
          </>
        )}
      >
        <form id="crud-form" className="form-grid" onSubmit={save}>
          {fields.map((f, i) => (
            <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} span={f.span}>
              {f.type === 'checks' ? (
                <div className="check-grid">
                  {f.options.map(([value, text]) => {
                    const list = Array.isArray(form[f.key]) ? form[f.key] : [];
                    const on = list.includes(value);
                    return (
                      <label key={value} className="check">
                        <input type="checkbox" checked={on} onChange={() => setForm((s) => ({ ...s, [f.key]: on ? list.filter((v) => v !== value) : [...list, value] }))} />
                        {text}
                      </label>
                    );
                  })}
                </div>
              ) : f.type === 'textarea' ? (
                <textarea rows={2} value={form[f.key] ?? ''} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} />
              ) : (
                <input
                  type={f.type || 'text'}
                  required={f.required}
                  autoFocus={i === 0}
                  value={form[f.key] ?? ''}
                  onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                />
              )}
            </Field>
          ))}
        </form>
      </Modal>

      <Confirm
        open={!!deleting}
        title={`Delete ${singular.toLowerCase()}?`}
        message={deleting && `“${deleting.name}” will be deleted. ${deleteWarning || ''}`}
        busy={busy}
        onConfirm={remove}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
