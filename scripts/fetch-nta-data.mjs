#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const VIEW_ID = "9nt8-h7nd";
const GEOJSON_URL = `https://data.cityofnewyork.us/resource/${VIEW_ID}.geojson?$limit=5000`;
const OUTPUT_PATH = path.join(process.cwd(), "src/data/nyc-nta-2020.json");

function pickProperty(properties, keys) {
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

function normalizeFeature(rawFeature) {
  if (!rawFeature || !rawFeature.geometry || !rawFeature.properties) {
    return null;
  }

  const ntaCode = pickProperty(rawFeature.properties, [
    "nta2020",
    "ntacode",
    "ntacode20",
    "nta_code",
    "ntacode_20",
  ]);
  const name = pickProperty(rawFeature.properties, ["ntaname", "ntaname20", "name", "nta_name"]);
  const borough = pickProperty(rawFeature.properties, ["boroname", "boro_name", "borough", "boro"]);
  const ntaType = pickProperty(rawFeature.properties, ["ntatype", "nta_type"]);

  if (!ntaCode || !name || !borough) {
    return null;
  }

  const ntaTypeNormalized = ntaType ? ntaType.toLowerCase() : "";
  const isSpecial =
    ntaTypeNormalized.includes("non") ||
    ntaTypeNormalized.includes("park") ||
    ntaTypeNormalized.includes("airport") ||
    ntaTypeNormalized.includes("cemetery") ||
    ntaTypeNormalized.includes("special");

  return {
    type: "Feature",
    geometry: rawFeature.geometry,
    properties: {
      ntaCode,
      name,
      borough,
      type: isSpecial ? "special" : "residential",
    },
  };
}

async function main() {
  const response = await fetch(GEOJSON_URL, {
    headers: {
      Accept: "application/geo+json, application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch NYC NTA data: ${response.status}`);
  }

  const geojson = await response.json();
  const features = (geojson.features || []).map(normalizeFeature).filter(Boolean);

  const payload = {
    sourceViewId: VIEW_ID,
    fetchedAt: new Date().toISOString(),
    features,
  };

  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Saved ${features.length} normalized NTA features to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
