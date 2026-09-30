import { useCallback, useEffect, useState } from 'react';
import {
  X, Loader2, PackageOpen, Pill, Syringe, ShieldCheck, SprayCan, BedDouble, Armchair, Stethoscope,
  FlaskConical, PenLine, Utensils, Wrench, Boxes, AlertTriangle, CheckCircle2, XCircle,
} from 'lucide-react';
import { api } from '../api';

/* Data loading hook: const { data, loading, error, reload } = useFetch('/items', params) */
export function useFetch(url, params) {
  const key = JSON.stringify(params || {});
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api.get(url, JSON.parse(key));
      setState({ data, loading: false, error: null });
    } catch (error) {
      setState({ data: null, loading: false, error });
    }
  }, [url, key]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load, setData: (fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })) };
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ open, title, message, confirmLabel = 'Delete', danger = true, busy, onConfirm, onClose }) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      size="sm"
      footer={(
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 size={16} className="spin" />} {confirmLabel}
          </button>
        </>
      )}
    >
      <p>{message}</p>
    </Modal>
  );
}

export function Field({ label, hint, children, span }) {
  return (
    <label className={`field ${span ? `span-${span}` : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Loading({ label = 'Loading…' }) {
  return <div className="loading"><Loader2 className="spin" size={22} /> {label}</div>;
}

export function ErrorBox({ error, onRetry }) {
  return (
    <div className="error-box">
      <AlertTriangle size={20} />
      <div>
        <strong>Couldn’t load data.</strong> {error?.message}
        <div className="muted small">Make sure the API server is running (npm run dev in the project root).</div>
      </div>
      {onRetry && <button className="btn btn-ghost btn-sm" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function Empty({ title = 'Nothing here yet', children }) {
  return (
    <div className="empty">
      <PackageOpen size={36} strokeWidth={1.5} />
      <strong>{title}</strong>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function StockBadge({ item }) {
  if (item.quantity === 0) return <span className="badge badge-critical"><XCircle size={13} /> Out of stock</span>;
  if (item.quantity <= item.reorder_level) return <span className="badge badge-warning"><AlertTriangle size={13} /> Low stock</span>;
  return <span className="badge badge-good"><CheckCircle2 size={13} /> In stock</span>;
}

export function StatusBadge({ status }) {
  const map = {
    COMPLETED: ['badge-good', 'Completed'],
    RECEIVED: ['badge-good', 'Received'],
    PENDING: ['badge-warning', 'Yet to be confirmed'],
    CONFIRMED: ['badge-info', 'Confirmed'],
    DISPATCHED: ['badge-info', 'On the way'],
    ORDERED: ['badge-good', 'Ordered'],
    CANCELLED: ['badge-critical', 'Cancelled'],
  };
  const [cls, label] = map[status] || ['badge-neutral', status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

const GROUP_ICONS = {
  pill: Pill, syringe: Syringe, shield: ShieldCheck, spray: SprayCan, bed: BedDouble, armchair: Armchair,
  stethoscope: Stethoscope, flask: FlaskConical, pen: PenLine, utensils: Utensils, wrench: Wrench,
};
export const ICON_CHOICES = Object.keys(GROUP_ICONS);
export function GroupIcon({ name, size = 18 }) {
  const Icon = GROUP_ICONS[name] || Boxes;
  return <Icon size={size} />;
}

export function QtyStepper({ value, onChange, min = 1, max = Infinity, disabled }) {
  return (
    <div className="stepper">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={disabled || value <= min} aria-label="Decrease">−</button>
      <input
        type="number"
        value={value}
        min={min}
        max={Number.isFinite(max) ? max : undefined}
        disabled={disabled}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
        }}
      />
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={disabled || value >= max} aria-label="Increase">+</button>
    </div>
  );
}
