import { api, apiUpload } from "../client";
import type {
  AbcXyzResponse, AnalyticsData, AnomaliesResponse, CatalogQuality, ControlTowerResponse,
  CostCurveResponse, CustomerImpact, DashboardData, DeliverySlaIntel, ForecastResponse, FulfillmentBottleneck,
  FulfillmentData, ImportReport, InboundSummary, InventoryAgingResponse,
  DemoScript,
  NetworkCompareResponse, NetworkScenarioInputs, NetworkScenarioRun,
  OutboundActionsResponse, PiExecSummary, PiExperiments, PiInsightAnswer, PiQuestions, PiValidation,
  ProcurementLinkage,
  PmDecisionLayer, PricingIntel, PromotionsIntel, RcaAnalysis, ReturnsIntel,
  POFormContext, POListResponse, ProductDetail,
  ProductListResponse, ProcurementIntelligenceResponse, RecommendationsResponse,
  ReturnsSummary, RootCauseChain, ScenarioResponse, SettingsResponse, SizeAvailabilityResponse,
  SlowMoversResponse, SupplierDetail,
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

export const outboundApi = {
  sizeAvailability: () => api<SizeAvailabilityResponse>("/outbound/size-availability?limit=12"),
  bottleneck: (days = 30) => api<FulfillmentBottleneck>(`/outbound/fulfillment-bottleneck?days=${days}`),
  deliverySla: (days = 30) => api<DeliverySlaIntel>(`/outbound/delivery-sla?days=${days}`),
  rootCause: (days = 30) => api<RootCauseChain>(`/outbound/root-cause?days=${days}`),
  customerImpact: (days = 30) => api<CustomerImpact>(`/outbound/customer-impact?days=${days}`),
  actions: (days = 30) => api<OutboundActionsResponse>(`/outbound/actions?days=${days}`),
  returnsIntel: (days = 90) => api<ReturnsIntel>(`/outbound/returns?days=${days}`),
};

export const intelligenceApi = {
  controlTower: () => api<ControlTowerResponse>("/control-tower"),
  anomalies: (threshold = 2.5) =>
    api<AnomaliesResponse>(`/anomalies?threshold=${threshold}`),
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
    return api<ScenarioResponse>(`/scenarios/${productId}?${qs.toString()}`);
  },
  costCurve: (productId: number) =>
    api<CostCurveResponse>(`/scenarios/${productId}/cost-curve`),
  networkScenario: (opts: Partial<NetworkScenarioInputs> & { label?: string } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(opts).forEach(([k, v]) => {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    });
    return api<NetworkScenarioRun>(`/scenarios/network?${qs.toString()}`);
  },
  networkCompare: (a: Partial<NetworkScenarioInputs>, b: Partial<NetworkScenarioInputs>) => {
    const qs = new URLSearchParams();
    Object.entries(a).forEach(([k, v]) => { if (v != null) qs.set(`a_${k}`, String(v)); });
    Object.entries(b).forEach(([k, v]) => { if (v != null) qs.set(`b_${k}`, String(v)); });
    return api<NetworkCompareResponse>(`/scenarios/network/compare?${qs.toString()}`);
  },
  abcXyz: () => api<AbcXyzResponse>("/abc-xyz"),
  aging: () => api<InventoryAgingResponse>("/inventory-aging"),
  velocityMatrix: () => api<VelocityMatrixResponse>("/velocity-matrix"),
  slowMovers: () => api<SlowMoversResponse>("/slow-movers"),
  procurement: () => api<ProcurementIntelligenceResponse>("/procurement-intelligence"),
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

export const inboundApi = {
  summary: () => api<InboundSummary>("/inbound/summary"),
  procurement: (days = 120) => api<ProcurementLinkage>(`/inbound/procurement?days=${days}`),
  catalogQuality: () => api<CatalogQuality>("/inbound/catalog-quality"),
  pricing: (days = 90) => api<PricingIntel>(`/inbound/pricing?days=${days}`),
  promotions: (days = 90) => api<PromotionsIntel>(`/inbound/promotions?days=${days}`),
};

export const rcaApi = {
  analysis: (days = 21) => api<RcaAnalysis>(`/rca/analysis?days=${days}`),
  problems: (days = 21) => api<{ window_days: number; problems: unknown[] }>(`/rca/problems?days=${days}`),
};

export const pmApi = {
  decisions: () => api<PmDecisionLayer>("/pm/decisions"),
};

export const piApi = {
  questions: () => api<PiQuestions>("/pi/questions"),
  ask: (q: string) => api<PiInsightAnswer>(`/pi/ask?q=${encodeURIComponent(q)}`),
  validate: (recommendation: string) =>
    api<PiValidation>(`/pi/validate?recommendation=${encodeURIComponent(recommendation)}`),
  experiments: (problem?: string) =>
    api<PiExperiments>(`/pi/experiments${problem ? `?problem=${encodeURIComponent(problem)}` : ""}`),
  executiveSummary: () => api<PiExecSummary>("/pi/executive-summary"),
};

export const demoApi = {
  script: () => api<DemoScript>("/demo/script"),
};
