"use client";

import {
  Mail,
  Pencil,
  Phone,
  Plus,
  Save,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  type Customer,
  useAdminCustomer,
  useAdminCustomers,
} from "@/hooks/useAdmin";
import { authFetch } from "@/lib/fetcher";
import { formatCents, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

// ---------- Shared form fields ----------

interface CustomerFormData {
  name: string;
  phone: string;
  email: string;
  address: string;
  vehicleYear: string;
  vehicleMake: string;
  vehicleModel: string;
}

const emptyForm: CustomerFormData = {
  name: "",
  phone: "",
  email: "",
  address: "",
  vehicleYear: "",
  vehicleMake: "",
  vehicleModel: "",
};

function customerToForm(c: Customer): CustomerFormData {
  return {
    name: c.name ?? "",
    phone: c.phone ?? "",
    email: c.email ?? "",
    address: c.address ?? "",
    vehicleYear: c.vehicleInfo?.year ?? "",
    vehicleMake: c.vehicleInfo?.make ?? "",
    vehicleModel: c.vehicleInfo?.model ?? "",
  };
}

function formToPayload(f: CustomerFormData) {
  const vehicleInfo =
    f.vehicleYear || f.vehicleMake || f.vehicleModel
      ? {
          year: f.vehicleYear || undefined,
          make: f.vehicleMake || undefined,
          model: f.vehicleModel || undefined,
        }
      : null;
  return {
    name: f.name || null,
    phone: f.phone || null,
    email: f.email || null,
    address: f.address || null,
    vehicleInfo,
  };
}

function CustomerFormFields({
  form,
  onChange,
}: {
  form: CustomerFormData;
  onChange: (f: CustomerFormData) => void;
}) {
  const set = (key: keyof CustomerFormData, value: string) =>
    onChange({ ...form, [key]: value });

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="customer-name">Name</Label>
        <Input
          id="customer-name"
          type="text"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Full name"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="customer-phone">Phone</Label>
          <Input
            id="customer-phone"
            type="tel"
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="(555) 123-4567"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="customer-email">Email</Label>
          <Input
            id="customer-email"
            type="email"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="email@example.com"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="customer-address">Address</Label>
        <Input
          id="customer-address"
          type="text"
          value={form.address}
          onChange={(e) => set("address", e.target.value)}
          placeholder="Street address"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="customer-vehicle-year">Vehicle</Label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Input
            id="customer-vehicle-year"
            type="text"
            value={form.vehicleYear}
            onChange={(e) => set("vehicleYear", e.target.value)}
            placeholder="Year"
          />
          <Input
            type="text"
            value={form.vehicleMake}
            onChange={(e) => set("vehicleMake", e.target.value)}
            placeholder="Make"
          />
          <Input
            type="text"
            value={form.vehicleModel}
            onChange={(e) => set("vehicleModel", e.target.value)}
            placeholder="Model"
          />
        </div>
      </div>
    </div>
  );
}

// ---------- Skeleton Loading ----------

function SkeletonRow() {
  return (
    <div className="px-4 py-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-16" />
      </div>
      <Skeleton className="h-3 w-40" />
    </div>
  );
}

function CustomerListSkeleton() {
  return (
    <Card className="gap-0 py-0 divide-y divide-border">
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </Card>
  );
}

function SkeletonStat() {
  return (
    <div className="text-center space-y-1">
      <Skeleton className="h-6 w-8 mx-auto" />
      <Skeleton className="h-3 w-14 mx-auto" />
    </div>
  );
}

function CustomerDetailSkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="space-y-2">
          <Skeleton className="h-5 w-36" />
          <div className="flex gap-4">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-3 w-20" />
        <div className="grid grid-cols-3 gap-4">
          <SkeletonStat />
          <SkeletonStat />
          <SkeletonStat />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Customer Detail (view + edit) ----------

