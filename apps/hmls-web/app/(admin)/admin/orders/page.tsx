"use client";

import { ChevronRight, ClipboardList, Plus, Save } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DateTime } from "@/components/ui/DateTime";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  type Customer,
  useAdminCustomers,
  useAdminDashboard,
  useAdminOrders,
} from "@/hooks/useAdmin";
import { useApi } from "@/hooks/useApi";
import {
  buildCreateOrderPayload,
  emptyManualOrderForm,
  type ManualOrderForm,
  validateManualOrderForm,
} from "@/lib/admin-create-order";
import {
  type AdminOrdersFilter,
  getAdminOrderDetailHref,
  getAdminOrdersListHref,
  parseAdminOrdersFilter,
} from "@/lib/admin-order-filters";
import { adminPaths } from "@/lib/api-paths";
import { formatCents } from "@/lib/format";
import { ORDER_STATUS, type StatusConfig } from "@/lib/status-display";
import { cn } from "@/lib/utils";

/* ── Helpers ──────────────────────────────────────────────────────────── */

function OrderStatusBadge({
  status,
  config,
}: {
  status: string;
  config: Record<string, StatusConfig>;
}) {
  const entry = config[status] ?? {
    label: status,
    color: "bg-neutral-100 text-neutral-500",
  };
  return (
    <Badge variant="outline" className={cn(entry.color)}>
      {entry.label}
    </Badge>
  );
}

/* ── Grouped filters ────────────────────────────────────────────────── */

