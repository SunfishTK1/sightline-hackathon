"use client";

/** @owner Daphne — outdoor campus map (OpenStreetMap, no API key) */
import { useEffect, useRef, useState } from "react";
import type { MapPin } from "@/lib/map-pins";
import { CAMPUS_CENTER } from "@/lib/campus-buildings";

type MapPayload = {
  pins: MapPin[];
  unlocated: { taskId: string; title: string }[];
  demo?: boolean;
};

type LeafletMap = {
  remove: () => void;
  setView: (ll: [number, number], z: number) => void;
};

type LeafletNs = {
  map: (node: HTMLElement) => LeafletMap;
  tileLayer: (
    url: string,
    opts: { attribution: string },
  ) => { addTo: (m: LeafletMap) => void };
  marker: (ll: [number, number]) => {
    addTo: (m: LeafletMap) => {
      bindPopup: (html: string) => { on: (e: string, fn: () => void) => void };
    };
  };
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function popupHtml(pin: MapPin): string {
  const route = [pin.pickup, pin.dropoff].filter(Boolean).join(" → ");
  return `<strong>${escapeHtml(pin.title)}</strong><br/>${escapeHtml(pin.building)}${
    route ? `<br/>${escapeHtml(route)}` : ""
  }<br/>$${pin.priceUsd}`;
}

function loadScript(src: string): Promise<void> {
  const existing = document.querySelector(`script[src="${src}"]`);
  if (existing) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function loadCss(href: string) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

export function CampusMap() {
  const elRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<MapPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const flyToRef = useRef<((pin: MapPin) => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/map")
      .then((res) => res.json())
      .then((body: { ok?: boolean; data?: MapPayload }) => {
        if (!cancelled && body.data) setData(body.data);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load open tasks.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!data || !elRef.current) return;
    const el = elRef.current;
    const pins = data.pins;
    let destroyed = false;
    let leafletMap: LeafletMap | null = null;

    async function mount() {
      loadCss("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");
      await loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");
      if (destroyed || !el) return;
      const L = (window as unknown as { L?: LeafletNs }).L;
      if (!L) {
        setError("Map tiles failed to load.");
        return;
      }
      const map = L.map(el);
      map.setView([CAMPUS_CENTER.lat, CAMPUS_CENTER.lng], 16);
      leafletMap = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
      }).addTo(map);
      for (const pin of pins) {
        L.marker([pin.lat, pin.lng])
          .addTo(map)
          .bindPopup(popupHtml(pin))
          .on("click", () => setActiveId(pin.taskId));
      }
      flyToRef.current = (pin) => {
        map.setView([pin.lat, pin.lng], 17);
      };
    }

    void mount();
    return () => {
      destroyed = true;
      leafletMap?.remove();
      el.replaceChildren();
    };
  }, [data]);

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="min-h-[420px] flex-1 overflow-hidden rounded-lg border border-border">
        <div ref={elRef} className="h-[70vh] min-h-[420px] w-full bg-muted" />
      </div>
      <aside className="w-full shrink-0 lg:w-72">
        {data?.demo ? (
          <p className="mb-3 text-xs text-muted-foreground">
            Demo pins until the live feed is wired. Outdoor buildings only.
          </p>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <ul className="space-y-2">
          {(data?.pins ?? []).map((pin) => (
            <li key={pin.taskId}>
              <button
                type="button"
                className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                  activeId === pin.taskId ? "border-foreground" : "border-border"
                }`}
                onClick={() => {
                  setActiveId(pin.taskId);
                  flyToRef.current?.(pin);
                }}
              >
                <span className="font-medium">{pin.title}</span>
                <span className="mt-1 block text-muted-foreground">
                  {pin.building} · ${pin.priceUsd}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {(data?.unlocated.length ?? 0) > 0 ? (
          <p className="mt-4 text-xs text-muted-foreground">
            {data!.unlocated.length} open task
            {data!.unlocated.length === 1 ? "" : "s"} without a known building.
          </p>
        ) : null}
      </aside>
    </div>
  );
}
