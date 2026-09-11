import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { ToastProvider } from "./hooks/useToast";
import { ThemeProvider } from "./hooks/useTheme";
import { useTabIdentity } from "./hooks/useTabIdentity";
import AppLayout from "./layouts/AppLayout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import InventoryPage from "./pages/InventoryPage";
import ProductDetailPage from "./pages/ProductDetailPage";
import ForecastPage from "./pages/ForecastPage";
import SuppliersPage from "./pages/SuppliersPage";
import SupplierDetailPage from "./pages/SupplierDetailPage";
import PurchaseOrdersPage from "./pages/PurchaseOrdersPage";
import RecommendationsPage from "./pages/RecommendationsPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import SettingsPage from "./pages/SettingsPage";
import NotFoundPage from "./pages/NotFoundPage";

// Heavy, less-frequently-visited pages load on demand (xlsx is ~1MB).
const DataQualityPage = lazy(() => import("./pages/DataQualityPage"));
const ImportPageLazy = lazy(() => import("./pages/ImportPage"));
const ControlTowerPage = lazy(() => import("./pages/ControlTowerPage"));
const ScenarioSimulatorPage = lazy(() => import("./pages/ScenarioSimulatorPage"));
const ProcurementPage = lazy(() => import("./pages/ProcurementPage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Null component: keeps document.title and the favicon alert badge in sync.
function TabIdentity() {
  const { user } = useAuth();
  useTabIdentity(!!user);
  return null;
}

function PageFallback() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading page">
      <div className="h-8 w-64 animate-pulse rounded-lg bg-ink/10" />
      <div className="h-40 w-full animate-pulse rounded-3xl bg-ink/5" />
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider>
            <ToastProvider>
              <TabIdentity />
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/control-tower" element={<Suspense fallback={<PageFallback />}><ControlTowerPage /></Suspense>} />
                  <Route path="/inventory" element={<InventoryPage />} />
                  <Route path="/products/:id" element={<ProductDetailPage />} />
                  <Route path="/forecast" element={<ForecastPage />} />
                  <Route path="/simulator" element={<Suspense fallback={<PageFallback />}><ScenarioSimulatorPage /></Suspense>} />
                  <Route path="/procurement" element={<Suspense fallback={<PageFallback />}><ProcurementPage /></Suspense>} />
                  <Route path="/suppliers" element={<SuppliersPage />} />
                  <Route path="/suppliers/:id" element={<SupplierDetailPage />} />
                  <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />
                  <Route path="/recommendations" element={<RecommendationsPage />} />
                  <Route path="/analytics" element={<AnalyticsPage />} />
                  <Route path="/import" element={<Suspense fallback={<PageFallback />}><ImportPageLazy /></Suspense>} />
                  <Route path="/data-quality" element={<Suspense fallback={<PageFallback />}><DataQualityPage /></Suspense>} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Routes>
            </ToastProvider>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
