import { NextRequest, NextResponse } from "next/server";
import { getAllDoodles } from "@/lib/doodle-store";
import { loadNeighborhoods } from "@/lib/nyc-neighborhoods";
import type { NeighborhoodsResponse } from "@/types/game";

export async function GET(request: NextRequest) {
  const shouldRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  const dataset = await loadNeighborhoods({ forceRefresh: shouldRefresh });
  const doodles = await getAllDoodles();

  const features = dataset.features.map((feature) => {
    const ntaCode = feature.properties.ntaCode;
    const doodle = doodles[ntaCode];
    const hasDoodle = Boolean(doodle && doodle.strokes.length > 0);
    return {
      ...feature,
      properties: {
        ...feature.properties,
        hasDoodle,
        doodleStrokes: hasDoodle ? doodle?.strokes ?? [] : undefined,
      },
    };
  });

  const playable = features.filter((feature) => feature.properties.type === "residential");
  const doodled = playable.filter((feature) => feature.properties.hasDoodle).length;

  const response: NeighborhoodsResponse = {
    source: {
      viewId: dataset.sourceViewId,
      fetchedAt: dataset.fetchedAt,
    },
    counts: {
      total: playable.length,
      doodled,
      remaining: Math.max(playable.length - doodled, 0),
      completionPct:
        playable.length > 0 ? Number(((doodled / playable.length) * 100).toFixed(1)) : 0,
    },
    features,
  };

  return NextResponse.json(response, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
