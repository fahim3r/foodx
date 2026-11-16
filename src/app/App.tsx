// FoodX — App router.
// Public: /login, /reset-password, /update-password.
// Protected (inside <AppLayout>): / (dashboard), /pos, /orders,
// /orders/:id, /kds, /menu, /inventory, /tables, /customers, /settings,
// /roles.
// Unknown routes redirect to /.
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './AuthProvider'
import ProtectedRoute from './ProtectedRoute'
import LoginPage from '@/modules/auth/LoginPage'
import ResetPasswordPage from '@/modules/auth/ResetPasswordPage'
import UpdatePasswordPage from '@/modules/auth/UpdatePasswordPage'
import DashboardPage from '@/modules/dashboard/DashboardPage'
import CustomersPage from '@/modules/customers/CustomersPage'
import InventoryPage from '@/modules/inventory/InventoryPage'
import KdsPage from '@/modules/kds/KdsPage'
import MenuPage from '@/modules/menu/MenuPage'
import OrderDetailPage from '@/modules/orders/OrderDetailPage'
import OrdersPage from '@/modules/orders/OrdersPage'
import PosPage from '@/modules/pos/PosPage'
import RolesPage from '@/modules/roles/RolesPage'
import SettingsPage from '@/modules/settings/SettingsPage'
import TablesPage from '@/modules/tables/TablesPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/update-password" element={<UpdatePasswordPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/pos" element={<PosPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/orders/:id" element={<OrderDetailPage />} />
            <Route path="/kds" element={<KdsPage />} />
            <Route path="/menu" element={<MenuPage />} />
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/tables" element={<TablesPage />} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/roles" element={<RolesPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
