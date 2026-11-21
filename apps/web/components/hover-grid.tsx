"use client";

import { useEffect, useRef } from "react";

const SQRT3 = Math.sqrt(3);

function hexCenter(size: number, i: number, j: number): [number, number] {
  const r = size / SQRT3;
  const stepX = r * 1.5;
  const stepY = size;
  return [i * stepX, j * stepY + (Math.abs(i) % 2 === 1 ? stepY / 2 : 0)];
}

function traceHex(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k;
    const px = x + r * Math.cos(a);
    const py = y + r * Math.sin(a);
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/**
 * Interactive geometric grid behind the closing CTA.
 * Cells light up in Courier's brand teal under the cursor with a smooth fading trail and click ripples.
 */
export function HoverGrid({ cellSize = 34 }: { cellSize?: number }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const radius = cellSize / SQRT3;
    const stepX = radius * 1.5;
    const stepY = cellSize;

    let width = 1;
    let height = 1;
    let dpr = 1;
    let raf = 0;
    let last = 0;
    let time = 0;
    let visible = true;
    let inside = false;
    let px = 0;
    let py = 0;
    let sx = 0;
    let sy = 0;
    let vx = 0;
    let vy = 0;
    let power = 0;
    let trailX = Number.NaN;
    let trailY = Number.NaN;

    const lit = new Map<string, number>();
    const cascades: { x: number; y: number; at: number }[] = [];

    const palette = () => {
      const light = document.documentElement.getAttribute("data-theme") === "light";
      return light
        ? { line: "rgba(15, 20, 25, 0.08)", stroke: "#0d9488", fill: "#14b8a6", fillAlpha: 0.28 }
        : { line: "rgba(243, 246, 250, 0.075)", stroke: "#2dd4bf", fill: "#2dd4bf", fillAlpha: 0.22 };
    };

    const resize = () => {
      width = Math.max(1, box.clientWidth);
      height = Math.max(1, box.clientHeight);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };

    const nearest = (x: number, y: number): [number, number] => {
      const ci = Math.round(x / stepX);
      const cj = Math.round(y / stepY);
      let best = Infinity;
      let out: [number, number] = [ci, cj];
      for (let i = ci - 2; i <= ci + 2; i++) {
        for (let j = cj - 2; j <= cj + 2; j++) {
          const [cx, cy] = hexCenter(cellSize, i, j);
          const d = (cx - x) ** 2 + (cy - y) ** 2;
          if (d < best) {
            best = d;
            out = [i, j];
          }
        }
      }
      return out;
    };

    const stamp = (x: number, y: number, strength: number) => {
      const [hi, hj] = nearest(x, y);
      const reach = cellSize * 1.45;
      for (let i = hi - 2; i <= hi + 2; i++) {
        for (let j = hj - 2; j <= hj + 2; j++) {
          const [cx, cy] = hexCenter(cellSize, i, j);
          const dist = Math.hypot(cx - x, cy - y);
          let val = Math.max(0, 1 - dist / reach);
          val = val * val * (3 - 2 * val);
          if (i === hi && j === hj) val = Math.max(val, 1);
          val *= strength;
          if (val <= 0.01) continue;
          const key = `${i},${j}`;
          if (val > (lit.get(key) ?? 0)) lit.set(key, val);
        }
      }
    };

    const draw = () => {
      const colors = palette();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const i0 = -1;
      const i1 = Math.ceil(width / stepX) + 1;
      const j0 = -1;
      const j1 = Math.ceil(height / stepY) + 1;

      ctx.lineWidth = 1;
      ctx.strokeStyle = colors.line;
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const [cx, cy] = hexCenter(cellSize, i, j);
          traceHex(ctx, cx, cy, radius);
        }
      }
      ctx.stroke();

      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const [cx, cy] = hexCenter(cellSize, i, j);
          let val = lit.get(`${i},${j}`) ?? 0;
          for (const c of cascades) {
            const ring = Math.round(Math.hypot(cx - c.x, cy - c.y) / cellSize);
            const local = time - c.at - ring * 0.055;
            if (local < 0) continue;
            const pulse = Math.exp(-((local / 0.09) ** 2)) * Math.max(0, 1 - ring / 9);
            if (pulse > val) val = pulse;
          }
          if (val <= 0.01) continue;
          ctx.beginPath();
          traceHex(ctx, cx, cy, radius - 0.5);
          ctx.globalAlpha = Math.min(1, val) * colors.fillAlpha;
          ctx.fillStyle = colors.fill;
          ctx.fill();
          ctx.globalAlpha = Math.min(1, val) * 0.85;
          ctx.strokeStyle = colors.stroke;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    };

    const tick = (now: number) => {
      raf = 0;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      time += dt;

      const decay = Math.exp(-dt / 0.85);
      for (const [k, v] of lit) {
        const next = v * decay;
        if (next < 0.006) lit.delete(k);
        else lit.set(k, next);
      }

      const want = inside ? 1 : 0;
      power += (want - power) * (1 - Math.exp(-(want ? 10 : 5) * dt));
      const stiffness = 220;
      const damping = 2 * Math.sqrt(stiffness) * 0.85;
      vx += (stiffness * (px - sx) - damping * vx) * dt;
      vy += (stiffness * (py - sy) - damping * vy) * dt;
      sx += vx * dt;
      sy += vy * dt;

      if (power > 0.01) {
        const fx = Number.isNaN(trailX) ? sx : trailX;
        const fy = Number.isNaN(trailY) ? sy : trailY;
        const steps = Math.min(80, Math.max(1, Math.ceil(Math.hypot(sx - fx, sy - fy) / (cellSize * 0.4))));
        for (let k = 1; k <= steps; k++) {
          const t = k / steps;
          stamp(fx + (sx - fx) * t, fy + (sy - fy) * t, power);
        }
        trailX = sx;
        trailY = sy;
      } else {
        trailX = Number.NaN;
        trailY = Number.NaN;
      }

      for (let idx = cascades.length - 1; idx >= 0; idx--) {
        if (time - cascades[idx]!.at > 1.1) cascades.splice(idx, 1);
      }

      draw();
      const active = lit.size > 0 || cascades.length > 0 || power > 0.01 || inside;
      if (visible && !reduce && active) raf = requestAnimationFrame(tick);
      else last = 0;
    };

    const wake = () => {
      if (!raf && visible && !reduce) raf = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      const rect = box.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (!inside && power < 0.02) {
        sx = x;
        sy = y;
        vx = 0;
        vy = 0;
        trailX = Number.NaN;
        trailY = Number.NaN;
      }
      inside = true;
      px = x;
      py = y;
      wake();
    };

    const onLeave = () => {
      inside = false;
      wake();
    };

    const onDown = (e: PointerEvent) => {
      if (reduce) return;
      const rect = box.getBoundingClientRect();
      cascades.push({ x: e.clientX - rect.left, y: e.clientY - rect.top, at: time });
      wake();
    };

    resize();
    draw();

    const ro = new ResizeObserver(() => {
      resize();
      draw();
    });
    ro.observe(box);

    const io = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      if (visible) draw();
    });
    io.observe(box);

    const mo = new MutationObserver(() => draw());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    box.addEventListener("pointermove", onMove);
    box.addEventListener("pointerleave", onLeave);
    box.addEventListener("pointerdown", onDown);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      box.removeEventListener("pointermove", onMove);
      box.removeEventListener("pointerleave", onLeave);
      box.removeEventListener("pointerdown", onDown);
    };
  }, [cellSize]);

  return (
    <div ref={boxRef} className="absolute inset-0 overflow-hidden" aria-hidden="true">
      <canvas ref={canvasRef} className="block size-full" />
    </div>
  );
}
