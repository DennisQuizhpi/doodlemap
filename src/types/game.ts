export type Position = [number, number];
export type PolygonCoordinates = Position[][];
export type MultiPolygonCoordinates = PolygonCoordinates[];

export interface PolygonGeometry {
  type: "Polygon";
  coordinates: PolygonCoordinates;
}

export interface MultiPolygonGeometry {
  type: "MultiPolygon";
  coordinates: MultiPolygonCoordinates;
}

export type NeighborhoodGeometry = MultiPolygonGeometry | PolygonGeometry;

export type NeighborhoodType = "residential" | "special";

export interface NeighborhoodFeatureProperties {
  ntaCode: string;
  name: string;
  borough: string;
  type: NeighborhoodType;
  hasDoodle?: boolean;
  doodleStrokes?: DoodleStroke[];
}

export interface NeighborhoodFeature {
  type: "Feature";
  geometry: NeighborhoodGeometry;
  properties: NeighborhoodFeatureProperties;
}

export interface NeighborhoodDataset {
  sourceViewId: string;
  fetchedAt: string | null;
  features: NeighborhoodFeature[];
}

export interface DoodlePoint {
  x: number;
  y: number;
}

export interface DoodleStroke {
  color: string;
  width: number;
  points: DoodlePoint[];
}

export interface DoodleDocument {
  ntaCode: string;
  strokes: DoodleStroke[];
  version: number;
  updatedAt: string;
}

export interface NeighborhoodsResponse {
  source: {
    viewId: string;
    fetchedAt: string | null;
  };
  counts: {
    total: number;
    doodled: number;
    remaining: number;
    completionPct: number;
  };
  features: NeighborhoodFeature[];
}
