import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();

  if (loading) return <div style={{ padding: 20, fontFamily: "system-ui" }}>Laddar…</div>;
  if (!session) return <Navigate to="/login" replace />;

  return <>{children}</>;
}
