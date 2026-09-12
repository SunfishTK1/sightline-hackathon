"use client";

/**
 * Where the job actually runs, under the live board.
 *
 * Leaflet comes off a CDN at runtime rather than being bundled - the board is
 * mostly text and should not carry a mapping library for the one task that has
 * two pinnable ends.
 */
import { useEffect, useRef, useState } from "react";

export type MapPoint = { name: string; lat: number; lng: number; role: "pickup" | "dropoff" };

type LeafletMap = {
  remove: () => void;
  fitBounds: (b: Array<[number, number]>, opts?: { padding: [number, number] }) => void;
  setView: (ll: [number, number], z: number) => void;
};

type LeafletNs = {
  map: (node: HTMLElement) => LeafletMap;
  tileLayer: (url: string, opts: { attribution: string }) => { addTo: (m: LeafletMap) => void };
  marker: (ll: [number, number]) => {
    addTo: (m: LeafletMap) => { bindPopup: (html: string) => unknown };
  };
  polyline: (
    lls: Array<[number, number]>,
    opts: { color: string; weight: number; dashArray: string },
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

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function TaskMap({ points }: { points: MapPoint[] }) {
  const elRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!points.length || !elRef.current) return;
    const el = elRef.current;
    let destroyed = false;
    let map: LeafletMap | null = null;

    async function mount() {
      try {
        loadCss("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");
        await loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");
        if (destroyed) return;
        const L = (window as unknown as { L?: LeafletNs }).L;
        if (!L) {
          setFailed(true);
          return;
        }

        map = L.map(el);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "&copy; OpenStreetMap",
        }).addTo(map);

        for (const p of points) {
          L.marker([p.lat, p.lng])
            .addTo(map)
            .bindPopup(`<strong>${escapeHtml(p.name)}</strong><br/>${p.role}`);
        }

        const coords = points.map((p) => [p.lat, p.lng] as [number, number]);
        if (coords.length > 1) {
          // The route is the point: a pickup and a drop-off with nothing
          // between them reads as two unrelated pins.
          L.polyline(coords, { color: "#1f5c3a", weight: 3, dashArray: "6 6" }).addTo(map);
          map.fitBounds(coords, { padding: [40, 40] });
        } else {
          map.setView(coords[0], 16);
        }
      } catch {
        setFailed(true);
      }
    }

    void mount();
    return () => {
      destroyed = true;
      map?.remove();
      el.replaceChildren();
    };
  }, [points]);

  if (!points.length) return null;

  return (
    <section className="mt-10">
      <h2 className="text-sm font-medium tracking-wide text-zinc-500 uppercase">Where it runs</h2>
      <p className="mt-1 text-sm text-zinc-600">
        {points.map((p) => p.name).join(" → ")}
      </p>
      {failed ? (
        <p className="mt-3 text-sm text-zinc-500">The map could not load, but the route is above.</p>
      ) : (
        <div
          ref={elRef}
          className="mt-3 h-[320px] w-full overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100"
        />
      )}
    </section>
  );
}
