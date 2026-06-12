"use client";

import type * as L from "leaflet";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { SERVICE_CITIES } from "@/lib/map-cities";
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

// Bounds derive from the marker data — adding a city can never clip off-view.
const BOUNDS: [number, number][] = SERVICE_CITIES.map((c) => c.coords);

export default function RealMap({ className = "" }: MapProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [Leaflet, setLeaflet] = useState<typeof L | null>(null);

  useEffect(() => {
    (async () => {
      const leaflet = await import("leaflet");
      setLeaflet(leaflet);

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

      setIsMounted(true);
    })();
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

  if (!isMounted || !Leaflet || !customIcon) {
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
      <MapContainer
        bounds={BOUNDS}
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

      {/* Coverage Label */}
      <div className="absolute bottom-4 right-4 px-3 py-1.5 bg-surface/90 border border-border rounded-lg text-[10px] text-red-primary font-semibold uppercase tracking-widest backdrop-blur-sm z-[400]">
        Service Coverage
      </div>
    </div>
  );
}
