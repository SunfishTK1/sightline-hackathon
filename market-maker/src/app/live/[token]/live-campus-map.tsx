"use client";

/**
 * Real outdoor campus map for one live job.
 *
 * Building coords and Leaflet loading follow Daphne's campus map
 * (`gotchu/lib/campus-buildings.ts`, `gotchu/components/map/CampusMap.tsx`).
 * Tiles are OpenStreetMap, then washed green so it reads like a tartan
 * station board instead of a default street map.
 */
import { useEffect, useRef, useState } from "react";
import { findPlacesInText, resolvePlace } from "@/lib/market/campus-travel";

/** Same center Daphne uses on the open-task map. */
const CAMPUS_CENTER = { lat: 40.4436, lng: -79.9444 };

type Station = { name: string; lat: number; lng: number; role: "pickup" | "dropoff" };

type LeafletMap = {
  remove: () => void;
  invalidateSize: () => void;
  fitBounds: (b: Array<[number, number]>, opts?: { padding: [number, number] }) => void;
  setView: (ll: [number, number], z: number) => void;
};

type LeafletNs = {
  map: (node: HTMLElement, opts?: { zoomControl?: boolean; attributionControl?: boolean }) => LeafletMap;
  tileLayer: (
    url: string,
    opts: { attribution: string; maxZoom?: number },
  ) => { addTo: (m: LeafletMap) => void };
  circleMarker: (
    ll: [number, number],
    opts: {
      radius: number;
      color: string;
      weight: number;
      fillColor: string;
      fillOpacity: number;
    },
  ) => {
    addTo: (m: LeafletMap) => {
      bindTooltip: (
        html: string,
        opts: { permanent: boolean; direction: string; className: string; offset: [number, number] },
      ) => unknown;
    };
  };
  polyline: (
    lls: Array<[number, number]>,
    opts: { color: string; weight: number; dashArray: string; opacity: number },
  ) => { addTo: (m: LeafletMap) => void };
};

function loadCss(href: string) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function loadScript(src: string): Promise<void> {
  if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("leaflet failed to load"));
    document.head.appendChild(el);
  });
}

function stationsFor(title: string, pickup?: string | null, dropoff?: string | null): Station[] {
  const fromTitle = findPlacesInText(title);
  const from = resolvePlace(pickup) ?? fromTitle[0] ?? null;
  const to =
    resolvePlace(dropoff) ??
    fromTitle.find((place) => place.name !== from?.name) ??
    null;
  const out: Station[] = [];
  if (from) out.push({ name: from.name, lat: from.lat, lng: from.lng, role: "pickup" });
  if (to && to.name !== from?.name) {
    out.push({ name: to.name, lat: to.lat, lng: to.lng, role: "dropoff" });
  }
  return out;
}

export function LiveCampusMap({
  title,
  pickup,
  dropoff,
}: {
  title: string;
  pickup?: string | null;
  dropoff?: string | null;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const stations = stationsFor(title, pickup, dropoff);
  const route = stations.map((s) => s.name).join(" → ");

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    let destroyed = false;
    let map: LeafletMap | null = null;

    async function waitForLeaflet(): Promise<LeafletNs | null> {
      loadCss("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");
      await loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");
      for (let i = 0; i < 20; i += 1) {
        const L = (window as unknown as { L?: LeafletNs }).L;
        if (L) return L;
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
      return null;
    }

    async function mount() {
      try {
        const L = await waitForLeaflet();
        if (destroyed || !el) return;
        if (!L) {
          setFailed(true);
          return;
        }

        delete (el as unknown as { _leaflet_id?: number })._leaflet_id;
        map = L.map(el, { zoomControl: false, attributionControl: true });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "&copy; OpenStreetMap",
          maxZoom: 19,
        }).addTo(map);

        const coords = stations.map((s) => [s.lat, s.lng] as [number, number]);
        if (coords.length > 1) {
          L.polyline(coords, {
            color: "#14532d",
            weight: 5,
            dashArray: "10 8",
            opacity: 0.9,
          }).addTo(map);
          map.fitBounds(coords, { padding: [48, 48] });
        } else if (coords.length === 1) {
          map.setView(coords[0], 17);
        } else {
          map.setView([CAMPUS_CENTER.lat, CAMPUS_CENTER.lng], 16);
        }

        for (const station of stations) {
          L.circleMarker([station.lat, station.lng], {
            radius: 10,
            color: "#ecfdf5",
            weight: 3,
            fillColor: station.role === "pickup" ? "#166534" : "#4ade80",
            fillOpacity: 1,
          })
            .addTo(map)
            .bindTooltip(station.name, {
              permanent: true,
              direction: "top",
              className: "gotchu-station-label",
              offset: [0, -10],
            });
        }

        window.setTimeout(() => map?.invalidateSize(), 80);
      } catch {
        setFailed(true);
      }
    }

    void mount();
    return () => {
      destroyed = true;
      map?.remove();
      delete (el as unknown as { _leaflet_id?: number })._leaflet_id;
      el.replaceChildren();
    };
  }, [title, pickup, dropoff]);

  return (
    <section className="overflow-hidden rounded-[28px] border border-[#14532d]/20 bg-[#157a38] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
      <div className="flex items-end justify-between px-4 pt-3 pb-2 text-emerald-50">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.16em] uppercase">Campus line</p>
          <p className="text-sm font-semibold">{route || "Carnegie Mellon"}</p>
        </div>
        <p className="text-[10px] font-medium tracking-[0.12em] text-emerald-100/80 uppercase">
          Outdoor only · not GPS
        </p>
      </div>
      {failed ? (
        <p className="px-4 pb-4 text-sm text-emerald-50/90">
          The campus map could not load. The hop is still {route || "on campus"}.
        </p>
      ) : (
        <div className="relative">
          <div ref={elRef} className="gotchu-leaflet h-[280px] w-full sm:h-[320px]" />
          <div className="gotchu-leaflet-wash pointer-events-none absolute inset-0" />
        </div>
      )}
    </section>
  );
}
