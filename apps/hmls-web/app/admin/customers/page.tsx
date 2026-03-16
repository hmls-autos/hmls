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
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import {
  type Customer,
  useAdminCustomer,
  useAdminCustomers,
} from "@/hooks/useAdmin";
import { authFetch } from "@/lib/fetcher";
import { formatCents, formatDate } from "@/lib/format";

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

const inputClass =
  "w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-red-primary/50 focus:border-red-primary";

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
      <div>
        <label
          htmlFor="customer-name"
          className="block text-xs font-medium text-text-secondary mb-1"
        >
          Name
        </label>
        <input
          id="customer-name"
          type="text"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Full name"
          className={inputClass}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="customer-phone"
            className="block text-xs font-medium text-text-secondary mb-1"
          >
            Phone
          </label>
          <input
            id="customer-phone"
            type="tel"
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="(555) 123-4567"
            className={inputClass}
          />
        </div>
        <div>
          <label
            htmlFor="customer-email"
            className="block text-xs font-medium text-text-secondary mb-1"
          >
            Email
          </label>
          <input
            id="customer-email"
            type="email"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="email@example.com"
            className={inputClass}
          />
        </div>
      </div>
      <div>
        <label
          htmlFor="customer-address"
          className="block text-xs font-medium text-text-secondary mb-1"
        >
          Address
        </label>
        <input
          id="customer-address"
          type="text"
          value={form.address}
          onChange={(e) => set("address", e.target.value)}
          placeholder="Street address"
          className={inputClass}
        />
      </div>
      <div>
        <label
          htmlFor="customer-vehicle-year"
          className="block text-xs font-medium text-text-secondary mb-1"
        >
          Vehicle
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            id="customer-vehicle-year"
            type="text"
            value={form.vehicleYear}
            onChange={(e) => set("vehicleYear", e.target.value)}
            placeholder="Year"
            className={inputClass}
          />
          <input
            type="text"
            value={form.vehicleMake}
            onChange={(e) => set("vehicleMake", e.target.value)}
            placeholder="Make"
            className={inputClass}
          />
          <input
            type="text"
            value={form.vehicleModel}
            onChange={(e) => set("vehicleModel", e.target.value)}
            placeholder="Model"
            className={inputClass}
          />
        </div>
      </div>
    </div>
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
    return (
      <div className="flex items-center justify-center py-10">
        <Spinner className="w-5 h-5" />
      </div>
    );
  }

  const { customer, bookings, estimates, quotes } = data;

  // ---------- Edit mode ----------
  if (editing) {
    return (
      <div className="bg-surface border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-display font-bold text-text">
            Edit Customer
          </h3>
          <button
            type="button"
            onClick={cancelEdit}
            className="p-1.5 rounded-lg hover:bg-surface-alt text-text-secondary"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <CustomerFormFields form={form} onChange={setForm} />

        {error && <p className="text-xs text-red-500 mt-3">{error}</p>}

        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={saveEdit}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-red-primary text-white text-sm font-medium rounded-lg hover:bg-red-dark disabled:opacity-50 transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={cancelEdit}
            className="px-4 py-2 text-sm text-text-secondary hover:text-text transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ---------- View mode ----------
  const vehicle = customer.vehicleInfo;

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-display font-bold text-text">
            {customer.name ?? "Unnamed"}
          </h3>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-text-secondary">
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
          <button
            type="button"
            onClick={startEdit}
            className="p-1.5 rounded-lg hover:bg-surface-alt text-text-secondary hover:text-text transition-colors"
            title="Edit customer"
          >
            <Pencil className="w-4 h-4" />
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-1 ml-1">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="px-2 py-1 text-xs bg-red-500 text-white rounded-md hover:bg-red-600 disabled:opacity-50"
              >
                {deleting ? "..." : "Confirm"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="px-2 py-1 text-xs text-text-secondary hover:text-text"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 rounded-lg hover:bg-red-50 text-text-secondary hover:text-red-500 dark:hover:bg-red-500/10 transition-colors"
              title="Delete customer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

      <span className="text-xs text-text-secondary">
        Since {formatDate(customer.createdAt)}
      </span>

      {vehicle && (vehicle.year || vehicle.make || vehicle.model) && (
        <p className="text-sm text-text-secondary mt-2">
          Vehicle:{" "}
          {[vehicle.year, vehicle.make, vehicle.model]
            .filter(Boolean)
            .join(" ")}
        </p>
      )}

      {customer.address && (
        <p className="text-sm text-text-secondary mt-1">{customer.address}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center border-t border-border pt-4 mt-4">
        <div>
          <p className="text-xl font-display font-bold text-text">
            {bookings.length}
          </p>
          <p className="text-xs text-text-secondary">Bookings</p>
        </div>
        <div>
          <p className="text-xl font-display font-bold text-text">
            {estimates.length}
          </p>
          <p className="text-xs text-text-secondary">Estimates</p>
        </div>
        <div>
          <p className="text-xl font-display font-bold text-text">
            {quotes.length}
          </p>
          <p className="text-xs text-text-secondary">Quotes</p>
        </div>
      </div>

      {bookings.length > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
            Bookings
          </h4>
          <div className="space-y-2">
            {bookings.slice(0, 5).map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-text truncate">{b.serviceType}</span>
                <span className="text-xs text-text-secondary shrink-0 ml-2">
                  {formatDate(b.scheduledAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {quotes.length > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
            Quotes
          </h4>
          <div className="space-y-2">
            {quotes.slice(0, 5).map((q) => (
              <div
                key={q.id}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-text">{formatCents(q.totalAmount)}</span>
                <span className="text-xs text-text-secondary capitalize">
                  {q.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Create Customer Modal ----------

function CreateCustomerModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop overlay is click-to-dismiss, not a keyboard-interactive element */}
      <div
        className="absolute inset-0 bg-black/50"
        role="presentation"
        onClick={onClose}
      />
      {/* Modal */}
      <div className="relative bg-surface border border-border rounded-xl p-6 w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-display font-bold text-text">
            New Customer
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-alt text-text-secondary"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <CustomerFormFields form={form} onChange={setForm} />

        {error && <p className="text-xs text-red-500 mt-3">{error}</p>}

        <div className="flex gap-2 mt-5">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-red-primary text-white text-sm font-medium rounded-lg hover:bg-red-dark disabled:opacity-50 transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? "Creating..." : "Create Customer"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-secondary hover:text-text transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
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
        <h1 className="text-2xl font-display font-bold text-text">Customers</h1>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-red-primary text-white text-sm font-medium rounded-lg hover:bg-red-dark transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Customer
        </button>
      </div>
      <p className="text-sm text-text-secondary mb-6">
        All registered customers.
      </p>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
        <input
          type="text"
          placeholder="Search by name, email, or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 bg-surface border border-border rounded-lg text-sm text-text placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-red-primary/50 focus:border-red-primary"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Customer list */}
        <div>
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Spinner className="w-5 h-5" />
            </div>
          ) : customers.length === 0 ? (
            <EmptyState
              icon={Users}
              message={
                search ? "No customers match your search." : "No customers yet."
              }
            />
          ) : (
            <div className="bg-surface border border-border rounded-xl divide-y divide-border">
              {customers.map((c) => (
                <Link
                  key={c.id}
                  href={`/admin/customers?id=${c.id}`}
                  className={`block px-4 py-3 hover:bg-surface-alt transition-colors first:rounded-t-xl last:rounded-b-xl ${
                    selectedId === c.id ? "bg-surface-alt" : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-text font-medium truncate">
                      {c.name ?? "Unnamed"}
                    </p>
                    <span className="text-xs text-text-secondary shrink-0 ml-2">
                      {formatDate(c.createdAt)}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary truncate mt-0.5">
                    {c.email ?? c.phone ?? "No contact info"}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Customer detail */}
        <div>
          {selectedId ? (
            <CustomerDetail id={selectedId} onDeleted={handleDeleted} />
          ) : (
            <EmptyState
              icon={Users}
              message="Select a customer to view details."
            />
          )}
        </div>
      </div>

      {showCreate && (
        <CreateCustomerModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
