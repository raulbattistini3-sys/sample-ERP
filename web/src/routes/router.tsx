import { createBrowserRouter } from "react-router-dom";
import { ProtectedRoute } from "./ProtectedRoute";
import { AppLayout } from "../layouts/AppLayout";
import { LoginPage } from "../features/usuarios/pages/LoginPage";
import { ProductListPage } from "../features/produtos/pages/ProductListPage";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: "/products", element: <ProductListPage /> },
          // categorias, usuarios, auditoria pages go here
        ],
      },
    ],
  },
]);
