import { NextRequest, NextResponse } from "next/server";
import { deleteDoodle, getDoodle, upsertDoodle } from "@/lib/doodle-store";
import { loadNeighborhoodCodeSet } from "@/lib/nyc-neighborhoods";

async function ensureNeighborhoodExists(ntaCode: string): Promise<boolean> {
  const codeSet = await loadNeighborhoodCodeSet();
  return codeSet.has(ntaCode);
}

export async function GET(_: NextRequest, context: { params: Promise<{ ntaCode: string }> }) {
  const { ntaCode } = await context.params;

  if (!(await ensureNeighborhoodExists(ntaCode))) {
    return NextResponse.json({ error: "Neighborhood not found" }, { status: 404 });
  }

  const doodle = await getDoodle(ntaCode);
  return NextResponse.json({ doodle });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ ntaCode: string }> }) {
  const { ntaCode } = await context.params;

  if (!(await ensureNeighborhoodExists(ntaCode))) {
    return NextResponse.json({ error: "Neighborhood not found" }, { status: 404 });
  }

  const body = (await request.json()) as { strokes?: unknown };
  const doodle = await upsertDoodle(ntaCode, body.strokes);

  return NextResponse.json({ doodle });
}

export async function DELETE(_: NextRequest, context: { params: Promise<{ ntaCode: string }> }) {
  const { ntaCode } = await context.params;

  if (!(await ensureNeighborhoodExists(ntaCode))) {
    return NextResponse.json({ error: "Neighborhood not found" }, { status: 404 });
  }

  const deleted = await deleteDoodle(ntaCode);
  return NextResponse.json({ deleted });
}
