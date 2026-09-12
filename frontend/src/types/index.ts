// Shared types mirroring the FastAPI response schemas.

export type InventoryStatus = "Healthy" | "Low Stock" | "Critical" | "Overstock";
export type RiskLevel = "High" | "Medium" | "Low" | "None";
export type RiskTier = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type HealthComponent = "inventory" | "stockout" | "suppliers" | "forecasting" | "overstock" | "procurement";

export interface WhyStep { label: string; value: number | string | null; unit?: string; note?: string }
export interface WhyPacket { title: string; steps: WhyStep[]; verdict: string }
export interface ImpactEstimate {
  shortfall_units_avoided: number;
  revenue_protected: number;
  risk_before: RiskTier;
  risk_after: RiskTier;
  risk_movement: string;
  note: string;
}
export interface SupplierOption {
  supplier_id: number;
  name: string;
  score: number;
  adjusted_score: number;
  on_time_rate: number;
  observed_on_time_pct: number | null;
  defect_rate: number;
  unit_cost_index: number;
  lead_time_days: number | null;
  risk_level: "Low" | "Medium" | "High";
  trade_off: string;
  risk_adjusted_expected_cost_note: string;
  critical_penalty_applied: number;
}
export type POStatus = "Draft" | "Pending" | "Ordered" | "In Transit" | "Delivered" | "Delayed" | "Cancelled";
export type Severity = "critical" | "warning" | "opportunity" | "info";
export type RecommendationAction =
  | "NO ACTION" | "MONITOR" | "REORDER SOON" | "ORDER NOW"
  | "REDUCE FUTURE ORDERS" | "REVIEW SUPPLIER";

export interface User {
  email: string;
  name: string;
  role: "admin" | "manager";
}

export interface KpiValue {
  value: number | null;
  prev: number | null;
  change_pct: number | null;
  unit: string;
}

export interface HealthSlice {
  name: InventoryStatus;
  count: number;
  pct: number;
}

export interface TrendPoint {
  date: string;
  actual: number | null;
  forecast: number | null;
  lower: number | null;
  upper: number | null;
}

export interface Alert {
  type: string;
  severity: Severity;
  title: string;
  message: string;
  cta: { label: string; link: string };
}

export interface DashboardData {
  kpis: {
    inventory_value: KpiValue;
    inventory_units: KpiValue;
    stockout_risks: KpiValue;
    overstock_products: KpiValue;
    inventory_turnover: KpiValue;
    supplier_delay_rate: KpiValue;
  };
  inventory_health: HealthSlice[];
  risk_tier_counts: Record<RiskTier, number>;
  business_impact: {
    revenue_at_risk: number;
    excess_inventory_value: number;
    potential_savings: number;
    top_risk_category: string | null;
    top_excess_category: string | null;
    holding_cost_rate: number;
    basis: Record<string, string>;
  };
  health_score: {
    total: number;
    grade: string;
    components: Record<HealthComponent, { score: number; weight: number; contribution: number; detail: string }>;
  };
  insights: { icon: string; tone: string; text: string }[];
  forecast_demand_30d: number | null;
  demand_trend: TrendPoint[];
  forecast_method: string;
  alerts: Alert[];
  summary: string;
  period: number;
  category: string | null;
  db_status: { active: string; using_fallback: boolean; last_error: string | null };
}

export interface ProductRow {
  id: number;
  sku: string;
  name: string;
  category: string;
  supplier: string | null;
  supplier_id: number | null;
  unit_cost: number;
  selling_price: number;
  lead_time_days: number;
  current_stock: number;
  avg_daily_demand: number;
  demand_std: number;
  safety_stock: number;
  reorder_point: number;
  days_of_inventory: number | null;
  days_until_reorder: number | null;
  status: InventoryStatus;
  risk_level: RiskLevel;
  projected_stock_at_lead_time: number;
  days_to_zero: number | null;
  inventory_value: number;
}

export interface ProductListResponse {
  items: ProductRow[];
  total: number;
  page: number;
  page_size: number;
  categories: string[];
  suppliers: string[];
}

export interface POListItem {
  id: number;
  po_number: string;
  product_id: number;
  product: string;
  supplier_id: number;
  supplier: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  order_date: string;
  expected_date: string;
  actual_date: string | null;
  status: POStatus;
  days_late: number;
}

