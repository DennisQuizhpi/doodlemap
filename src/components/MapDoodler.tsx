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
  addLayer: (layer: unknown, beforeId?: string) => void;
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

function toDoodleLineGeoJson(features: NeighborhoodFeature[]) {
  const lineFeatures = features.flatMap((feature) => {
    const strokes = feature.properties.doodleStrokes ?? [];
    if (feature.properties.type !== "residential" || strokes.length === 0) {
      return [];
    }

    const [[minLng, minLat], [maxLng, maxLat]] = geometryBounds(feature);
    const lngSpan = maxLng - minLng;
    const latSpan = maxLat - minLat;

    if (lngSpan <= 0 || latSpan <= 0) {
      return [];
    }

    const inset = 0.08;
    const innerMinLng = minLng + lngSpan * inset;
    const innerMaxLng = maxLng - lngSpan * inset;
    const innerMinLat = minLat + latSpan * inset;
    const innerMaxLat = maxLat - latSpan * inset;

    return strokes.flatMap((stroke) => {
      if (!stroke.points || stroke.points.length < 2) {
        return [];
      }

      const coordinates = stroke.points.map((point) => {
        const x = Math.max(0, Math.min(1, point.x));
        const y = Math.max(0, Math.min(1, point.y));
        const lng = innerMinLng + (innerMaxLng - innerMinLng) * x;
        const lat = innerMaxLat - (innerMaxLat - innerMinLat) * y;
        return [lng, lat];
      });

      return [
        {
          type: "Feature",
          properties: {
            ntaCode: feature.properties.ntaCode,
            strokeColor: stroke.color,
            strokeWidth: stroke.width,
          },
          geometry: {
            type: "LineString",
            coordinates,
          },
        },
      ];
    });
  });

  return {
    type: "FeatureCollection",
    features: lineFeatures,
  };
}

