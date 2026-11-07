import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export const CHANGE_PASSWORD_PATH = "/trocar-senha";

export function ProtectedRoute() {
  const { user, isAuthenticated } = useAuth();
  const location = useLocation();
  // remember where the user was headed so LoginPage can send them back
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />;
  // an account created with a known senha gets nothing else until it picks its own (the API refuses
  // every other route with 403 too)
  if (user?.trocaSenhaObrigatoria && location.pathname !== CHANGE_PASSWORD_PATH) {
    return <Navigate to={CHANGE_PASSWORD_PATH} replace />;
  }
  return <Outlet />;
}
