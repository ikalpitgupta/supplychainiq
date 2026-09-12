import { api, apiUpload } from "../client";
import type {
  AbcXyzResponse, AnalyticsData, AnomaliesResponse, ControlTowerResponse,
  CostCurveResponse, DashboardData, ForecastResponse, FulfillmentData, ImportReport,
  InventoryAgingResponse, POFormContext, POListResponse, ProductDetail,
  ProductListResponse, ProcurementIntelligenceResponse, RecommendationsResponse,
  ReturnsSummary, ScenarioResponse, SettingsResponse, SlowMoversResponse, SupplierDetail,
  SupplierListResponse, User, VelocityMatrixResponse,
} from "../../types";

export const authApi = {
  login: (email: string, password: string) =>
    api<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: () => api<{ user: User }>("/auth/me"),
};

export const dashboardApi = {
  get: (category?: string | null, period?: number) => {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (period) params.set("period", String(period));
    return api<DashboardData>(`/dashboard?${params.toString()}`);
  },
};

export const productsApi = {
  list: (params: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "" && v !== null) qs.set(k, String(v));
    });
    return api<ProductListResponse>(`/products?${qs.toString()}`);
  },
  detail: (id: number, horizon = 30) => api<ProductDetail>(`/products/${id}?horizon=${horizon}`),
  options: () => api<{ items: { id: number; sku: string; name: string; category: string }[] }>("/products/options"),
  forecast: (id: number, horizon: number) => api<ForecastResponse>(`/forecasts/${id}?horizon=${horizon}`),
};

export const suppliersApi = {
  list: (params: Record<string, string | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) qs.set(k, v);
    });
    return api<SupplierListResponse>(`/suppliers?${qs.toString()}`);
  },
  detail: (id: number) => api<SupplierDetail>(`/suppliers/${id}`),
};

export const poApi = {
  list: (params: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    });
    return api<POListResponse>(`/purchase-orders?${qs.toString()}`);
  },
  formContext: (productId?: number) =>
    api<POFormContext>(`/purchase-orders/form-context${productId ? `?product_id=${productId}` : ""}`),
  create: (payload: { product_id: number; supplier_id: number; quantity: number; expected_date?: string; note?: string }) =>
    api<Record<string, unknown>>("/purchase-orders", { method: "POST", body: JSON.stringify(payload) }),
  updateStatus: (id: number, status: string) =>
    api<Record<string, unknown>>(`/purchase-orders/${id}`, { method: "PUT", body: JSON.stringify({ status }) }),
};

export const recommendationsApi = {
  get: () => api<RecommendationsResponse>("/recommendations"),
};

export const analyticsApi = {
  get: (periodDays = 365) => api<AnalyticsData>(`/analytics?period_days=${periodDays}`),
};

export const metaApi = {
  categories: () => api<{ items: string[] }>("/meta/categories"),
};

export const fulfillmentApi = {
  summary: (periodDays = 90) => api<FulfillmentData>(`/fulfillment/summary?period_days=${periodDays}`),
};

export const returnsApi = {
  summary: () => api<ReturnsSummary>("/returns/summary"),
};

export const intelligenceApi = {
  controlTower: () => api<ControlTowerResponse>("/intelligence/control-tower"),
  anomalies: (threshold = 2.5) =>
    api<AnomaliesResponse>(`/intelligence/anomalies?threshold=${threshold}`),
  scenario: (
    productId: number,
    opts: { demandChangePct?: number; leadTimeDeltaDays?: number; safetyStock?: number | null; stock?: number | null; serviceLevel?: number | null } = {},
  ) => {
    const qs = new URLSearchParams();
    if (opts.demandChangePct !== undefined) qs.set("demand_change_pct", String(opts.demandChangePct));
    if (opts.leadTimeDeltaDays !== undefined) qs.set("lead_time_delta_days", String(opts.leadTimeDeltaDays));
    if (opts.safetyStock != null) qs.set("safety_stock", String(opts.safetyStock));
    if (opts.stock != null) qs.set("stock", String(opts.stock));
    if (opts.serviceLevel != null) qs.set("service_level", String(opts.serviceLevel));
    return api<ScenarioResponse>(`/intelligence/scenarios/${productId}?${qs.toString()}`);
  },
  costCurve: (productId: number) =>
    api<CostCurveResponse>(`/intelligence/scenarios/${productId}/cost-curve`),
  abcXyz: () => api<AbcXyzResponse>("/intelligence/abc-xyz"),
  aging: () => api<InventoryAgingResponse>("/intelligence/inventory-aging"),
  velocityMatrix: () => api<VelocityMatrixResponse>("/intelligence/velocity-matrix"),
  slowMovers: () => api<SlowMoversResponse>("/intelligence/slow-movers"),
  procurement: () => api<ProcurementIntelligenceResponse>("/intelligence/procurement-intelligence"),
};

export const settingsApi = {
  get: () => api<SettingsResponse>("/settings"),
  update: (values: Record<string, number | string>) =>
    api<SettingsResponse>("/settings", { method: "PUT", body: JSON.stringify({ values }) }),
  resetDemo: () => api<{ message: string; counts: Record<string, number> }>("/settings/reset-demo", { method: "POST" }),
};

export const ioApi = {
  importCsv: (entity: string, file: File) => apiUpload<ImportReport>(`/import/${entity}`, file),
  importPreview: (entity: string, file: File) => apiUpload<ImportPreview>(`/import/${entity}/preview`, file),
  history: (limit = 50) => api<{ items: ImportHistoryItem[] }>(`/import/history?limit=${limit}`),
  historyFileUrl: (id: number) => `/api/import/history/${id}/file`,
};

export interface ImportPreview {
  entity: string;
  mode: "upsert" | "append";
  creates: number;
  updates: number;
  invalid_count: number;
  invalid: { row: number; error: string }[];
  changes: { row: number; key: string; name: string; fields: { field: string; old: string | number | null; new: string | number | null }[] }[];
  changes_truncated: number;
  appends: number | null;
}

export interface ImportHistoryItem {
  id: number;
  entity: string;
  filename: string;
  uploaded_by: string;
  uploaded_by_name: string;
  imported: number;
  failed: number;
  total: number;
  file_size: number;
  file_available: boolean;
  ran_at: string | null;
  first_errors: { row: number; error: string }[];
}
