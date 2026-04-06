"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DoodleCanvas } from "@/components/DoodleCanvas";
import type {
  DoodleDocument,
  DoodleStroke,
  NeighborhoodFeature,
  NeighborhoodsResponse,
} from "@/types/game";

type MapLibreMap = {
  addControl: (control: unknown, position?: string) => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  off: (event: string, listener: (...args: unknown[]) => void) => void;
  remove: () => void;
  addSource: (id: string, source: unknown) => void;
  addLayer: (layer: unknown) => void;
  getSource: (id: string) => { setData: (data: unknown) => void } | undefined;
  setPaintProperty: (layerId: string, name: string, value: unknown) => void;
  fitBounds: (
    bounds: [[number, number], [number, number]],
    options?: { padding?: number; duration?: number }
  ) => void;
  setMaxBounds: (bounds: [[number, number], [number, number]] | null) => void;
  setMinZoom: (zoom: number) => void;
  getZoom: () => number;
  queryRenderedFeatures: (
    point: { x: number; y: number },
    options?: { layers?: string[] }
  ) => Array<{ properties?: Record<string, unknown> }>;
};

type MapLibreNamespace = {
  Map: new (options: {
    container: HTMLElement;
    style: string;
    center: [number, number];
    zoom: number;
    minZoom?: number;
    maxZoom?: number;
    maxBounds?: [[number, number], [number, number]];
  }) => MapLibreMap;
  NavigationControl: new () => unknown;
  AttributionControl: new (options?: {
    compact?: boolean;
    customAttribution?: string | string[];
  }) => unknown;
};

const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const NYC_CENTER: [number, number] = [-73.9665, 40.7812];
const NYC_FALLBACK_BOUNDS: [[number, number], [number, number]] = [
  [-74.2591, 40.4774],
  [-73.7004, 40.9176],
];
const NYC_OUTSIDE_MASK = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-180, -90],
            [180, -90],
            [180, 40.4774],
            [-180, 40.4774],
            [-180, -90],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-180, 40.9176],
            [180, 40.9176],
            [180, 90],
            [-180, 90],
            [-180, 40.9176],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-180, 40.4774],
            [-74.2591, 40.4774],
            [-74.2591, 40.9176],
            [-180, 40.9176],
            [-180, 40.4774],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-73.7004, 40.4774],
            [180, 40.4774],
            [180, 40.9176],
            [-73.7004, 40.9176],
            [-73.7004, 40.4774],
          ],
        ],
      },
    },
  ],
} as const;