export interface POListResponse {
  items: POListItem[];
  total: number;
  page: number;
  page_size: number;
  status_counts: Record<string, number>;
  valid_statuses: string[];
}

export interface POContext {
  product_id: number;
  product_name: string;
  current_stock: number;
  reorder_point: number;
  safety_stock: number;
  avg_daily_demand: number;
  status: InventoryStatus;
  lead_time_days: number;
  recommended_quantity: number;
  unit_cost: number;
  estimated_cost: number;
  default_supplier_id: number | null;
  default_supplier_name: string | null;
}

export interface POFormContext {
  products: { id: number; name: string; sku: string; supplier_id: number | null; unit_cost: number }[];
  suppliers: { id: number; name: string; lead_time_days: number; unit_cost: number }[];
  context: POContext | null;
}

export interface SupplierScore {
  supplier_id?: number;
  id?: number;
  name: string;
  on_time_rate: number;
  defect_rate: number;
  unit_cost: number;
  reliability_score: number;
  orders: number;
  delivery_pts: number;
  quality_pts: number;
  cost_pts: number;
  reliability_pts: number;
  total: number;
  risk_level?: string;
  ontime_observed?: number | null;
  total_spend?: number;
  product_count?: number;
  contact_email?: string | null;
  lead_time_days?: number;
}

export interface SupplierListResponse {
  items: SupplierScore[];
  weights: Record<string, number>;
}

export interface SupplierDetail {
  id: number;
  name: string;
  contact_email: string | null;
  lead_time_days: number;
  unit_cost: number;
  on_time_rate: number;
  defect_rate: number;
  reliability_score: number;
  score: {
    total: number;
    delivery: number;
    quality: number;
    cost: number;
    reliability: number;
    weights: Record<string, number>;
  };
  risk_level: string;
  kpis: {
    orders: number;
    total_spend: number;
    total_units: number;
    ontime_observed_pct: number | null;
    delayed: number;
  };
  products: { id: number; sku: string; name: string; category: string }[];
  category_mix: Record<string, number>;
  delivery_trend: { month: string; on_time_pct: number | null; delayed: number }[];
  cost_trend: { month: string; avg_unit_cost: number }[];
  volume_trend: { month: string; orders: number; quantity: number }[];
  summary: string;
}

export interface Recommendation {
  product_id: number;
  sku: string;
  product: string;
  category: string;
  current_stock: number;
  reorder_point: number;
  safety_stock: number;
  avg_daily_demand: number;
  days_of_inventory: number | null;
  status: InventoryStatus;
  risk_level: RiskLevel;
  risk_tier: RiskTier;
  lead_time_days: number;
  forecast_lead_time_demand: number;
  forecast_basis: string;
  action: RecommendationAction;
  severity: Severity;
  reason: string;
  recommended_quantity: number;
  preferred_supplier_id: number | null;
  preferred_supplier: string;
  preferred_supplier_score: number;
  supplier_options: SupplierOption[];
  estimated_cost: number;
  why: WhyPacket;
  impact: ImpactEstimate;
}

export interface SupplierReview {
  supplier_id: number;
  supplier: string;
  severity: Severity;
  action: string;
  reason: string;
}

export interface RecommendationsResponse {
  items: Recommendation[];
  counts: { critical: number; warning: number; opportunity: number; info: number };
  supplier_reviews: SupplierReview[];
}

export interface ProductDetail {
  id: number;
  sku: string;
  name: string;
  category: string;
  supplier: { id: number; name: string } | null;
  unit_cost: number;
  selling_price: number;
  lead_time_days: number;
  active: boolean;
  metrics: ProductRow;
  stock_history: { date: string; stock: number }[];
  demand_history: { date: string; quantity: number }[];
  forecast_chart: { date: string; quantity: number | null; forecast?: number | null; lower?: number | null; upper?: number | null }[];
  forecast_method: string;
  forecast_metrics: { MAE: number | null; RMSE: number | null; MAPE: number | null; n_test: number };
  projection: { date: string; stock: number; reorder_point: number; safety_stock: number; demand: number | null }[];
  risk_tier: RiskTier;
  decision: {
    risk_tier: RiskTier;
    action: RecommendationAction;
    severity: Severity;
    reason: string;
    recommended_quantity: number;
    preferred_supplier_id: number | null;
    preferred_supplier: string | null;
    preferred_supplier_score: number;
    supplier_options: SupplierOption[];
    forecast_lead_time_demand: number;
    forecast_basis: string;
    why: WhyPacket;
    impact: ImpactEstimate;
  };
  timeline: { reorder_point_day: number | null; safety_stock_day: number | null; stockout_day: number | null; lead_time_days: number };
  purchase_orders: POListItem[];
  formulas: Record<string, string>;
  outbound: OutboundProductView | null;
}

