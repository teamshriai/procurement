import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';

/* ------------------------------------------------------------------ Toasts */

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((message, type = 'success') => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => dismiss(id), type === 'error' ? 6000 : 3500);
  }, [dismiss]);
  const value = useMemo(() => ({
    success: (m) => push(m, 'success'),
    error: (m) => push(m, 'error'),
  }), [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.type === 'error' ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
            <span>{t.message}</span>
            <button className="icon-btn" onClick={() => dismiss(t.id)} aria-label="Dismiss"><X size={16} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* -------------------------------------------------------------------- Cart */
// The cart holds items selected for billing. It is shared between Inventory
// and the Billing page, and kept in localStorage so a refresh doesn't lose it.

const CartCtx = createContext(null);
const CART_KEY = 'shpc-cart';

function loadCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }) {
  const [lines, setLines] = useState(loadCart);

  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(lines));
    } catch {
      /* storage unavailable */
    }
  }, [lines]);

  const add = useCallback((item, qty = 1) => {
    setLines((prev) => {
      const found = prev.find((l) => l.item.id === item.id);
      if (found) {
        return prev.map((l) => (l.item.id === item.id ? { ...l, item, quantity: Math.min(l.quantity + qty, item.quantity) } : l));
      }
      if (item.quantity <= 0) return prev;
      return [...prev, { item, quantity: Math.min(qty, item.quantity) }];
    });
  }, []);
  const setQty = useCallback((id, quantity) => {
    setLines((prev) => prev.map((l) => (l.item.id === id ? { ...l, quantity: Math.max(1, Math.min(quantity, l.item.quantity)) } : l)));
  }, []);
  const remove = useCallback((id) => setLines((prev) => prev.filter((l) => l.item.id !== id)), []);
  const clear = useCallback(() => setLines([]), []);
  /** Refresh item snapshots (stock/price) from fresh data. */
  const sync = useCallback((items) => {
    const byId = new Map(items.map((i) => [i.id, i]));
    setLines((prev) => prev
      .filter((l) => byId.has(l.item.id))
      .map((l) => {
        const item = byId.get(l.item.id);
        return { item, quantity: Math.min(l.quantity, Math.max(item.quantity, 0)) };
      })
      .filter((l) => l.quantity > 0));
  }, []);

  const totals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    for (const l of lines) {
      const base = l.item.price * l.quantity;
      subtotal += base;
      tax += (base * l.item.gst_rate) / 100;
    }
    return { subtotal, tax, count: lines.reduce((s, l) => s + l.quantity, 0) };
  }, [lines]);

  const value = useMemo(() => ({ lines, add, setQty, remove, clear, sync, totals }), [lines, add, setQty, remove, clear, sync, totals]);
  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}
export const useCart = () => useContext(CartCtx);
