import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { DoodleDocument, DoodleStroke } from "@/types/game";

type DoodleDbShape = {
  records: Record<string, DoodleDocument>;
};

const STORE_DIR = path.join(os.tmpdir(), "doodlemap");
const STORE_PATH = path.join(STORE_DIR, "doodles.json");

let writeLock: Promise<void> = Promise.resolve();

function normalizeStrokes(input: unknown): DoodleStroke[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((stroke) => {
      const item = stroke as {
        color?: unknown;
        width?: unknown;
        points?: unknown;
      };

      const points = Array.isArray(item.points)
        ? item.points
            .map((point) => {
              const rawPoint = point as { x?: unknown; y?: unknown };
              const x = typeof rawPoint.x === "number" ? rawPoint.x : NaN;
              const y = typeof rawPoint.y === "number" ? rawPoint.y : NaN;
              return { x, y };
            })
            .filter(
              (point) =>
                Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.y >= 0
            )
        : [];

      return {
        color: typeof item.color === "string" ? item.color : "#0f172a",
        width:
          typeof item.width === "number" && Number.isFinite(item.width)
            ? Math.min(Math.max(item.width, 1), 16)
            : 3,
        points,
      };
    })
    .filter((stroke) => stroke.points.length >= 2);
}

async function readDb(): Promise<DoodleDbShape> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<DoodleDbShape>;
    return {
      records: parsed.records ?? {},
    };
  } catch {
    return { records: {} };
  }
}

async function writeDb(db: DoodleDbShape): Promise<void> {
  await mkdir(STORE_DIR, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(db, null, 2), "utf8");
}

function enqueueWrite(operation: (db: DoodleDbShape) => void | Promise<void>): Promise<void> {
  writeLock = writeLock.then(async () => {
    const db = await readDb();
    await operation(db);
    await writeDb(db);
  });

  return writeLock;
}

export async function getDoodle(ntaCode: string): Promise<DoodleDocument | null> {
  const db = await readDb();
  return db.records[ntaCode] ?? null;
}

export async function getAllDoodles(): Promise<Record<string, DoodleDocument>> {
  const db = await readDb();
  return db.records;
}

export async function upsertDoodle(
  ntaCode: string,
  strokesInput: unknown
): Promise<DoodleDocument> {
  const strokes = normalizeStrokes(strokesInput);
  const now = new Date().toISOString();

  const current = await getDoodle(ntaCode);
  const next: DoodleDocument = {
    ntaCode,
    strokes,
    version: (current?.version ?? 0) + 1,
    updatedAt: now,
  };

  await enqueueWrite((db) => {
    db.records[ntaCode] = next;
  });

  return next;
}

export async function deleteDoodle(ntaCode: string): Promise<boolean> {
  let existed = false;

  await enqueueWrite((db) => {
    existed = Boolean(db.records[ntaCode]);
    delete db.records[ntaCode];
  });

  return existed;
}