function buildNeighborhoodPreviewPath(feature: NeighborhoodFeature, width: number, height: number) {
  const polygons =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  const [[minLng, minLat], [maxLng, maxLat]] = geometryBounds(feature);

  const safeLngSpan = Math.max(maxLng - minLng, 0.000001);
  const safeLatSpan = Math.max(maxLat - minLat, 0.000001);
  const padding = 12;
  const scale = Math.min((width - padding * 2) / safeLngSpan, (height - padding * 2) / safeLatSpan);
  const drawWidth = safeLngSpan * scale;
  const drawHeight = safeLatSpan * scale;
  const offsetX = (width - drawWidth) / 2;
  const offsetY = (height - drawHeight) / 2;

  function projectPoint(point: [number, number]) {
    const x = (point[0] - minLng) * scale + offsetX;
    const y = height - ((point[1] - minLat) * scale + offsetY);
    return [x, y] as const;
  }

  return polygons
    .flatMap((polygon) =>
      polygon.map((ring) => {
        if (ring.length === 0) {
          return "";
        }

        const commands = ring.map((point, index) => {
          const [x, y] = projectPoint(point);
          return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
        });

        return `${commands.join(" ")} Z`;
      })
    )
    .join(" ");
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
  const [isCanvasOpen, setIsCanvasOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [counts, setCounts] = useState({ total: 0, doodled: 0, remaining: 0, completionPct: 0 });

  const selectedFeature = useMemo(
    () => features.find((feature) => feature.properties.ntaCode === selectedCode) ?? null,
    [features, selectedCode]
  );

  const previewPath = useMemo(() => {
    if (!selectedFeature) {
      return "";
    }
    return buildNeighborhoodPreviewPath(selectedFeature, 132, 88);
  }, [selectedFeature]);

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
      setIsCanvasOpen(false);
      return;
    }

    void loadDoodle(selectedCode);
  }, [selectedCode, loadDoodle]);

  useEffect(() => {
    if (!isCanvasOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsCanvasOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isCanvasOpen]);

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
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const source = map.getSource("doodle-lines-source");
    if (!source) {
      return;
    }

    source.setData(toDoodleLineGeoJson(features));
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

          map.addSource("doodle-lines-source", {
            type: "geojson",
            data: toDoodleLineGeoJson(featuresRef.current),
          });

          map.addLayer({
            id: "nta-doodle-background",
            type: "line",
            source: "doodle-lines-source",
            paint: {
              "line-color": ["coalesce", ["get", "strokeColor"], "#111827"],
              "line-width": [
                "*",
                ["coalesce", ["get", "strokeWidth"], 2],
                ["interpolate", ["linear"], ["zoom"], 9, 0.9, 15, 1.25],
              ],
              "line-opacity": 0.8,
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
            setIsCanvasOpen(false);

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
    setIsCanvasOpen(false);
  }

  async function deleteDoodle() {
    if (!selectedCode) {
      return;
    }

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/doodles/${encodeURIComponent(selectedCode)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Unable to delete doodle");
      }

      setDoodleDoc(null);
      await loadNeighborhoods();
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,#f8fafc_0%,#e2e8f0_42%,#cbd5e1_100%)]">
      <section className="relative h-screen w-full pb-44 sm:pb-40">
        <div ref={mapContainerRef} className="h-full w-full" />

        <div className="pointer-events-none absolute left-4 top-4 rounded-2xl border border-zinc-300/70 bg-white/90 px-4 py-3 shadow-sm backdrop-blur-sm sm:left-6 sm:top-6">
          <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">NYC Map Doodler</p>
          <p className="text-sm font-semibold text-zinc-900">
            {counts.doodled}/{counts.total} neighborhoods doodled ({counts.completionPct}%)
          </p>
        </div>

        {loading ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/60 text-sm font-semibold text-zinc-700 backdrop-blur-sm">
            Loading NYC neighborhoods...
          </div>
        ) : null}
      </section>

      <div className="fixed inset-x-2 bottom-2 z-20 rounded-3xl border border-zinc-300/70 bg-white/92 p-3 shadow-2xl backdrop-blur-md sm:inset-x-6 sm:bottom-6 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="h-[88px] w-[132px] shrink-0 overflow-hidden rounded-xl border border-zinc-300 bg-zinc-100">
              <svg viewBox="0 0 132 88" className="h-full w-full">
                <rect x="0" y="0" width="132" height="88" fill="#f4f4f5" />
                {previewPath ? (
                  <path d={previewPath} fill="#bfdbfe" stroke="#1d4ed8" strokeWidth="1.8" />
                ) : (
                  <text x="66" y="48" textAnchor="middle" className="fill-zinc-500 text-[10px]">
                    Select area
                  </text>
                )}
              </svg>
            </div>

            <div className="min-w-0">
              {selectedFeature ? (
                <>
                  <p className="truncate text-base font-semibold text-zinc-900">
                    {selectedFeature.properties.name}
                  </p>
                  <p className="text-xs text-zinc-600">
                    {selectedFeature.properties.ntaCode} · {selectedFeature.properties.borough}
                  </p>
                  {selectedFeature.properties.type === "special" ? (
                    <p className="mt-1 text-xs font-medium text-amber-700">
                      Special/non-residential area. Doodles are disabled.
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-zinc-600">Select a neighborhood on the map.</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {selectedFeature && selectedFeature.properties.type !== "special" ? (
              doodleDoc ? (
                <>
                  <button
                    type="button"
                    onClick={() => setIsCanvasOpen(true)}
                    className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
                  >
                    Edit doodle
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (window.confirm("Delete this doodle for the selected neighborhood?")) {
                        await deleteDoodle();
                      }
                    }}
                    disabled={isDeleting}
                    className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isDeleting ? "Deleting..." : "Delete"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsCanvasOpen(true)}
                  className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
                >
                  Add a doodle
                </button>
              )
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-5 gap-y-1 border-t border-zinc-200 pt-2 text-[11px] text-zinc-500">
          <p>Boundary source ID: {sourceViewId}</p>
          <p>
            Dataset fetched: {sourceFetchedAt ? new Date(sourceFetchedAt).toLocaleString() : "fallback"}
          </p>
          <p>Map data: OpenStreetMap contributors.</p>
          {error ? <p className="font-semibold text-rose-700">{error}</p> : null}
        </div>
      </div>

      {isCanvasOpen && selectedFeature && selectedFeature.properties.type !== "special" ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 p-3 backdrop-blur-sm sm:p-6">
          <div className="w-full max-w-5xl rounded-2xl border border-zinc-200 bg-white p-4 shadow-2xl sm:p-6">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900">{selectedFeature.properties.name}</h2>
                <p className="text-sm text-zinc-600">
                  {selectedFeature.properties.ntaCode} · {selectedFeature.properties.borough}
                </p>
                <p className="text-xs text-zinc-500">Use Clear to reset the draft, then Save to persist.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsCanvasOpen(false)}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Close
              </button>
            </div>
            <DoodleCanvas
              initialStrokes={doodleDoc?.strokes ?? []}
              onSave={saveDoodle}
              canvasClassName="h-[55vh] min-h-[360px]"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
