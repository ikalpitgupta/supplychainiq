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
import FulfillmentPage from "./pages/FulfillmentPage";
import InsightsPage from "./pages/InsightsPage";
import SettingsPage from "./pages/SettingsPage";
import NotFoundPage from "./pages/NotFoundPage";

// Heavy, less-frequently-visited pages load on demand (xlsx is ~1MB).
const DataQualityPage = lazy(() => import("./pages/DataQualityPage"));
const ImportPageLazy = lazy(() => import("./pages/ImportPage"));
const DeliveryPage = lazy(() => import("./pages/DeliveryPage"));
const ReturnsPage = lazy(() => import("./pages/ReturnsPage"));
const ScenarioSimulatorPage = lazy(() => import("./pages/ScenarioSimulatorPage"));
const IntelligencePage = lazy(() => import("./pages/IntelligencePage"));
const InboundPage = lazy(() => import("./pages/InboundPage"));
const RootCausePage = lazy(() => import("./pages/RootCausePage"));
const ProductIntelligencePage = lazy(() => import("./pages/ProductIntelligencePage"));
const DemoModePage = lazy(() => import("./pages/DemoModePage"));

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
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthProvider>
            <ToastProvider>
              <TabIdentity />
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/inventory" element={<InventoryPage />} />
                  <Route path="/products/:id" element={<ProductDetailPage />} />
                  <Route path="/forecast" element={<ForecastPage />} />
                  <Route path="/fulfillment" element={<FulfillmentPage />} />
                  <Route path="/delivery" element={<Suspense fallback={<PageFallback />}><DeliveryPage /></Suspense>} />
                  <Route path="/returns" element={<Suspense fallback={<PageFallback />}><ReturnsPage /></Suspense>} />
                  <Route path="/simulator" element={<Suspense fallback={<PageFallback />}><ScenarioSimulatorPage /></Suspense>} />
                  <Route path="/intelligence" element={<Suspense fallback={<PageFallback />}><IntelligencePage /></Suspense>} />
                  <Route path="/inbound" element={<Suspense fallback={<PageFallback />}><InboundPage /></Suspense>} />
                  <Route path="/root-cause" element={<Suspense fallback={<PageFallback />}><RootCausePage /></Suspense>} />
                  <Route path="/suppliers" element={<SuppliersPage />} />
                  <Route path="/suppliers/:id" element={<SupplierDetailPage />} />
                  <Route path="/insights" element={<InsightsPage />} />
                  <Route path="/product-intelligence" element={<Suspense fallback={<PageFallback />}><ProductIntelligencePage /></Suspense>} />
                  <Route path="/demo" element={<Suspense fallback={<PageFallback />}><DemoModePage /></Suspense>} />
                  <Route path="/data-quality" element={<Suspense fallback={<PageFallback />}><DataQualityPage /></Suspense>} />
                  <Route path="/import" element={<Suspense fallback={<PageFallback />}><ImportPageLazy /></Suspense>} />
                  <Route path="/settings" element={<SettingsPage />} />
                  {/* Repositioning-era aliases: old links keep working. */}
                  <Route path="/control-tower" element={<Navigate to="/" replace />} />
                  <Route path="/analytics" element={<Navigate to="/intelligence" replace />} />
                  <Route path="/procurement" element={<Navigate to="/intelligence" replace />} />
                  <Route path="/recommendations" element={<Navigate to="/insights" replace />} />
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