function CustomerDetail({
  id,
  onDeleted,
}: {
  id: number;
  onDeleted: () => void;
}) {
  const { data, isLoading, mutate: mutateDetail } = useAdminCustomer(id);
  const { mutate: mutateList } = useAdminCustomers();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<CustomerFormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset edit state when switching customers
  // biome-ignore lint/correctness/useExhaustiveDependencies: id prop triggers reset when customer changes
  useEffect(() => {
    setEditing(false);
    setConfirmDelete(false);
    setError(null);
  }, [id]);

  const startEdit = useCallback(() => {
    if (data?.customer) {
      setForm(customerToForm(data.customer));
      setEditing(true);
      setError(null);
    }
  }, [data]);

  const cancelEdit = () => {
    setEditing(false);
    setError(null);
  };

  const saveEdit = async () => {
    setSaving(true);
    setError(null);
    try {
      await authFetch(`/api/admin/customers/${id}`, {
        method: "PATCH",
        body: JSON.stringify(formToPayload(form)),
      });
      await Promise.all([mutateDetail(), mutateList()]);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await authFetch(`/api/admin/customers/${id}`, { method: "DELETE" });
      await mutateList();
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setDeleting(false);
    }
  };

  if (isLoading || !data) {
    return <CustomerDetailSkeleton />;
  }

  const { customer, bookings, estimates, quotes } = data;

  // ---------- Edit mode ----------
  if (editing) {
    return (
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-lg font-display font-bold">
            Edit Customer
          </CardTitle>
          <Button variant="ghost" size="icon-sm" onClick={cancelEdit}>
            <X className="w-4 h-4" />
          </Button>
        </CardHeader>

        <CardContent>
          <CustomerFormFields form={form} onChange={setForm} />

          {error && <p className="text-xs text-destructive mt-3">{error}</p>}

          <div className="flex gap-2 mt-4">
            <Button onClick={saveEdit} disabled={saving} size="sm">
              <Save className="w-3.5 h-3.5" />
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button variant="ghost" size="sm" onClick={cancelEdit}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---------- View mode ----------
  const vehicle = customer.vehicleInfo;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle className="text-lg font-display font-bold">
            {customer.name ?? "Unnamed"}
          </CardTitle>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-muted-foreground">
            {customer.email && (
              <span className="flex items-center gap-1">
                <Mail className="w-3 h-3" />
                {customer.email}
              </span>
            )}
            {customer.phone && (
              <span className="flex items-center gap-1">
                <Phone className="w-3 h-3" />
                {customer.phone}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={startEdit}
            title="Edit customer"
          >
            <Pencil className="w-4 h-4" />
          </Button>
          {confirmDelete ? (
            <div className="flex items-center gap-1 ml-1">
              <Button
                variant="destructive"
                size="xs"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "..." : "Confirm"}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setConfirmDelete(true)}
              title="Delete customer"
              className="hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {error && <p className="text-xs text-destructive mb-3">{error}</p>}

        <span className="text-xs text-muted-foreground">
          Since {formatDate(customer.createdAt)}
        </span>

        {vehicle && (vehicle.year || vehicle.make || vehicle.model) && (
          <p className="text-sm text-muted-foreground mt-2">
            Vehicle:{" "}
            {[vehicle.year, vehicle.make, vehicle.model]
              .filter(Boolean)
              .join(" ")}
          </p>
        )}

        {customer.address && (
          <p className="text-sm text-muted-foreground mt-1">
            {customer.address}
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center border-t border-border pt-4 mt-4">
          <div>
            <p className="text-xl font-display font-bold text-foreground">
              {bookings.length}
            </p>
            <p className="text-xs text-muted-foreground">Bookings</p>
          </div>
          <div>
            <p className="text-xl font-display font-bold text-foreground">
              {estimates.length}
            </p>
            <p className="text-xs text-muted-foreground">Estimates</p>
          </div>
          <div>
            <p className="text-xl font-display font-bold text-foreground">
              {quotes.length}
            </p>
            <p className="text-xs text-muted-foreground">Quotes</p>
          </div>
        </div>

        {bookings.length > 0 && (
          <div className="mt-4 border-t border-border pt-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Bookings
            </h4>
            <div className="space-y-2">
              {bookings.slice(0, 5).map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-foreground truncate">
                    {b.serviceType}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0 ml-2">
                    {formatDate(b.scheduledAt)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {quotes.length > 0 && (
          <div className="mt-4 border-t border-border pt-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Quotes
            </h4>
            <div className="space-y-2">
              {quotes.slice(0, 5).map((q) => (
                <div
                  key={q.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-foreground">
                    {formatCents(q.totalAmount)}
                  </span>
                  <span className="text-xs text-muted-foreground capitalize">
                    {q.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Create Customer Modal ----------

function CreateCustomerModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: number) => void;
}) {
  const [form, setForm] = useState<CustomerFormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!form.name && !form.email && !form.phone) {
      setError("At least one of name, email, or phone is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const customer = await authFetch<{ id: number }>("/api/admin/customers", {
        method: "POST",
        body: JSON.stringify(formToPayload(form)),
      });
      onCreated(customer.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
      setSaving(false);
    }
  };

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setForm(emptyForm);
      setError(null);
      setSaving(false);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">New Customer</DialogTitle>
          <DialogDescription>
            Add a new customer to the system.
          </DialogDescription>
        </DialogHeader>

        <CustomerFormFields form={form} onChange={setForm} />

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="w-3.5 h-3.5" />
            {saving ? "Creating..." : "Create Customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Main Page ----------

export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const {
    customers,
    isLoading,
    mutate: mutateList,
  } = useAdminCustomers(search || undefined);
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedId = searchParams.get("id")
    ? Number(searchParams.get("id"))
    : null;
  const [showCreate, setShowCreate] = useState(false);

  const handleCreated = async (id: number) => {
    setShowCreate(false);
    await mutateList();
    router.push(`/admin/customers?id=${id}`);
  };

  const handleDeleted = () => {
    router.push("/admin/customers");
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-display font-bold text-foreground">
          Customers
        </h1>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" />
          New Customer
        </Button>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        All registered customers.
      </p>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search by name, email, or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Customer list */}
        <div>
          {isLoading ? (
            <CustomerListSkeleton />
          ) : customers.length === 0 ? (
            <Card className="py-10">
              <CardContent className="flex flex-col items-center justify-center text-center">
                <Users className="w-10 h-10 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">
                  {search
                    ? "No customers match your search."
                    : "No customers yet."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className="gap-0 py-0 divide-y divide-border">
              {customers.map((c) => (
                <Link
                  key={c.id}
                  href={`/admin/customers?id=${c.id}`}
                  className={cn(
                    "block px-4 py-3 transition-colors first:rounded-t-xl last:rounded-b-xl",
                    selectedId === c.id ? "bg-muted" : "hover:bg-muted",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-foreground font-medium truncate">
                      {c.name ?? "Unnamed"}
                    </p>
                    <span className="text-xs text-muted-foreground shrink-0 ml-2">
                      {formatDate(c.createdAt)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {c.email ?? c.phone ?? "No contact info"}
                  </p>
                </Link>
              ))}
            </Card>
          )}
        </div>

        {/* Customer detail */}
        <div>
          {selectedId ? (
            <CustomerDetail id={selectedId} onDeleted={handleDeleted} />
          ) : (
            <Card className="py-10">
              <CardContent className="flex flex-col items-center justify-center text-center">
                <Users className="w-10 h-10 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">
                  Select a customer to view details.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <CreateCustomerModal
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={handleCreated}
      />
    </div>
  );
}
