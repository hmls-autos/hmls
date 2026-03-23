"use client";

import { Check, Pencil, User } from "lucide-react";
import { useState } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { usePortalCustomer } from "@/hooks/usePortal";
import { authFetch } from "@/lib/fetcher";

export default function ProfilePage() {
  const { customer, isLoading, mutate } = usePortalCustomer();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleYear, setVehicleYear] = useState("");

  function startEditing() {
    setName(customer?.name ?? "");
    setPhone(customer?.phone ?? "");
    setAddress(customer?.address ?? "");
    setVehicleMake(customer?.vehicleInfo?.make ?? "");
    setVehicleModel(customer?.vehicleInfo?.model ?? "");
    setVehicleYear(customer?.vehicleInfo?.year ?? "");
    setEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await authFetch("/api/portal/me", {
        method: "PUT",
        body: JSON.stringify({
          name: name || undefined,
          phone: phone || undefined,
          address: address || undefined,
          vehicleInfo: {
            make: vehicleMake || undefined,
            model: vehicleModel || undefined,
            year: vehicleYear || undefined,
          },
        }),
      });
      await mutate();
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    );
  }

  if (!customer) return null;

  const fields = [
    { label: "Name", value: customer.name },
    { label: "Email", value: customer.email },
    { label: "Phone", value: customer.phone },
    { label: "Address", value: customer.address },
    {
      label: "Vehicle",
      value:
        [
          customer.vehicleInfo?.year,
          customer.vehicleInfo?.make,
          customer.vehicleInfo?.model,
        ]
          .filter(Boolean)
          .join(" ") || null,
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-display font-bold text-text mb-1">
            Profile
          </h1>
          <p className="text-sm text-text-secondary">
            Your account information.
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={startEditing}
            className="flex items-center gap-2 text-sm font-medium text-red-primary hover:text-red-dark transition-colors"
          >
            <Pencil className="w-4 h-4" />
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="bg-surface border border-border rounded-xl p-5 space-y-4">
          <Field label="Name" value={name} onChange={setName} />
          <Field label="Email" value={customer.email ?? ""} disabled />
          <Field label="Phone" value={phone} onChange={setPhone} />
          <Field label="Address" value={address} onChange={setAddress} />
          <div className="border-t border-border pt-4">
            <p className="text-xs font-medium text-text-secondary mb-3 uppercase tracking-wide">
              Vehicle
            </p>
            <div className="grid grid-cols-3 gap-3">
              <Field
                label="Year"
                value={vehicleYear}
                onChange={setVehicleYear}
              />
              <Field
                label="Make"
                value={vehicleMake}
                onChange={setVehicleMake}
              />
              <Field
                label="Model"
                value={vehicleModel}
                onChange={setVehicleModel}
              />
            </div>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-red-primary text-white text-sm font-medium rounded-lg hover:bg-red-dark transition-colors disabled:opacity-50"
            >
              {saving ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl divide-y divide-border">
          <div className="flex items-center gap-4 p-5">
            <div className="w-12 h-12 rounded-full bg-red-light flex items-center justify-center">
              <User className="w-5 h-5 text-red-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-text">
                {customer.name ?? "—"}
              </p>
              <p className="text-xs text-text-secondary">
                {customer.email ?? "—"}
              </p>
            </div>
          </div>
          {fields.slice(2).map((f) => (
            <div key={f.label} className="flex justify-between px-5 py-3.5">
              <span className="text-xs text-text-secondary">{f.label}</span>
              <span className="text-sm text-text">{f.value ?? "—"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-text-secondary mb-1">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        disabled={disabled}
        className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-text placeholder:text-text-secondary focus:outline-none focus:border-red-primary disabled:opacity-50 disabled:cursor-not-allowed"
      />
    </label>
  );
}