const FILTER_GROUPS = [
  { value: "", label: "All" },
  { value: "draft", label: "Pending Review" },
  { value: "estimated", label: "Sent" },
  { value: "approved", label: "Approved" },
  { value: "scheduled", label: "Scheduled" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
] satisfies { value: AdminOrdersFilter; label: string }[];

const MORE_FILTERS = [
  { value: "declined", label: "Declined" },
  { value: "revised", label: "Revised" },
  { value: "cancelled", label: "Cancelled" },
] satisfies { value: AdminOrdersFilter; label: string }[];

/* ── Manual create order dialog ──────────────────────────────────────── */

function customerLabel(customer: Customer) {
  return (
    [customer.name, customer.phone, customer.email]
      .filter(Boolean)
      .join(" · ") || `Customer #${customer.id}`
  );
}

function ManualOrderFormFields({
  form,
  customers,
  onChange,
}: {
  form: ManualOrderForm;
  customers: Customer[];
  onChange: (form: ManualOrderForm) => void;
}) {
  const set = (key: keyof ManualOrderForm, value: string) =>
    onChange({ ...form, [key]: value });

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="manual-order-customer">Customer</Label>
        <Select
          value={form.customerId}
          onValueChange={(value) => set("customerId", value)}
        >
          <SelectTrigger id="manual-order-customer" className="w-full">
            <SelectValue placeholder="Choose an existing customer" />
          </SelectTrigger>
          <SelectContent>
            {customers.map((customer) => (
              <SelectItem key={customer.id} value={String(customer.id)}>
                {customerLabel(customer)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="manual-order-description">Order notes</Label>
        <Textarea
          id="manual-order-description"
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="Describe what the customer needs..."
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="manual-order-vehicle-year">Vehicle</Label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Input
            id="manual-order-vehicle-year"
            inputMode="numeric"
            value={form.vehicleYear}
            onChange={(e) => set("vehicleYear", e.target.value)}
            placeholder="Year"
          />
          <Input
            value={form.vehicleMake}
            onChange={(e) => set("vehicleMake", e.target.value)}
            placeholder="Make"
          />
          <Input
            value={form.vehicleModel}
            onChange={(e) => set("vehicleModel", e.target.value)}
            placeholder="Model"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="manual-order-item-description">Service item</Label>
        <Input
          id="manual-order-item-description"
          value={form.itemDescription}
          onChange={(e) => set("itemDescription", e.target.value)}
          placeholder="Example: Brake inspection"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input
            inputMode="decimal"
            value={form.laborHours}
            onChange={(e) => set("laborHours", e.target.value)}
            placeholder="Labor hours"
          />
          <Input
            inputMode="decimal"
            value={form.partsCost}
            onChange={(e) => set("partsCost", e.target.value)}
            placeholder="Parts cost"
          />
        </div>
      </div>
    </div>
  );
}

function CreateOrderDialog({
  open,
  customers,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  customers: Customer[];
  onOpenChange: (open: boolean) => void;
  onCreated: (id: number) => void;
}) {
  const api = useApi();
  const [form, setForm] = useState<ManualOrderForm>(emptyManualOrderForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    const validationError = validateManualOrderForm(form);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const order = await api.post<{ id: number }>(
        adminPaths.orders(),
        buildCreateOrderPayload(form),
      );
      onCreated(order.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create order failed");
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (nextOpen) {
          setForm(emptyManualOrderForm());
          setError(null);
          setSaving(false);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">New Order</DialogTitle>
          <DialogDescription>
            Manually create a draft order for an existing customer.
          </DialogDescription>
        </DialogHeader>

        <ManualOrderFormFields
          form={form}
          customers={customers}
          onChange={setForm}
        />

        {customers.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Add a customer first, then create an order from this page.
          </p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={saving || customers.length === 0}
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? "Creating..." : "Create Order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Skeleton loading state ───────────────────────────────────────────── */

function OrdersSkeleton() {
  return (
    <div className="space-y-2">
      {["sk-1", "sk-2", "sk-3", "sk-4", "sk-5"].map((id) => (
        <Skeleton key={id} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────── */

export default function OrdersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filter = parseAdminOrdersFilter(searchParams.get("status"));
  const [showMore, setShowMore] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const {
    orders,
    isLoading,
    mutate: mutateOrders,
  } = useAdminOrders(filter || undefined);
  const { customers } = useAdminCustomers();
  const { data: dashboard } = useAdminDashboard();
  const pendingReviewCount = dashboard?.stats.pendingReview ?? 0;

  const isMoreActive = MORE_FILTERS.some((f) => f.value === filter);
  const setFilter = (nextFilter: typeof filter) => {
    router.replace(getAdminOrdersListHref(nextFilter), { scroll: false });
  };
  const handleOrderCreated = async (id: number) => {
    setShowCreate(false);
    await mutateOrders();
    router.push(getAdminOrderDetailHref(id, filter));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-display font-bold text-foreground">
          Orders
        </h1>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" />
          New Order
        </Button>
      </div>

      <CreateOrderDialog
        open={showCreate}
        customers={customers}
        onOpenChange={setShowCreate}
        onCreated={handleOrderCreated}
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {FILTER_GROUPS.map((opt) => {
          const showCount = opt.value === "draft" && pendingReviewCount > 0;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setFilter(opt.value)}
              className={cn(
                "text-xs font-medium px-3 py-1.5 rounded-full transition-colors inline-flex items-center gap-1.5",
                filter === opt.value
                  ? "bg-primary text-white"
                  : "bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary",
              )}
            >
              {opt.label}
              {showCount && (
                <span
                  className={cn(
                    "rounded-full text-[10px] leading-none px-1.5 py-0.5 font-semibold",
                    filter === opt.value
                      ? "bg-white text-primary"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
                  )}
                >
                  {pendingReviewCount}
                </span>
              )}
            </button>
          );
        })}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className={cn(
              "text-xs font-medium px-3 py-1.5 rounded-full transition-colors",
              isMoreActive
                ? "bg-primary text-white"
                : "bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary",
            )}
          >
            More {showMore ? "\u25B2" : "\u25BC"}
          </button>
          {showMore && (
            <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-10 py-1 min-w-[140px]">
              {MORE_FILTERS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setFilter(opt.value);
                    setShowMore(false);
                  }}
                  className={cn(
                    "w-full text-left text-xs px-3 py-1.5 hover:bg-muted transition-colors",
                    filter === opt.value
                      ? "text-primary font-medium"
                      : "text-muted-foreground",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {isLoading ? (
        <OrdersSkeleton />
      ) : orders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <ClipboardList className="w-10 h-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              {filter ? `No ${filter} orders.` : "No orders yet."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {orders.map((order) => {
            const vehicle = order.vehicleInfo;
            const vehicleStr = vehicle
              ? [vehicle.year, vehicle.make, vehicle.model]
                  .filter(Boolean)
                  .join(" ")
              : null;
            const items = order.items ?? [];

            return (
              <Link
                key={order.id}
                href={getAdminOrderDetailHref(order.id, filter)}
                prefetch={false}
                className="flex items-center justify-between gap-3 bg-card border border-border rounded-xl p-4 hover:border-primary transition-colors group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      #{order.id}
                    </span>
                    <OrderStatusBadge
                      status={order.status}
                      config={ORDER_STATUS}
                    />
                    {order.revisionNumber > 1 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400">
                        v{order.revisionNumber}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground truncate hidden sm:inline">
                    {order.contactName ?? "Unknown"}
                    {vehicleStr && ` \u00B7 ${vehicleStr}`}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    <DateTime value={order.createdAt} format="datetime" />
                  </span>
                  {items.length > 0 && (
                    <span className="text-xs font-medium text-foreground">
                      {formatCents(order.subtotalCents ?? 0)}
                    </span>
                  )}
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