export interface ForecastResponse {
  product_id: number;
  method: string;
  metrics: { MAE: number | null; RMSE: number | null; MAPE: number | null; n_test: number };
  history: { date: string; quantity: number }[];
  forecast: { date: string; yhat: number; lower: number; upper: number }[];
}

export interface AnalyticsData {
  period_days: number;
  inventory: {
    turnover: number | null;
    days_inventory_outstanding: number | null;
    avg_inventory_value: number;
    holding_cost_annual: number;
    stockout_days: number;
    zero_demand_products: number;
    current_inventory_value: number;
  };
  procurement: {
    total_spend: number;
    po_count: number;
    on_time_pct: number | null;
    avg_lead_time_days: number | null;
    purchase_price_variance_pct: number | null;
    spend_by_supplier: { supplier: string; spend: number }[];
  };
  sales: {
    units_sold: number;
    revenue: number;
    revenue_trend: { month: string; revenue: number }[];
    units_trend: { month: string; units: number }[];
    top_products: { product_id: number; name: string; revenue: number; units: number }[];
  };
  efficiency: {
    open_purchase_orders: number;
    delayed_purchase_orders: number;
    delayed_pct: number | null;
    cancelled_purchase_orders: number;
    supplier_on_time_pct: number | null;
  };
  abc: {
    items: {
      product_id: number; sku: string; name: string; category: string;
      annual_demand: number; unit_cost: number; consumption_value: number;
      value_share: number; cumulative_share: number; class: "A" | "B" | "C";
    }[];
    summary: { class: string; sku_count: number; sku_share: number; value_share: number; value: number }[];
    pareto: { rank: number; cumulative_share: number; class: string }[];
  };
  insights: { title: string; text: string; severity: Severity; link: string }[];
}

export interface SettingsResponse {
  values: Record<string, { value: number | string; kind: string; label: string }>;
}

// ---------------------------------------------------------------------------
// Intelligence module (control tower, anomalies, scenarios, segmentation,
// procurement). All values are server-computed — the frontend never derives
// business numbers itself.
// ---------------------------------------------------------------------------
export interface ControlTowerAlert {
  id: number | string;
  name: string;
  tier: RiskTier;
  detail: string;
  link: string;
}

export interface ControlTowerStage {
  stage: string;
  score: number;
  issues: number;
  detail: string;
  alerts: ControlTowerAlert[];
}

export interface ControlTowerResponse {
  overall_score: number;
  period_days: number;
  stages: ControlTowerStage[];
  summary: Record<string, number | string>;
}

/* ------------------- Fulfillment (supplier-side pipeline) ------------------- */

export interface FulfillmentData {
  period_days: number;
  status_counts: Record<string, number>;
  total_pos: number;
  on_time_rate: number;
  delay_rate: number;
  avg_lead_time_days: number | null;
  avg_delay_days: number | null;
  spend_total: number;
  spend_30d: number;
  spend_30d_prev: number;
  price_variance_pct: number | null;
  monthly: { month: string; orders: number; on_time: number; late: number; spend: number }[];
  late_orders: POListItem[];
  inbound: POListItem[];
}

/* ------------------------------ Outbound intelligence ------------------------------ */

export interface SizeRiskRow {
  size: string;
  units: number;
  d30_demand: number;
  days_cover: number | null;
  severity: "critical" | "warning";
}

export interface SizeAvailabilityItem {
  product_id: number;
  product: string;
  sizes: Record<string, number>;
  d30_demand_by_size: Record<string, number>;
  at_risk: SizeRiskRow[];
  lost_units_2w: number;
  revenue_at_risk: number;
}