function geometryBounds(feature: NeighborhoodFeature): [[number, number], [number, number]] {
  const coords =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  let minLng = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;

  for (const polygon of coords) {
    for (const ring of polygon) {
      for (const [lng, lat] of ring) {
        minLng = Math.min(minLng, lng);
        minLat = Math.min(minLat, lat);
        maxLng = Math.max(maxLng, lng);
        maxLat = Math.max(maxLat, lat);
      }
    }
  }

  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

function aggregateBounds(features: NeighborhoodFeature[]): [[number, number], [number, number]] {
  if (features.length === 0) {
    return NYC_FALLBACK_BOUNDS;
  }

  let minLng = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;

  for (const feature of features) {
    const bounds = geometryBounds(feature);
    minLng = Math.min(minLng, bounds[0][0]);
    minLat = Math.min(minLat, bounds[0][1]);
    maxLng = Math.max(maxLng, bounds[1][0]);
    maxLat = Math.max(maxLat, bounds[1][1]);
  }

  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

function toGeoJson(features: NeighborhoodFeature[]) {
  return {
    type: "FeatureCollection",
    features,
  };
}

function loadMapLibreScript(): Promise<MapLibreNamespace> {
  return new Promise((resolve, reject) => {
    const existing = (globalThis as { maplibregl?: MapLibreNamespace }).maplibregl;
    if (existing) {
      resolve(existing);
      return;
    }

    const cssId = "maplibre-css";
    if (!document.getElementById(cssId)) {
      const link = document.createElement("link");
      link.id = cssId;
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/maplibre-gl@5.3.0/dist/maplibre-gl.css";
      document.head.appendChild(link);
    }

    const script = document.createElement("script");
    script.src = "https://unpkg.com/maplibre-gl@5.3.0/dist/maplibre-gl.js";
    script.async = true;
    script.onload = () => {
      const maplibregl = (globalThis as { maplibregl?: MapLibreNamespace }).maplibregl;
      if (!maplibregl) {
        reject(new Error("MapLibre failed to initialize"));
        return;
      }
      resolve(maplibregl);
    };
    script.onerror = () => reject(new Error("Failed to load MapLibre script"));
    document.head.appendChild(script);
  });
}

export function MapDoodler() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const featuresRef = useRef<NeighborhoodFeature[]>([]);
  const boundsLockedRef = useRef(false);

  const [features, setFeatures] = useState<NeighborhoodFeature[]>([]);
  const [sourceViewId, setSourceViewId] = useState("9nt8-h7nd");
  const [sourceFetchedAt, setSourceFetchedAt] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [doodleDoc, setDoodleDoc] = useState<DoodleDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState({ total: 0, doodled: 0, remaining: 0, completionPct: 0 });

  const selectedFeature = useMemo(
    () => features.find((feature) => feature.properties.ntaCode === selectedCode) ?? null,
    [features, selectedCode]
  );

  const loadNeighborhoods = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/neighborhoods", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Unable to load neighborhoods (${response.status})`);
      }

      const payload = (await response.json()) as NeighborhoodsResponse;
      setFeatures(payload.features);
      setSourceViewId(payload.source.viewId);
      setSourceFetchedAt(payload.source.fetchedAt);
      setCounts(payload.counts);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDoodle = useCallback(async (ntaCode: string) => {
    const response = await fetch(`/api/doodles/${encodeURIComponent(ntaCode)}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      setDoodleDoc(null);
      return;
    }

    const payload = (await response.json()) as { doodle: DoodleDocument | null };
    setDoodleDoc(payload.doodle);
  }, []);

  useEffect(() => {
    void loadNeighborhoods();
  }, [loadNeighborhoods]);

  useEffect(() => {
    if (!selectedCode) {
      setDoodleDoc(null);
      return;
    }

    void loadDoodle(selectedCode);
  }, [selectedCode, loadDoodle]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const source = map.getSource("nta-source");
    if (!source) {
      return;
    }

    source.setData(toGeoJson(features));
  }, [features]);

  useEffect(() => {
    featuresRef.current = features;
  }, [features]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || features.length === 0 || boundsLockedRef.current) {
      return;
    }

    const bounds = aggregateBounds(features);
    map.setMaxBounds(bounds);
    map.fitBounds(bounds, { padding: 24, duration: 0 });
    map.setMinZoom(map.getZoom());
    boundsLockedRef.current = true;
  }, [features]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const selected = selectedCode ?? "";
    try {
      map.setPaintProperty("nta-selected", "fill-color", [
        "case",
        ["==", ["get", "ntaCode"], selected],
        "#2563eb",
        "rgba(0,0,0,0)",
      ]);
    } catch {
      // Layer may not be ready yet.
    }
  }, [selectedCode]);

  useEffect(() => {
    let cancelled = false;

    async function initMap() {
      const container = mapContainerRef.current;
      if (!container || mapRef.current) {
        return;
      }

      try {
        const maplibregl = await loadMapLibreScript();
        if (cancelled) {
          return;
        }

        const map = new maplibregl.Map({
          container,
          style: MAP_STYLE_URL,
          center: NYC_CENTER,
          zoom: 10,
          minZoom: 9,
          maxZoom: 16,
          maxBounds: NYC_FALLBACK_BOUNDS,
        });

        map.addControl(new maplibregl.NavigationControl(), "top-right");
        map.addControl(
          new maplibregl.AttributionControl({
            compact: true,
            customAttribution: [
              "Neighborhood boundaries: NYC Open Data (view 9nt8-h7nd)",
              "Map data: OpenStreetMap contributors",
            ],
          }),
          "bottom-right"
        );

        map.on("load", () => {
          map.addSource("outside-nyc-mask", {
            type: "geojson",
            data: NYC_OUTSIDE_MASK,
          });

          map.addLayer({
            id: "outside-nyc-mask-layer",
            type: "fill",
            source: "outside-nyc-mask",
            paint: {
              "fill-color": "#ffffff",
              "fill-opacity": 0.84,
            },
          });

          map.addSource("nta-source", {
            type: "geojson",
            data: toGeoJson(featuresRef.current),
          });

          map.addLayer({
            id: "nta-empty",
            type: "fill",
            source: "nta-source",
            paint: {
              "fill-color": [
                "case",
                ["==", ["get", "type"], "special"],
                "#94a3b8",
                ["==", ["get", "hasDoodle"], true],
                "#16a34a",
                "#f59e0b",
              ],
              "fill-opacity": ["case", ["==", ["get", "type"], "special"], 0.2, 0.35],
            },
          });

          map.addLayer({
            id: "nta-selected",
            type: "fill",
            source: "nta-source",
            paint: {
              "fill-color": "rgba(0,0,0,0)",
              "fill-opacity": 0.35,
            },
          });

          map.addLayer({
            id: "nta-outline",
            type: "line",
            source: "nta-source",
            paint: {
              "line-color": "#0f172a",
              "line-width": 1,
              "line-opacity": 0.65,
            },
          });

          map.on("click", (event: unknown) => {
            const e = event as { point: { x: number; y: number } };
            const hit = map.queryRenderedFeatures(e.point, {
              layers: ["nta-empty", "nta-outline"],
            })[0];
            const ntaCode =
              typeof hit?.properties?.ntaCode === "string" ? hit.properties.ntaCode : null;

            if (!ntaCode) {
              return;
            }

            setSelectedCode(ntaCode);
            const nextFeature = featuresRef.current.find(
              (feature) => feature.properties.ntaCode === ntaCode
            );
            if (nextFeature) {
              map.fitBounds(geometryBounds(nextFeature), { padding: 40, duration: 700 });
            }
          });
        });

        mapRef.current = map;
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Map initialization failed");
      }
    }

    void initMap();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  async function saveDoodle(strokes: DoodleStroke[]) {
    if (!selectedCode) {
      return;
    }

    const response = await fetch(`/api/doodles/${encodeURIComponent(selectedCode)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ strokes }),
    });

    if (!response.ok) {
      throw new Error("Unable to save doodle");
    }

    const payload = (await response.json()) as { doodle: DoodleDocument };
    setDoodleDoc(payload.doodle);
    await loadNeighborhoods();
  }

  async function clearDoodle() {
    if (!selectedCode) {
      return;
    }

    await fetch(`/api/doodles/${encodeURIComponent(selectedCode)}`, {
      method: "DELETE",
    });

    setDoodleDoc(null);
    await loadNeighborhoods();
  }

  return (
    <div className="grid min-h-screen grid-cols-1 bg-[radial-gradient(circle_at_top,#f8fafc_20%,#e2e8f0_90%)] lg:grid-cols-[2fr_1fr]">
      <section className="relative min-h-[420px] border-b border-zinc-300 lg:min-h-screen lg:border-r lg:border-b-0">
        <div ref={mapContainerRef} className="h-full w-full" />
        {loading ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/60 text-sm font-semibold text-zinc-700 backdrop-blur-sm">
            Loading NYC neighborhoods...
          </div>
        ) : null}
      </section>

      <aside className="flex flex-col gap-5 p-5 lg:p-7">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">NYC Map Doodler</h1>
          <p className="text-sm text-zinc-700">
            Draw the vibe of each neighborhood as you explore the city.
          </p>
        </header>

        <section className="rounded-lg border border-zinc-300 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">Progress</h2>
          <p className="mt-2 text-sm text-zinc-700">Total playable: {counts.total}</p>
          <p className="text-sm text-zinc-700">Doodled: {counts.doodled}</p>
          <p className="text-sm text-zinc-700">Remaining: {counts.remaining}</p>
          <p className="mt-2 text-base font-semibold text-zinc-900">
            Completion: {counts.completionPct}%
          </p>
        </section>

        <section className="rounded-lg border border-zinc-300 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">Selected Neighborhood</h2>
          {selectedFeature ? (
            <>
              <p className="mt-2 text-base font-semibold text-zinc-900">
                {selectedFeature.properties.name}
              </p>
              <p className="text-sm text-zinc-700">
                {selectedFeature.properties.ntaCode} · {selectedFeature.properties.borough}
              </p>
              {selectedFeature.properties.type === "special" ? (
                <p className="mt-2 text-xs text-amber-700">
                  This area is tagged as special/non-residential in NYC data.
                </p>
              ) : null}
              <div className="mt-3">
                <DoodleCanvas
                  initialStrokes={doodleDoc?.strokes ?? []}
                  onSave={saveDoodle}
                  onClear={clearDoodle}
                  disabled={selectedFeature.properties.type === "special"}
                />
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-zinc-600">
              Select a neighborhood on the map to start doodling.
            </p>
          )}
        </section>

        <footer className="mt-auto rounded-lg border border-zinc-300 bg-white p-3 text-xs text-zinc-600 shadow-sm">
          <p>Boundary source ID: {sourceViewId}</p>
          <p>
            Dataset fetched:{" "}
            {sourceFetchedAt
              ? new Date(sourceFetchedAt).toLocaleString()
              : "using bundled fallback"}
          </p>
          <p>Map data attribution: OpenStreetMap contributors.</p>
          <p>For production, use a dedicated OSM-derived tile provider or self-host tiles.</p>
          {error ? <p className="mt-2 font-semibold text-rose-700">{error}</p> : null}
        </footer>
      </aside>
    </div>
  );
}
