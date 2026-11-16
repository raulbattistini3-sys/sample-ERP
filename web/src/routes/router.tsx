import { createBrowserRouter, type RouteObject } from "react-router-dom";
import { ProtectedRoute } from "./ProtectedRoute";
import { AppLayout } from "../layouts/AppLayout";
import { NotFoundPage } from "./NotFoundPage";

// Every page is its own chunk, loaded when its route is first matched (react-router's `lazy`), so the
// first load downloads the shell and one page instead of the whole app: the products list no longer
// carries the audit, users, billing and import screens, nor the spreadsheet parser.
type Modulo = Record<string, unknown>;
const pagina =
  <M extends Modulo>(carregar: () => Promise<M>, nome: keyof M & string): RouteObject["lazy"] =>
  async () => {
    const Componente = (await carregar())[nome] as React.ComponentType;
    return { Component: Componente };
  };

const Login = pagina(() => import("../features/usuarios/pages/LoginPage"), "LoginPage");
const Register = pagina(() => import("../features/usuarios/pages/RegisterPage"), "RegisterPage");
const ForgotPassword = pagina(() => import("../features/usuarios/pages/ForgotPasswordPage"), "ForgotPasswordPage");
const ResetPassword = pagina(() => import("../features/usuarios/pages/ResetPasswordPage"), "ResetPasswordPage");
const ChangePassword = pagina(() => import("../features/usuarios/pages/ChangePasswordPage"), "ChangePasswordPage");
const UsuarioList = pagina(() => import("../features/usuarios/pages/UsuarioListPage"), "UsuarioListPage");
const UsuarioForm = pagina(() => import("../features/usuarios/pages/UsuarioFormPage"), "UsuarioFormPage");

const ProductList = pagina(() => import("../features/produtos/pages/ProductListPage"), "ProductListPage");
const ProductForm = pagina(() => import("../features/produtos/pages/ProductFormPage"), "ProductFormPage");
const ProductImport = pagina(() => import("../features/produtos/pages/ProductImportPage"), "ProductImportPage");

const CategoriaList = pagina(() => import("../features/categoria/pages/CategoriaListPage"), "CategoriaListPage");
const CategoriaForm = pagina(() => import("../features/categoria/pages/CategoriaFormPage"), "CategoriaFormPage");

const AuditoriaList = pagina(() => import("../features/auditoria/pages/AuditoriaListPage"), "AuditoriaListPage");
const AuditoriaDetail = pagina(() => import("../features/auditoria/pages/AuditoriaDetailPage"), "AuditoriaDetailPage");
const AuditoriaForm = pagina(() => import("../features/auditoria/pages/AuditoriaFormPage"), "AuditoriaFormPage");

const Integracoes = pagina(() => import("../features/integracoes/pages/IntegracoesPage"), "IntegracoesPage");
const ClienteList = pagina(() => import("../features/clientes/pages/ClienteListPage"), "ClienteListPage");
const EmpresaForm = pagina(() => import("../features/clientes/pages/EmpresaFormPage"), "EmpresaFormPage");
const Cobrancas = pagina(() => import("../features/cobrancas/pages/CobrancasPage"), "CobrancasPage");

export const router = createBrowserRouter([
  { path: "/login", lazy: Login },
  { path: "/register", lazy: Register },
  { path: "/forgot-password", lazy: ForgotPassword },
  { path: "/reset-password", lazy: ResetPassword },

  {
    element: <ProtectedRoute />,
    children: [
      // outside AppLayout: a forced change shows nothing but this form
      { path: "trocar-senha", lazy: ChangePassword },
      {
        element: <AppLayout />,
        children: [
          { index: true, lazy: ProductList }, // "/" — pick a sensible landing page

          { path: "products", lazy: ProductList },
          { path: "products/new", lazy: ProductForm },
          { path: "products/import", lazy: ProductImport },
          { path: "products/:id", lazy: ProductForm },

          { path: "categorias", lazy: CategoriaList },
          { path: "categorias/new", lazy: CategoriaForm },
          { path: "categorias/:id", lazy: CategoriaForm },

          { path: "usuarios", lazy: UsuarioList },
          { path: "usuarios/new", lazy: UsuarioForm },
          { path: "usuarios/:id", lazy: UsuarioForm },

          { path: "auditoria", lazy: AuditoriaList },
          { path: "auditoria/new", lazy: AuditoriaForm },
          { path: "auditoria/:id", lazy: AuditoriaDetail },

          { path: "integracoes", lazy: Integracoes },
          { path: "clientes", lazy: ClienteList },
          { path: "clientes/empresas/new", lazy: EmpresaForm },
          { path: "clientes/empresas/:id", lazy: EmpresaForm },
          { path: "cobrancas", lazy: Cobrancas },
        ],
      },
    ],
  },

  // anything unmatched: redirects pt-BR/en aliases (/produtos, /audit...) or shows the 404
  { path: "*", element: <NotFoundPage /> },
]);