export interface SizeAvailabilityResponse {
  window_days: number;
  flagged_products: number;
  revenue_at_risk: number;
  items: SizeAvailabilityItem[];
}

export interface FulfillmentBottleneck {
  window_days: number;
  orders: number;
  stages: { stage: string; avg_hours: number; share_pct: number }[];
  bottleneck: string | null;
  total_cycle_hours: number | null;
  by_warehouse: { warehouse: string; pick_hours: number; pack_hours: number; dispatch_hours: number; orders: number }[];
}

export interface SlaBucket {
  key: string;
  delivered: number;
  late: number;
  late_rate_pct: number;
  avg_late_days: number;
}

export interface DeliverySlaIntel {
  window_days: number;
  delivered: number;
  late: number;
  on_time_rate: number | null;
  by_region: SlaBucket[];
  by_warehouse: SlaBucket[];
  by_carrier: SlaBucket[];
  delay_reasons: { reason: string; count: number }[];
}

export interface RootCauseNode {
  node: string;
  evidence: string;
  holds: boolean;
}

export interface RootCauseChain {
  available: boolean;
  message: string | null;
  window_days: number;
  headline: { late_rate_pct: number; delivered: number; cancelled: number; cancel_rate_pct: number } | null;
  chain: RootCauseNode[];
  warehouse_shares: Record<string, { share_pct: number; region: string }>;
}

export interface CustomerImpactWindow {
  orders: number;
  late_rate_pct: number | null;
  cancel_rate_pct: number | null;
  returns: number;
  cancelled_revenue: number;
}

export interface CustomerImpact {
  window_days: number;
  prior: CustomerImpactWindow;
  recent: CustomerImpactWindow;
  findings: string[];
}

export interface ReturnsIntel {
  window_days: number;
  delivered_orders: number;
  returns: number;
  return_rate_pct: number | null;
  by_reason: { reason: string; count: number }[];
  by_category: { category: string; returns: number; return_rate_pct: number | null }[];
  top_products: { product_id: number; product: string; returns: number; return_rate_pct: number | null }[];
  by_disposition: Record<string, number>;
}

export interface OutboundAction {
  problem: string;
  root_cause: string;
  recommendation: string;
  impact: string;
  cta: { label: string; to: string };
}

export interface OutboundActionsResponse {
  window_days: number;
  actions: OutboundAction[];
}

export interface OutboundProductView {
  sized: boolean;
  warehouses: string[];
  variants: Record<string, { total: number; by_warehouse: Record<string, number> }>;
  total_units: number;
  size_risk: { at_risk: SizeRiskRow[]; revenue_at_risk: number } | null;
  fulfillment: {
    orders_90d: number;
    delivered_90d: number;
    late_rate_pct: number | null;
    cancel_rate_pct: number | null;
    avg_pick_hours: number | null;
    avg_pack_hours: number | null;
    avg_dispatch_hours: number | null;
  };
  returns: {
    returns_90d: number;
    return_rate_pct: number | null;
    top_reasons: [string, number][];
  };
}

/* ------------------------- Returns (honest placeholder) ------------------------ */

export interface ReturnsSummary {
  available: boolean;
  message: string;
  reason?: string;
  scope?: string;
  indicative_rate_pct?: number;
  selling_price_exposed: boolean;
  top_lines: {
    product_id: number;
    product: string;
    category: string;
    sold_365d: number;
    revenue_365d: number;
    return_band: string;
    exposure_note: string;
  }[];
}

export interface AnomalyItem {
  series: string;
  key: number | string;
  label: string;
  sku?: string;
  date?: string;
  value: number;
  baseline_mean: number;
  baseline_std?: number;
  z: number;
  direction: "spike" | "drop";
  explanation: string;
  investigate_link?: string;
  spike_action?: {
    applies: boolean;
    baseline_daily: number;
    spike_daily: number;
    extra_daily_units: number;
    days_of_cover: number;
    incremental_units_needed: number;
    incremental_cost: number;
    recommendation: string;
  } | null;
}

export interface AnomaliesResponse {
  anomalies: AnomalyItem[];
  scanned: number;
  threshold: number;
  window_days: number;
  supplier_delays: AnomalyItem[];
}

