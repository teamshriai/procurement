import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Requests from './pages/Requests';
import Restock from './pages/Restock';
import Inventory from './pages/Inventory';
import Categories from './pages/Categories';
import Billing from './pages/Billing';
import Bills from './pages/Bills';
import BillView from './pages/BillView';
import PurchaseOrders from './pages/PurchaseOrders';
import PurchaseOrderView from './pages/PurchaseOrderView';
import Suppliers from './pages/Suppliers';
import Departments from './pages/Departments';
import StockLedger from './pages/StockLedger';
import Reports from './pages/Reports';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="requests" element={<Requests />} />
        <Route path="restock" element={<Restock />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="categories" element={<Categories />} />
        <Route path="billing" element={<Billing />} />
        <Route path="bills" element={<Bills />} />
        <Route path="bills/:id" element={<BillView />} />
        <Route path="purchase-orders" element={<PurchaseOrders />} />
        <Route path="purchase-orders/:id" element={<PurchaseOrderView />} />
        <Route path="suppliers" element={<Suppliers />} />
        <Route path="departments" element={<Departments />} />
        <Route path="ledger" element={<StockLedger />} />
        <Route path="reports" element={<Reports />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
