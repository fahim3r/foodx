// FoodX — App router.
// Public: /login, /reset-password, /update-password.
// Protected (inside <AppLayout>): / (dashboard), /settings, /roles.
// Unknown routes redirect to /.
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './AuthProvider'
import ProtectedRoute from './ProtectedRoute'
import LoginPage from '@/modules/auth/LoginPage'
import ResetPasswordPage from '@/modules/auth/ResetPasswordPage'
import UpdatePasswordPage from '@/modules/auth/UpdatePasswordPage'
import DashboardPage from '@/modules/dashboard/DashboardPage'
import RolesPage from '@/modules/roles/RolesPage'
import SettingsPage from '@/modules/settings/SettingsPage'

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
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/roles" element={<RolesPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