export interface ScenarioOutputs {
  avg_daily_demand: number;
  safety_stock: number;
  reorder_point: number;
  days_of_inventory: number;
  days_to_zero: number;
  projected_stock_at_lead_time: number;
  risk_tier: RiskTier;
  shortfall_units: number;
  revenue_at_risk: number;
  recommended_qty: number;
  recommended_qty_cost: number;
  excess_units: number;
  excess_value: number;
}

export interface ScenarioBranch {
  inputs: {
    avg_daily_demand: number;
    demand_change_pct: number;
    lead_time_days: number;
    lead_time_delta_days: number;
    current_stock: number;
    stock_override: number;
    service_level: number;
    safety_stock_override: number | null;
  };
  outputs: ScenarioOutputs;
}

export interface ScenarioResponse {
  product: { id: number; name: string; sku: string };
  baseline: ScenarioBranch;
  scenario: ScenarioBranch;
  deltas: {
    risk_tier: string;
    revenue_at_risk: number;
    recommended_qty: number;
    days_to_zero?: number;
    reorder_point?: number;
  };
}

export interface CostCurvePoint {
  service_level: number;
  z: number;
  safety_stock: number;
  holding_cost: number;
  expected_stockout_cost: number;
  total_cost: number;
}

export interface CostCurveResponse {
  product: { id: number; name: string; sku: string };
  curve: CostCurvePoint[];
}

export interface AbcXyzItem {
  id: number;
  name: string;
  sku: string;
  category: string;
  annual_demand: number;
  unit_cost: number;
  avg_daily_demand: number;
  demand_std: number;
  inventory_value: number;
  abc: "A" | "B" | "C";
  xyz: "X" | "Y" | "Z";
  segment: string;
  strategy: string;
}

export interface AbcXyzResponse {
  items: AbcXyzItem[];
  summary: { segment: string; count: number; inventory_value: number; annual_value: number }[];
  legend: Record<string, string> | { segment: string; meaning: string }[];
}

export interface AgingBucket {
  bucket: string;
  units: number;
  value: number;
  products: number;
  pct: number;
}

export interface InventoryAgingResponse {
  buckets: AgingBucket[];
  stale_products: { id: number; name: string; sku: string; stock: number; value: number; days_idle: number }[];
  stale_value: number;
  total_value: number;
  note: string;
}

export interface VelocityItem {
  id: number;
  name: string;
  sku: string;
  category: string;
  avg_daily_demand: number;
  inventory_value: number;
  segment: "Star" | "Fast Moving" | "Slow Moving" | "Dead Stock";
}

export interface VelocityMatrixResponse {
  items: VelocityItem[];
  quadrants: Record<string, { count: number; value: number }>;
  thresholds: { demand_median: number; value_median: number };
}

export interface SlowMoverItem {
  product_id: number;
  name: string;
  sku: string;
  category: string;
  avg_daily_demand: number;
  days_of_inventory: number;
  stock: number;
  excess_units: number;
  excess_value: number;
  recommendation: string;
}

export interface SlowMoversResponse {
  items: SlowMoverItem[];
  total_excess_value: number;
}

export interface SingleSourceRisk {
  product_id: number;
  name: string;
  sku: string;
  supplier_id: number;
  supplier: string;
  annual_spend: number;
  lead_time_days: number;
  share_pct: number;
  suggestion: string;
}

export interface PriceAlert {
  product_id: number;
  name: string;
  sku: string;
  recent_avg_cost: number;
  prior_avg_cost: number;
  change_pct: number;
  direction: "increase" | "decrease";
  annualized_impact: number;
  note: string;
}

export interface ProcurementIntelligenceResponse {
  total_spend: number;
  window_days: number;
  single_source: SingleSourceRisk[];
  price_alerts: PriceAlert[];
  concentration: {
    hhi: number;
    level: string;
    top_share_pct: number;
    shares: { supplier_id: number; supplier: string; share_pct: number }[];
  };
  opportunities: {
    supplier: string;
    supplier_id?: number;
    annual_spend: number;
    on_time_pct: number;
    alternative: string;
    alternative_on_time_pct: number | null;
    note: string;
  }[];
}

export interface ImportReport {
  imported: number;
  failed: number;
  total: number;
  errors: { row: number; error: string }[];
}

