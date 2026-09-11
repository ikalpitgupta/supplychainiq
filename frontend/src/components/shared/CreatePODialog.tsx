import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check } from "lucide-react";
import { poApi, recommendationsApi } from "../../api/endpoints";
import { Button, Dialog, Field, Input, Select, Skeleton } from "../ui";
import { formatINR, formatDate } from "../../utils/format";
import { useToast } from "../../hooks/useToast";

export function CreatePODialog({
  open, onClose, productId,
}: { open: boolean; onClose: () => void; productId?: number }) {
  const { push } = useToast();
  const qc = useQueryClient();
  const [selectedProduct, setSelectedProduct] = useState<number | undefined>(productId);
  const [supplierId, setSupplierId] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("");
  const [expectedDate, setExpectedDate] = useState<string>("");
  const [note, setNote] = useState<string>("");

  const form = useQuery({
    queryKey: ["po-form", selectedProduct],
    queryFn: () => poApi.formContext(selectedProduct),
    enabled: open,
  });

  useEffect(() => {
    if (form.data?.context) {
      const c = form.data.context;
      setSupplierId(String(c.default_supplier_id ?? ""));
      setQuantity(String(c.recommended_quantity));
      const d = new Date();
      d.setDate(d.getDate() + c.lead_time_days);
      setExpectedDate(d.toISOString().slice(0, 10));
    }
  }, [form.data]);

  const context = form.data?.context ?? null;
  const products = form.data?.products ?? [];
  const suppliers = form.data?.suppliers ?? [];

  // Risk-adjusted supplier comparison from the decision engine (cached).
  const recsQ = useQuery({
    queryKey: ["recommendations"],
    queryFn: recommendationsApi.get,
    enabled: open && !!selectedProduct,
    staleTime: 60_000,
  });
  const supplierOptions = useMemo(
    () => recsQ.data?.items.find((r) => r.product_id === Number(selectedProduct))?.supplier_options ?? [],
    [recsQ.data, selectedProduct],
  );
  const selectedOption = useMemo(
    () => supplierOptions.find((o) => o.supplier_id === Number(supplierId)),
    [supplierOptions, supplierId],
  );

  const selectedSupplier = useMemo(
    () => suppliers.find((s) => s.id === Number(supplierId)),
    [suppliers, supplierId],
  );
  const selectedProductMeta = useMemo(
    () => products.find((p) => p.id === Number(selectedProduct)),
    [products, selectedProduct],
  );

  const estimatedCost = Number(quantity) * (selectedProductMeta?.unit_cost ?? context?.unit_cost ?? 0);
  const underRecommended = context !== null && Number(quantity) > 0
    && Number(quantity) < context.recommended_quantity * 0.6;

  const create = useMutation({
    mutationFn: () =>
      poApi.create({
        product_id: Number(selectedProduct),
        supplier_id: Number(supplierId),
        quantity: Number(quantity),
        expected_date: expectedDate || undefined,
        note: note || undefined,
      }),
    onSuccess: (res) => {
      push("success", `Purchase order ${String(res.po_number)} created`);
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["form-context"] });
      onClose();
    },
    onError: (err) => push("error", err instanceof Error ? err.message : "Failed to create PO"),
  });

  const close = () => { onClose(); setNote(""); };

  return (
    <Dialog open={open} onClose={close} title="Create Purchase Order" width="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Product">
            <Select
              value={selectedProduct ?? ""}
              onChange={(e) => setSelectedProduct(Number(e.target.value) || undefined)}
            >
              <option value="">Select a product…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
              ))}
            </Select>
          </Field>
          <Field label="Supplier" hint={selectedSupplier ? `Lead time: ${selectedSupplier.lead_time_days} days` : undefined}>
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Select a supplier…</option>
              {suppliers.map((s) => {
                const opt = supplierOptions.find((o) => o.supplier_id === s.id);
                return <option key={s.id} value={s.id}>{s.name}{opt ? ` — risk-adjusted score ${opt.adjusted_score}` : ""}</option>;
              })}
            </Select>
          </Field>
          {selectedProduct && supplierOptions.length > 0 && (
            <div className="space-y-1 rounded-xl bg-panel/70 p-3 sm:col-span-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Risk-adjusted supplier comparison</p>
              {supplierOptions.slice(0, 3).map((o, i) => (
                <button
                  key={o.supplier_id}
                  type="button"
                  onClick={() => setSupplierId(String(o.supplier_id))}
                  className={`flex w-full items-start justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    Number(supplierId) === o.supplier_id ? "bg-lime-300/30" : "bg-surface hover:bg-ink/5"}`}
                >
                  <span className="flex items-start gap-1.5">
                    {i === 0 && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-label="recommended" />}
                    <span>
                      <span className="block text-xs font-semibold text-ink">{o.name} · {o.on_time_rate.toFixed(0)}% on-time · defects {o.defect_rate.toFixed(1)}%</span>
                      <span className="block text-[10px] leading-relaxed text-ink/50">{o.trade_off}</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] font-semibold text-ink/70">{o.adjusted_score}</span>
                </button>
              ))}
              {selectedOption && (
                <p className="text-[10px] text-ink/40">{selectedOption.risk_adjusted_expected_cost_note}</p>
              )}
            </div>
          )}
          <Field label="Quantity">
            <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="e.g. 500" />
          </Field>
          <Field label="Expected delivery date">
            <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
          </Field>
        </div>

        <Field label="Notes (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the buyer should know" />
        </Field>

        {form.isLoading && <Skeleton className="h-24 w-full" />}

        {context && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold text-slate-700">Order guidance — {context.product_name}</p>
            <div className="mt-2 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
              <div><p className="text-slate-500">Current stock</p><p className="font-semibold text-slate-800">{context.current_stock} units</p></div>
              <div><p className="text-slate-500">Reorder point</p><p className="font-semibold text-slate-800">{Math.round(context.reorder_point)} units</p></div>
              <div><p className="text-slate-500">Recommended quantity</p><p className="font-semibold text-brand-700">{context.recommended_quantity} units</p></div>
              <div><p className="text-slate-500">Supplier lead time</p><p className="font-semibold text-slate-800">{context.lead_time_days} days</p></div>
              <div><p className="text-slate-500">Unit cost</p><p className="font-semibold text-slate-800">{formatINR(context.unit_cost, false)}</p></div>
              <div><p className="text-slate-500">Estimated total</p><p className="font-semibold text-slate-800">{formatINR(estimatedCost, false)}</p></div>
            </div>
            <p className="mt-2 text-[10px] text-slate-400">Recommended quantity uses EOQ with lead-time cover — based on demo assumptions in Settings.</p>
          </div>
        )}

        {underRecommended && context && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Recommended quantity is <strong>{context.recommended_quantity}</strong> units, but you entered{" "}
              <strong>{Number(quantity)}</strong>. This may not cover expected demand during the replenishment cycle.
            </p>
          </div>
        )}

        {expectedDate && context && (
          <p className="text-xs text-slate-500">
            Expected delivery {formatDate(expectedDate)} — {context.lead_time_days} days after ordering
            {selectedSupplier ? ` with ${selectedSupplier.name}` : ""}.
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <Button variant="secondary" size="sm" onClick={close}>Cancel</Button>
          <Button
            size="sm"
            loading={create.isPending}
            disabled={!selectedProduct || !supplierId || !(Number(quantity) > 0)}
            onClick={() => create.mutate()}
          >
            Create Purchase Order
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
