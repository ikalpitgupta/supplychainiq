// Recharts wrappers: consistent tooltip, grid, and color usage. All charts read
// the theme context, so axes, grids, tooltips, and legends adapt when the
// [data-theme] token flips.
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { CHART_COLORS } from "../shared";
import { useTheme } from "../../hooks/useTheme";
import { formatINR, formatNumber } from "../../utils/format";

function useChartTheme() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  return {
    dark,
    axis: { fontSize: 11, fill: dark ? "rgba(236,235,229,0.55)" : "rgba(22,23,15,0.45)" } as const,
    grid: dark ? CHART_COLORS.darkGrid : CHART_COLORS.grid,
    tooltip: {
      contentStyle: {
        borderRadius: 14,
        border: dark ? "1px solid rgba(255,255,255,0.15)" : "1px solid rgba(22,23,15,0.08)",
        backgroundColor: dark ? "#22241a" : "#ffffff",
        color: dark ? "white" : "rgb(22 23 15)",
        fontSize: 12,
        boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
      },
      itemStyle: dark ? { color: "white" } : undefined,
      labelStyle: dark ? { color: "rgba(255,255,255,0.6)" } : undefined,
    } as const,
    legend: { fontSize: 11, color: dark ? "rgba(236,235,229,0.7)" : undefined } as const,
  };
}

