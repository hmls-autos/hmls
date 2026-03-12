"use client";

import { Car, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:8001";

interface Vehicle {
  id: string;
  year: number | null;
  make: string;
  model: string;
  vin: string | null;
  nickname: string | null;
}

export default function VehiclesPage() {
  const { session } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    year: "",
    make: "",
    model: "",
    nickname: "",
  });

  const fetchVehicles = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      const res = await fetch(`${AGENT_URL}/vehicles`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setVehicles(data.vehicles ?? []);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    fetchVehicles();
  }, [fetchVehicles]);

  const handleAdd = async () => {
    if (!session?.access_token || !formData.make || !formData.model) return;
    setError(null);

    try {
      const res = await fetch(`${AGENT_URL}/vehicles`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          year: formData.year ? parseInt(formData.year, 10) : undefined,
          make: formData.make,
          model: formData.model,
          nickname: formData.nickname || undefined,
        }),
      });

      if (res.status === 403) {
        const data = await res.json();
        setError(data.message || "Upgrade required");
        return;
      }

      if (res.ok) {
        setShowForm(false);
        setFormData({ year: "", make: "", model: "", nickname: "" });
        await fetchVehicles();
      }
    } catch {
      setError("Failed to add vehicle");
    }
  };

  const handleDelete = async (id: string) => {
    if (!session?.access_token) return;
    try {
      const res = await fetch(`${AGENT_URL}/vehicles/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        setVehicles((v) => v.filter((veh) => veh.id !== id));
      }
    } catch {
      // silently fail
    }
  };

  return (
    <div className="flex flex-col h-dvh">
      <header className="sticky top-0 z-10 bg-surface/80 backdrop-blur-sm border-b border-border px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Vehicles</h1>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          Add
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 pb-24">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : vehicles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Car className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-lg font-semibold mb-2">No vehicles yet</h2>
            <p className="text-text-secondary text-sm max-w-xs mb-6">
              Add your vehicle for personalized diagnostics.
            </p>
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="px-6 py-2.5 rounded-xl bg-primary text-white font-medium"
            >
              Add Vehicle
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {vehicles.map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between bg-surface-alt rounded-xl p-4 border border-border"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Car className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">
                      {v.nickname ||
                        `${v.year ?? ""} ${v.make} ${v.model}`.trim()}
                    </p>
                    {v.nickname && (
                      <p className="text-sm text-text-secondary">
                        {[v.year, v.make, v.model].filter(Boolean).join(" ")}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(v.id)}
                  className="p-2 text-text-secondary hover:text-red-500 transition-colors"
                  aria-label="Delete vehicle"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Vehicle Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
          <div className="w-full max-w-lg bg-surface rounded-t-2xl p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Add Vehicle</h3>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setError(null);
                }}
                className="p-1 text-text-secondary hover:text-text"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

            <div className="space-y-3 mb-4">
              <input
                type="number"
                placeholder="Year (optional)"
                value={formData.year}
                onChange={(e) =>
                  setFormData({ ...formData, year: e.target.value })
                }
                className="w-full bg-surface-alt border border-border rounded-xl px-4 py-2.5 text-sm text-text placeholder-text-secondary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              <input
                type="text"
                placeholder="Make (e.g. Toyota)"
                value={formData.make}
                onChange={(e) =>
                  setFormData({ ...formData, make: e.target.value })
                }
                className="w-full bg-surface-alt border border-border rounded-xl px-4 py-2.5 text-sm text-text placeholder-text-secondary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              <input
                type="text"
                placeholder="Model (e.g. Camry)"
                value={formData.model}
                onChange={(e) =>
                  setFormData({ ...formData, model: e.target.value })
                }
                className="w-full bg-surface-alt border border-border rounded-xl px-4 py-2.5 text-sm text-text placeholder-text-secondary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              <input
                type="text"
                placeholder="Nickname (optional)"
                value={formData.nickname}
                onChange={(e) =>
                  setFormData({ ...formData, nickname: e.target.value })
                }
                className="w-full bg-surface-alt border border-border rounded-xl px-4 py-2.5 text-sm text-text placeholder-text-secondary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>

            <button
              type="button"
              onClick={handleAdd}
              disabled={!formData.make || !formData.model}
              className="w-full py-3 rounded-xl bg-primary text-white font-medium disabled:opacity-30 transition-opacity"
            >
              Add Vehicle
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
