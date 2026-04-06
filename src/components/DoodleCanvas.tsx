"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { DoodleStroke } from "@/types/game";

const DEFAULT_COLOR = "#0f172a";
const DEFAULT_WIDTH = 3;

interface DoodleCanvasProps {
  initialStrokes: DoodleStroke[];
  onSave: (strokes: DoodleStroke[]) => Promise<void>;
  onClear?: () => Promise<void> | void;
  disabled?: boolean;
  canvasClassName?: string;
}

function drawStrokes(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  strokes: DoodleStroke[]
) {
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const stroke of strokes) {
    if (stroke.points.length < 2) {
      continue;
    }

    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.beginPath();

    stroke.points.forEach((point, index) => {
      const px = point.x * width;
      const py = point.y * height;
      if (index === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    });

    ctx.stroke();
  }
}

export function DoodleCanvas({
  initialStrokes,
  onSave,
  onClear,
  disabled = false,
  canvasClassName,
}: DoodleCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [strokes, setStrokes] = useState<DoodleStroke[]>(initialStrokes);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setStrokes(initialStrokes);
  }, [initialStrokes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    drawStrokes(ctx, canvas.width, canvas.height, strokes);
  }, [strokes]);

  function toNormalizedPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    return {
      x: Math.min(Math.max(x, 0), 1),
      y: Math.min(Math.max(y, 0), 1),
    };
  }

  function startStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled) {
      return;
    }

    const point = toNormalizedPoint(event);
    if (!point) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDrawing(true);
    setStrokes((current) => [
      ...current,
      { color: DEFAULT_COLOR, width: DEFAULT_WIDTH, points: [point] },
    ]);
  }

  function appendPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!isDrawing || disabled) {
      return;
    }

    const point = toNormalizedPoint(event);
    if (!point) {
      return;
    }

    setStrokes((current) => {
      if (current.length === 0) {
        return current;
      }

      const next = [...current];
      const last = next[next.length - 1];
      next[next.length - 1] = {
        ...last,
        points: [...last.points, point],
      };
      return next;
    });
  }

  function endStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!isDrawing) {
      return;
    }

    event.currentTarget.releasePointerCapture(event.pointerId);
    setIsDrawing(false);
  }

  async function save() {
    setIsSaving(true);
    try {
      await onSave(strokes);
    } finally {
      setIsSaving(false);
    }
  }

  async function clear() {
    setStrokes([]);
    await onClear?.();
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <canvas
        ref={canvasRef}
        className={`w-full rounded-lg border border-zinc-300 bg-zinc-50 ${canvasClassName ?? "h-64"}`}
        onPointerDown={startStroke}
        onPointerMove={appendPoint}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={disabled || isSaving}
          className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? "Saving..." : "Save doodle"}
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={disabled}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