/* ---------------------- Inbound Intelligence ---------------------------- */

export interface InboundSupplierRisk {
  supplier_id: number;
  supplier: string;
  lead_time_days: number;
  po_on_time_rate: number | null;
  avg_days_late: number;
  pos_window: number;
  cancelled_share: number | null;
  defect_rate: number;
  cost_index: number;
  stockout_products: number;
  overstock_products: number;
}

export interface ProcurementLinkage {
  window_days: number;
  suppliers: InboundSupplierRisk[];
  flagged: string[];
  concentration: { top: { supplier: string; spend: number; spend_share: number }[]; hhi: number; top3_share: number };
  stockout_by_supplier: Record<string, number>;
}

export interface CatalogCategoryQuality {
  category: string;
  products: number;
  complete_pct: number;
  missing: { color: number; material: number; description: number; image: number };
  size_chart_missing: number;
  size_chart_missing_pct: number | null;
}

export interface CatalogQuality {
  total_products: number;
  complete_pct: number;
  by_category: CatalogCategoryQuality[];
  size_chart_linkage: string | null;
  headline: string;
  affected_products: { sku: string; name: string; category: string; gaps: string[] }[];
}

export interface PricingRow {
  product_id: number;
  sku: string;
  product: string;
  category: string;
  cost: number;
  price: number;
  mrp: number;
  discount_pct: number;
  margin_pct: number;
  est_margin_pct: number;
  units: number;
  revenue: number;
  units_change: number | null;
}

export interface PriceMove {
  product_id: number;
  sku: string;
  product: string;
  category: string;
  prev_price: number;
  new_price: number;
  change_pct: number;
  direction: "up" | "down";
  units_current: number;
  units_prior: number;
  units_change_pct: number | null;
}

export interface PricingIntel {
  window_days: number;
  avg_margin_pct: number | null;
  products: PricingRow[];
  high_discount_low_margin: PricingRow[];
  lowest_margin: PricingRow[];
  price_moves: PriceMove[];
  declining_after_increase: PriceMove[];
  improving_after_change: PriceMove[];
  interpretation_note: string;
}

export interface CampaignStats {
  id: number;
  name: string;
  kind: string;
  discount_pct: number;
  start: string;
  end: string;
  orders?: number;
  units?: number;
  revenue?: number;
  delivered?: number;
  delivered_revenue?: number;
  margin?: number;
  cancel_rate?: number | null;
  avg_order_value?: number | null;
  organic?: { orders: number; revenue: number; margin: number } | null;
  organic_aov?: number | null;
  aov_delta_pct?: number | null;
  margin_rate?: number | null;
  organic_margin_rate?: number | null;
  discount_cost?: number;
}

export interface PromotionsIntel {
  window_days: number;
  campaigns: CampaignStats[];
  totals: { revenue: number; discount_cost: number; margin: number; orders: number };
  tradeoff_note: string;
}

export interface InboundSummary {
  procurement: { flagged: string[]; hhi: number; top3_share: number };
  catalog: { complete_pct: number; headline: string };
  pricing: { avg_margin_pct: number | null; high_discount_count: number };
  promotions: { revenue: number; discount_cost: number; margin: number; orders: number };
}

/* --------------------------- Root Cause Analysis ------------------------- */

export interface RcaMetric {
  label: string;
  prior: string;
  recent: string;
  delta: string;
}

export interface RcaTreeNode {
  id: string;
  label: string;
  status: "flagged" | "cleared";
  summary: string;
  metrics: Record<string, unknown>[];
  children: RcaTreeNode[];
}

export interface RcaContributingFactor {
  factor: string;
  verdict: string;
  impact: string;
  recommendation: string;
  confidence?: string;
}

export interface RcaProblem {
  id: string;
  area: string;
  title: string;
  statement: string;
  metric: string;
  recent: number;
  prior: number;
  delta_pts?: number;
  delta_pct?: number;
  seeding: string;
  evidence: { headline: string; metrics: RcaMetric[] } | null;
  contributing_factor: RcaContributingFactor;
  business_impact: { statement: string; estimated: boolean };
  recommendation: string;
  tree: RcaTreeNode[];
}

export interface RcaAnalysis {
  window_days: number;
  problems: RcaProblem[];
  language_note: string;
}
