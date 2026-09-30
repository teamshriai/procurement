import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import {
  House, ClipboardList, Boxes, ReceiptText, Building2, BarChart3, Search, Menu, UserCircle2, ShoppingCart,
} from 'lucide-react';
import { useCart } from '../context';
import { api } from '../api';

// Six top-level sections. Related screens sit as tabs inside a section,
// so every feature is at most two clicks from anywhere.
const NAV = [
  { label: 'Home', icon: House, tabs: [
    { to: '/', label: 'Order tracker', end: true },
    { to: '/restock', label: 'Restock' },
    { to: '/purchase-orders', label: 'All orders' },
  ] },
  { label: 'Requests', icon: ClipboardList, badge: 'requests', tabs: [{ to: '/requests', label: 'Requests' }] },
  { label: 'Stock', icon: Boxes, tabs: [
    { to: '/inventory', label: 'Items & stock' },
    { to: '/categories', label: 'Categories' },
    { to: '/ledger', label: 'Stock ledger' },
  ] },
  { label: 'Billing', icon: ReceiptText, badge: 'cart', tabs: [
    { to: '/billing', label: 'New bill' },
    { to: '/bills', label: 'Bills' },
  ] },
  { label: 'Vendors', icon: Building2, tabs: [
    { to: '/suppliers', label: 'Vendors' },
    { to: '/departments', label: 'Departments' },
  ] },
  { label: 'Reports', icon: BarChart3, tabs: [{ to: '/reports', label: 'Reports' }] },
];

const matches = (tab, path) => (tab.end ? path === tab.to : path === tab.to || path.startsWith(`${tab.to}/`));

/** Other screens ask the sidebar to refresh its pending-requests count. */
export const requestsChanged = () => window.dispatchEvent(new Event('requests-changed'));

export default function Layout() {
  const { totals } = useCart();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [q, setQ] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const load = () => api.get('/requests/summary').then((r) => setPending(r.pending)).catch(() => {});
    load();
    window.addEventListener('requests-changed', load);
    return () => window.removeEventListener('requests-changed', load);
  }, [pathname]);

  const section = NAV.find((s) => s.tabs.some((t) => matches(t, pathname)));
  const badges = { requests: pending, cart: totals.count };

  const onSearch = (e) => {
    e.preventDefault();
    navigate(`/inventory?q=${encodeURIComponent(q.trim())}`);
    setQ('');
  };

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <Link to="/" className="brand" onClick={() => setNavOpen(false)}>
          <img src="/logo.svg" alt="" width="38" height="38" />
          <div>
            <strong>Shri Health</strong>
            <span>Procurement Centre</span>
          </div>
        </Link>
        <nav>
          {NAV.map((s) => {
            const Icon = s.icon;
            return (
              <Link
                key={s.label}
                to={s.tabs[0].to}
                className={`nav-link ${s === section ? 'active' : ''}`}
                onClick={() => setNavOpen(false)}
              >
                <Icon size={19} />
                <span>{s.label}</span>
                {s.badge && badges[s.badge] > 0 && <span className="nav-pill">{badges[s.badge]}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-foot">Pharmacy Procurement</div>
      </aside>
      <div className="scrim" onClick={() => setNavOpen(false)} />

      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setNavOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
          <form className="topbar-search" onSubmit={onSearch}>
            <Search size={17} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items by name, SKU or brand…" />
          </form>
          <Link to="/billing" className="cart-btn" title="Current bill">
            <ShoppingCart size={19} />
            {totals.count > 0 && <span className="cart-count">{totals.count}</span>}
          </Link>
          <div className="admin-chip">
            <UserCircle2 size={30} strokeWidth={1.5} />
            <div>
              <strong>Administrator</strong>
              <span>Stores Admin</span>
            </div>
          </div>
        </header>
        <main className="content">
          {section && section.tabs.length > 1 && (
            <nav className="tabs section-tabs no-print">
              {section.tabs.map((t) => (
                <NavLink key={t.to} to={t.to} end={t.end} className={() => (matches(t, pathname) ? 'active' : '')}>{t.label}</NavLink>
              ))}
            </nav>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
