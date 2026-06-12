"use client";

import type * as L from "leaflet";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { REGIONS } from "@/lib/business";
import {
  boundsForView,
  type MapView,
  nearestRegion,
  SERVICE_CITIES,
} from "@/lib/map-cities";
import "leaflet/dist/leaflet.css";

// Leaflet components must be dynamically imported to avoid SSR issues
const MapContainer = dynamic(
  () => import("react-leaflet").then((mod) => mod.MapContainer),
  { ssr: false },
);
const TileLayer = dynamic(
  () => import("react-leaflet").then((mod) => mod.TileLayer),
  { ssr: false },
);
const Marker = dynamic(
  () => import("react-leaflet").then((mod) => mod.Marker),
  { ssr: false },
);
const Popup = dynamic(() => import("react-leaflet").then((mod) => mod.Popup), {
  ssr: false,
});

interface MapProps {
  className?: string;
}

// How long we wait for /api/geo before falling back to the overview.
const GEO_TIMEOUT_MS = 800;

/** Initial view from Vercel IP geo — "all" when unavailable or far away. */
async function detectInitialView(): Promise<MapView> {
  try {
    const res = await fetch("/api/geo", {
      signal: AbortSignal.timeout(GEO_TIMEOUT_MS),
    });
    if (!res.ok) return "all";
    const { lat, lng } = (await res.json()) as {
      lat: number | null;
      lng: number | null;
    };
    if (lat == null || lng == null) return "all";
    return nearestRegion(lat, lng) ?? "all";
  } catch {
    return "all";
  }
}

const VIEW_OPTIONS: { view: MapView; label: string }[] = [
  { view: "sj", label: REGIONS.sj.label },
  { view: "oc", label: REGIONS.oc.label },
  { view: "all", label: "All" },
];

export default function RealMap({ className = "" }: MapProps) {
  const [Leaflet, setLeaflet] = useState<typeof L | null>(null);
  // null = still resolving (leaflet + geo race together at mount)
  const [view, setView] = useState<MapView | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [leaflet, initialView] = await Promise.all([
        import("leaflet"),
        detectInitialView(),
      ]);
      if (cancelled) return;

      // Fix Leaflet's default icon path issues
      delete (leaflet.Icon.Default.prototype as { _getIconUrl?: string })
        ._getIconUrl;
      leaflet.Icon.Default.mergeOptions({
        iconRetinaUrl:
          "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
        iconUrl:
          "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
        shadowUrl:
          "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
      });

      setLeaflet(leaflet);
      setView(initialView);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Create a single shared icon instance (stable across renders)
  // Must be called unconditionally (before early return) to satisfy hooks rules
  const customIcon = useMemo(
    () =>
      Leaflet?.divIcon({
        className: "custom-map-marker",
        html: '<div style="width:12px;height:12px;background:#dc2626;border-radius:50%;box-shadow:0 0 12px rgba(220,38,38,0.5);border:2px solid white;"></div>',
        iconSize: [12, 12] as [number, number],
        iconAnchor: [6, 6] as [number, number],
      }),
    [Leaflet],
  );

  if (!Leaflet || !customIcon || view === null) {
    return (
      <div
        className={`w-full h-full bg-surface-alt flex items-center justify-center ${className}`}
      >
        <div className="text-red-primary animate-pulse">Loading Map…</div>
      </div>
    );
  }

  return (
    <div
      className={`relative w-full h-full overflow-hidden rounded-2xl ${className}`}
    >
      {/* key={view}: react-leaflet only applies bounds at creation, so a view
          switch remounts the map with the new camera. Markers always show
          both metros — the view only moves the camera. */}
      <MapContainer
        key={view}
        bounds={boundsForView(view)}
        boundsOptions={{ padding: [24, 24] }}
        scrollWheelZoom={false}
        className="w-full h-full z-0"
        zoomControl={false}
      >
        {/* Light Positron Tile Layer */}
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />

        {/* Markers for served cities across both metros */}
        {SERVICE_CITIES.map((city) => (
          <Marker key={city.name} position={city.coords} icon={customIcon}>
            <Popup className="custom-popup">
              <div className="text-text font-medium text-sm">{city.name}</div>
              <div className="text-xs text-text-secondary">
                Mobile Service Available
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {/* Border Overlay */}
      <div className="absolute inset-0 pointer-events-none border border-border rounded-2xl z-[400]" />

      {/* Metro Toggle */}
      <div className="absolute top-4 left-4 flex gap-1 p-1 bg-surface/90 border border-border rounded-lg backdrop-blur-sm z-[400]">
        {VIEW_OPTIONS.map((opt) => (
          <button
            key={opt.view}
            type="button"
            onClick={() => setView(opt.view)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
              view === opt.view
                ? "bg-red-primary text-white"
                : "text-text-secondary hover:text-text"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Coverage Label */}
      <div className="absolute bottom-4 right-4 px-3 py-1.5 bg-surface/90 border border-border rounded-lg text-[10px] text-red-primary font-semibold uppercase tracking-widest backdrop-blur-sm z-[400]">
        Service Coverage
      </div>
    </div>
  );
}
