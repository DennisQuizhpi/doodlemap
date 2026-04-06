import fallbackDataset from "@/data/nyc-nta-2020.json";
import type { NeighborhoodDataset, NeighborhoodFeature, NeighborhoodGeometry } from "@/types/game";

type PropertyBag = Record<string, unknown>;

const DATASET_VIEW_ID = "9nt8-h7nd";
const DATASET_GEOJSON_URL = `https://data.cityofnewyork.us/resource/${DATASET_VIEW_ID}.geojson?$limit=5000`;

type CacheState = {
  data: NeighborhoodDataset | null;
  loadedAt: number;
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const cache: CacheState = {
  data: null,
  loadedAt: 0,
};

function pickProperty(properties: PropertyBag | undefined, keys: string[]): string | undefined {
  if (!properties) {
    return undefined;
  }

  const normalized = Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [key.toLowerCase(), value])
  );

  for (const key of keys) {
    const value = normalized[key.toLowerCase()];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function normalizeFeature(rawFeature: unknown): NeighborhoodFeature | null {
  const feature = rawFeature as {
    geometry?: NeighborhoodGeometry;
    properties?: PropertyBag;
  };

  if (!feature?.geometry || !feature.properties) {
    return null;
  }

  const ntaCode = pickProperty(feature.properties, [
    "nta2020",
    "ntacode",
    "ntacode20",
    "nta_code",
    "ntacode_20",
  ]);
  const name = pickProperty(feature.properties, ["ntaname", "ntaname20", "name", "nta_name"]);
  const borough = pickProperty(feature.properties, ["boroname", "boro_name", "borough", "boro"]);
  const ntaType = pickProperty(feature.properties, ["ntatype", "nta_type"]);

  if (!ntaCode || !name || !borough) {
    return null;
  }

  const ntaTypeNormalized = ntaType?.toLowerCase() ?? "";
  const isSpecial =
    ntaTypeNormalized.includes("non") ||
    ntaTypeNormalized.includes("park") ||
    ntaTypeNormalized.includes("airport") ||
    ntaTypeNormalized.includes("cemetery") ||
    ntaTypeNormalized.includes("special");

  return {
    type: "Feature",
    geometry: feature.geometry,
    properties: {
      ntaCode,
      name,
      borough,
      type: isSpecial ? "special" : "residential",
    },
  };
}

async function fetchLiveDataset(): Promise<NeighborhoodDataset> {
  const response = await fetch(DATASET_GEOJSON_URL, {
    next: { revalidate: ONE_DAY_MS / 1000 },
    headers: {
      Accept: "application/geo+json, application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch NTA dataset: ${response.status}`);
  }

  const geojson = (await response.json()) as {
    features?: unknown[];
  };

  const features = (geojson.features ?? [])
    .map(normalizeFeature)
    .filter((item): item is NeighborhoodFeature => item !== null);

  return {
    sourceViewId: DATASET_VIEW_ID,
    fetchedAt: new Date().toISOString(),
    features,
  };
}

function fallbackData(): NeighborhoodDataset {
  const data = fallbackDataset as NeighborhoodDataset;
  return {
    sourceViewId: data.sourceViewId,
    fetchedAt: data.fetchedAt,
    features: data.features,
  };
}

export async function loadNeighborhoods(options?: {
  forceRefresh?: boolean;
}): Promise<NeighborhoodDataset> {
  const now = Date.now();
  const forceRefresh = options?.forceRefresh ?? false;

  if (!forceRefresh && cache.data && now - cache.loadedAt < ONE_DAY_MS) {
    return cache.data;
  }

  try {
    const live = await fetchLiveDataset();
    cache.data = live;
    cache.loadedAt = now;
    return live;
  } catch (error) {
    if (cache.data) {
      return cache.data;
    }

    const fallback = fallbackData();
    cache.data = fallback;
    cache.loadedAt = now;

    if (fallback.features.length === 0) {
      console.warn("Using empty fallback NYC neighborhood dataset.", error);
    }

    return fallback;
  }
}

export async function loadNeighborhoodCodeSet(): Promise<Set<string>> {
  const data = await loadNeighborhoods();
  return new Set(data.features.map((feature) => feature.properties.ntaCode));
}