export function DemandForecastChart({ data, height = 300, dark = false }: {
  data: { date: string; actual: number | null; forecast: number | null; lower: number | null; upper: number | null }[];
  height?: number;
  dark?: boolean;
}) {
  const t = useChartTheme();
  const isDark = dark || t.dark; // explicit prop (feature card) wins
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid stroke={isDark ? CHART_COLORS.darkGrid : CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tick={isDark ? darkAxisTick : t.axis} tickLine={false} axisLine={false} minTickGap={48}
          tickFormatter={(v: string) => v.slice(5)} />
        <YAxis tick={isDark ? darkAxisTick : t.axis} tickLine={false} axisLine={false} width={54} />
        <Tooltip {...(isDark ? darkTooltip : t.tooltip)} labelFormatter={(l) => String(l)} />
        <Legend wrapperStyle={{ fontSize: 11, color: isDark ? "rgba(236,235,229,0.7)" : undefined }} />
        <Line type="monotone" dataKey="actual" name="Actual demand" stroke={isDark ? CHART_COLORS.lime : CHART_COLORS.primary}
          strokeWidth={2} dot={false} connectNulls={false} />
        <Line type="monotone" dataKey="forecast" name="Forecast" stroke={isDark ? "#b3a2f7" : CHART_COLORS.violet}
          strokeWidth={2} strokeDasharray="6 3" dot={false} connectNulls={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

const darkAxisTick = { fontSize: 11, fill: "rgba(236,235,229,0.55)" } as const;
const darkTooltip = {
  contentStyle: {
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.15)",
    backgroundColor: "#22241a",
    color: "white",
    fontSize: 12,
    boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
  },
  itemStyle: { color: "white" },
  labelStyle: { color: "rgba(255,255,255,0.6)" },
} as const;

export function StockTrendChart({ data, height = 260 }: {
  data: { date: string; stock: number }[];
  height?: number;
}) {
  const t = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id="stockFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLORS.primary} stopOpacity={0.28} />
            <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={t.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tick={t.axis} tickLine={false} axisLine={false} minTickGap={48}
          tickFormatter={(v: string) => v.slice(5)} />
        <YAxis tick={t.axis} tickLine={false} axisLine={false} width={54} />
        <Tooltip {...t.tooltip} />
        <Area type="monotone" dataKey="stock" name="Stock on hand" stroke={CHART_COLORS.primary}
          strokeWidth={2} fill="url(#stockFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ProjectionChart({ data, height = 300 }: {
  data: { date: string; stock: number; reorder_point: number; safety_stock: number; demand: number | null }[];
  height?: number;
}) {
  const t = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid stroke={t.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tick={t.axis} tickLine={false} axisLine={false} minTickGap={40}
          tickFormatter={(v: string) => v.slice(5)} />
        <YAxis tick={t.axis} tickLine={false} axisLine={false} width={54} />
        <Tooltip {...t.tooltip} />
        <Legend wrapperStyle={t.legend} />
        <Area type="monotone" dataKey="stock" name="Projected stock" stroke={CHART_COLORS.primary}
          fill={CHART_COLORS.primary} fillOpacity={0.14} strokeWidth={2} />
        <Line type="stepAfter" dataKey="reorder_point" name="Reorder point" stroke={CHART_COLORS.amber}
          strokeWidth={2} dot={false} />
        <Line type="stepAfter" dataKey="safety_stock" name="Safety stock" stroke={CHART_COLORS.red}
          strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function HealthDonut({ data, onSlice }: {
  data: { name: string; count: number; pct: number }[];
  onSlice?: (name: string) => void;
}) {
  const t = useChartTheme();
  const colorMap: Record<string, string> = {
    Healthy: CHART_COLORS.green, "Low Stock": CHART_COLORS.amber,
    Critical: CHART_COLORS.red, Overstock: CHART_COLORS.violet,
  };
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={data} dataKey="count" nameKey="name" innerRadius="58%" outerRadius="85%"
          paddingAngle={2} stroke={t.dark ? "#22241a" : "white"} strokeWidth={2}
          onClick={(entry) => onSlice?.(entry.name)} className="cursor-pointer">
          {data.map((d) => (
            <Cell key={d.name} fill={colorMap[d.name] || CHART_COLORS.slate} />
          ))}
        </Pie>
        <Tooltip {...t.tooltip}
          formatter={(value, name) => {
            const item = data.find((d) => d.name === name);
            return [`${formatNumber(Number(value))} products (${item?.pct ?? 0}%)`, name];
          }} />
        <Legend wrapperStyle={t.legend} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function MonthlyLineChart({ data, dataKey, name, color = CHART_COLORS.primary, height = 240, money = false }: {
  data: Record<string, unknown>[];
  dataKey: string;
  name: string;
  color?: string;
  height?: number;
  money?: boolean;
}) {
  const t = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: -8 }}>
        <CartesianGrid stroke={t.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="month" tick={t.axis} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tick={t.axis} tickLine={false} axisLine={false} width={54}
          tickFormatter={(v: number) => (money ? formatINR(v) : formatNumber(v))} />
        <Tooltip {...t.tooltip}
          formatter={(value: number | string) => [money ? formatINR(Number(value)) : formatNumber(Number(value)), name]} />
        <Line type="monotone" dataKey={dataKey} name={name} stroke={color} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SimpleBarChart({ data, dataKey, name, color = CHART_COLORS.primary, height = 240, money = false, vertical = false }: {
  data: Record<string, unknown>[];
  dataKey: string;
  name: string;
  color?: string;
  height?: number;
  money?: boolean;
  vertical?: boolean;
}) {
  const t = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={vertical ? "vertical" : "horizontal"}
        margin={{ top: 6, right: 12, bottom: 0, left: vertical ? 40 : -8 }}>
        <CartesianGrid stroke={t.grid} strokeDasharray="3 3" vertical={false} />
        {vertical ? (
          <>
            <XAxis type="number" tick={t.axis} tickLine={false} axisLine={false}
              tickFormatter={(v: number) => (money ? formatINR(v) : formatNumber(v))} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: t.axis.fill }}
              tickLine={false} axisLine={false} width={130} />
          </>
        ) : (
          <>
            <XAxis dataKey="month" tick={t.axis} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis tick={t.axis} tickLine={false} axisLine={false} width={54}
              tickFormatter={(v: number) => (money ? formatINR(v) : formatNumber(v))} />
          </>
        )}
        <Tooltip {...t.tooltip}
          formatter={(value: number | string) => [money ? formatINR(Number(value)) : formatNumber(Number(value)), name]} />
        <Bar dataKey={dataKey} name={name} fill={color} radius={[6, 6, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ParetoChart({ data, height = 280 }: {
  data: { rank: number; cumulative_share: number; class: string }[];
  height?: number;
}) {
  const t = useChartTheme();
  const colorMap: Record<string, string> = { A: CHART_COLORS.primary, B: CHART_COLORS.amber, C: CHART_COLORS.slate };
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: -8 }}>
        <CartesianGrid stroke={t.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="rank" tick={t.axis} tickLine={false} axisLine={false} minTickGap={40} />
        <YAxis domain={[0, 100]} tick={t.axis} tickLine={false} axisLine={false} width={44}
          tickFormatter={(v: number) => `${v}%`} />
        <Tooltip {...t.tooltip}
          formatter={(value: number | string) => [`${Number(value).toFixed(1)}% cumulative`, "Cumulative value share"]} />
        <Area type="monotone" dataKey="cumulative_share" stroke={CHART_COLORS.primary} fill={CHART_COLORS.primary} fillOpacity={0.1} strokeWidth={2} />
        {data.map((d, i) => (
          <Cell key={i} fill={colorMap[d.class]} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
