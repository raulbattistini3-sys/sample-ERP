import { createBrowserRouter } from "react-router-dom";
import { ProtectedRoute } from "./ProtectedRoute";
import { AppLayout } from "../layouts/AppLayout";

import { LoginPage } from "../features/usuarios/pages/LoginPage";
import { RegisterPage } from "../features/usuarios/pages/RegisterPage";
import { ForgotPasswordPage } from "../features/usuarios/pages/ForgotPasswordPage";
import { ResetPasswordPage } from "../features/usuarios/pages/ResetPasswordPage";
import { UsuarioListPage } from "../features/usuarios/pages/UsuarioListPage";
import { UsuarioFormPage } from "../features/usuarios/pages/UsuarioFormPage";

import { ProductListPage } from "../features/produtos/pages/ProductListPage";
import { ProductFormPage } from "../features/produtos/pages/ProductFormPage";
import { ProductImportPage } from "../features/produtos/pages/ProductImportPage";

import { CategoriaListPage } from "../features/categoria/pages/CategoriaListPage";
import { CategoriaFormPage } from "../features/categoria/pages/CategoriaFormPage";

import { AuditoriaListPage } from "../features/auditoria/pages/AuditoriaListPage";
import { AuditoriaDetailPage } from "../features/auditoria/pages/AuditoriaDetailPage";
import { AuditoriaFormPage } from "../features/auditoria/pages/AuditoriaFormPage";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/register", element: <RegisterPage /> },
  { path: "/forgot-password", element: <ForgotPasswordPage /> },
  { path: "/reset-password", element: <ResetPasswordPage /> },

  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <ProductListPage /> }, // "/" — pick a sensible landing page

          { path: "products", element: <ProductListPage /> },
          { path: "products/new", element: <ProductFormPage /> },
          { path: "products/import", element: <ProductImportPage /> },
          { path: "products/:id", element: <ProductFormPage /> },

          { path: "categorias", element: <CategoriaListPage /> },
          { path: "categorias/new", element: <CategoriaFormPage /> },
          { path: "categorias/:id", element: <CategoriaFormPage /> },

          { path: "usuarios", element: <UsuarioListPage /> },
          { path: "usuarios/new", element: <UsuarioFormPage /> },
          { path: "usuarios/:id", element: <UsuarioFormPage /> },

          { path: "auditoria", element: <AuditoriaListPage /> },
          { path: "auditoria/new", element: <AuditoriaFormPage /> },
          { path: "auditoria/:id", element: <AuditoriaDetailPage /> },
        ],
      },
    ],
  },
]);
