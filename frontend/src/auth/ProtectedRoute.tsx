import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return <main className="grid min-h-screen place-items-center bg-slate-50 px-5" aria-label="Loading your account">
      <div className="w-full max-w-sm animate-pulse space-y-4 rounded-3xl bg-white p-8 shadow-card">
        <div className="h-10 w-10 rounded-xl bg-slate-200" />
        <div className="h-5 w-2/3 rounded bg-slate-200" />
        <div className="h-4 rounded bg-slate-100" />
        <div className="h-11 rounded-xl bg-slate-100" />
      </div>
    </main>;
  }
  return user ? <Outlet /> : <Navigate to="/login" replace state={{ from: location }} />;
}
