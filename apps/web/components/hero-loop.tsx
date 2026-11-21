"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Lock } from "lucide-react";

const CARDS = [
  { side: -1, name: "PrekeyDir", value: "ML-DSA", tone: "brand" },
  { side: -1, name: "Handshake", value: "ML-KEM", tone: "brand" },
  { side: -1, name: "Relay", value: "Cipher", tone: "muted" },
  { side: 1, name: "Vendor", value: "Opened", tone: "brand" },
  { side: 1, name: "Receipt #1", value: "On chain", tone: "brand" },
  { side: 1, name: "Carol · E2", value: "Refused", tone: "refused" },
] as const;

const LATTICE = 4.2;
const SAMPLES = 1600;
const BASE_HALF = 2.2;
const MAX_HALF = 13;
const LAP_SECONDS = 12;
const TRIP_SECONDS = 12;
const PER_SIDE = 3;

interface Dot {
  x: number;
  y: number;
  s: number;
  o: number;
  a: number;
}
interface Orbit {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}
interface Geometry {
  dots: Dot[];
  orbits: [Orbit, Orbit];
  fade: (x: number, y: number) => number;
  centre: [number, number];
  labelDx: number;
}

const smooth = (k: number) => {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
};
const frac = (x: number) => ((x % 1) + 1) % 1;

function build(w: number, h: number, clear: DOMRect | null, origin: DOMRect): Geometry {
  const top = clear ? clear.bottom - origin.top : h * 0.45;
  const available = Math.max(160, h - top - 32);
  const A = Math.min(w * 0.34, 480, available * 0.85);
  const H = Math.min(A * 0.48, available * 0.36);
  const cx = w / 2;
  const cy = top + available / 2;
  const at = (t: number): [number, number] => [cx + A * Math.cos(t), cy + 2 * H * Math.sin(t) * Math.cos(t)];

  const ex = clear ? clear.left - origin.left + clear.width / 2 : cx;
  const ey = clear ? clear.top - origin.top + clear.height / 2 : h * 0.3;
  const rx = clear ? clear.width * 0.58 : w * 0.3;
  const ry = clear ? clear.height * 0.6 : h * 0.25;
  const fade = (x: number, y: number) =>
    smooth((Math.hypot((x - ex) / rx, (y - ey) / ry) - 0.85) / 0.4) *
    smooth((h - y) / 60) *
    smooth(Math.min(x, w - x) / 60);

  const orbits: [Orbit, Orbit] = [
    { cx: cx - A * 0.58, cy, rx: A * 0.66, ry: H * 1.22 },
    { cx: cx + A * 0.58, cy, rx: A * 0.66, ry: H * 1.22 },
  ];

  const rowH = LATTICE * 0.866;
  const seen = new Set<string>();
  const dots: Dot[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = (i / SAMPLES) * Math.PI * 2;
    const [x, y] = at(t);
    const [x2, y2] = at(t + 0.002);
    const len = Math.hypot(x2 - x, y2 - y) || 1;
    for (let o = -MAX_HALF; o <= MAX_HALF; o += LATTICE * 0.48) {
      const px = x - ((y2 - y) / len) * o;
      const py = y + ((x2 - x) / len) * o;
      const row = Math.round(py / rowH);
      const shift = row % 2 ? LATTICE / 2 : 0;
      const col = Math.round((px - shift) / LATTICE);
      const key = `${row},${col}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sx = col * LATTICE + shift;
      const sy = row * rowH;
      const a = fade(sx, sy);
      if (a > 0.02) dots.push({ x: sx, y: sy, s: i / SAMPLES, o: Math.abs(o), a });
    }
  }

  return { dots, orbits, fade, centre: [cx, cy], labelDx: A * 0.55 };
}

const ribbon = (s: number, flow: number) => {
  let w = 0;
  for (const [offset, len] of [
    [0, 0.15],
    [1 / 3, 0.12],
    [2 / 3, 0.14],
  ]) {
    const f = frac(s + flow - offset);
    if (f < len) w = Math.max(w, Math.sin((f / len) * Math.PI) ** 2);
  }
  return w;
};

export function HeroLoop({ clearRef }: { clearRef: RefObject<HTMLElement | null> }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [anchor, setAnchor] = useState<{ centre: [number, number]; labelDx: number } | null>(null);

  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let g: Geometry | null = null;
    let frame = 0;
    let visible = true;
    const start = performance.now();

    const dotColor = () => {
      const theme = document.documentElement.getAttribute("data-theme");
      return theme === "light" ? "#64748b" : "#94a3b8";
    };

    const layout = () => {
      const rect = box.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      g = build(rect.width, rect.height, clearRef.current?.getBoundingClientRect() ?? null, rect);
      setAnchor({ centre: g.centre, labelDx: g.labelDx });
    };

    const draw = (time: number) => {
      if (!g) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = dotColor();
      const flow = time / LAP_SECONDS;
      for (const d of g.dots) {
        const swell = ribbon(d.s, flow);
        const half = BASE_HALF + (MAX_HALF - BASE_HALF) * swell;
        if (d.o > half) continue;
        const edge = d.o / half;
        const r = 0.65 + 0.35 * swell * (1 - edge);
        ctx.globalAlpha = d.a * (0.65 - 0.35 * edge * swell);
        ctx.fillRect(d.x - r, d.y - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;

      cardRefs.current.forEach((el, i) => {
        if (!el || !g) return;
        const { side } = CARDS[i]!;
        const o = g.orbits[side < 0 ? 0 : 1];
        const p = frac(time / TRIP_SECONDS + (i % PER_SIDE) / PER_SIDE + (side > 0 ? 0.5 / PER_SIDE : 0));
        const angle = Math.PI / 2 - side * Math.PI * p;
        const x = o.cx + o.rx * Math.cos(angle);
        const y = o.cy + o.ry * Math.sin(angle);
        const size = Math.sin(Math.PI * p) ** 1.6;
        el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${0.25 + 0.75 * size})`;
        el.style.opacity = String(Math.sin(Math.PI * p) ** 3 * Math.max(0.2, g.fade(x, y)));
        const done = String(p > 0.42);
        if (el.dataset.done !== done) el.dataset.done = done;
      });
    };

    const tick = (now: number) => {
      draw((now - start) / 1000);
      frame = visible ? requestAnimationFrame(tick) : 0;
    };

    layout();
    if (still) draw(TRIP_SECONDS * 0.5);
    else frame = requestAnimationFrame(tick);

    const resized = new ResizeObserver(() => {
      layout();
      if (still) draw(TRIP_SECONDS * 0.5);
    });
    resized.observe(box);

    const onScreen = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      if (visible && !still && !frame) frame = requestAnimationFrame(tick);
    });
    onScreen.observe(box);

    return () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
      onScreen.disconnect();
    };
  }, [clearRef]);

  const place = ([x, y]: [number, number]) => ({ transform: `translate(${x}px, ${y}px) translate(-50%, -50%)` });

  return (
    <div ref={boxRef} aria-hidden="true" className="pointer-events-none absolute inset-0">
      <canvas ref={canvasRef} className="absolute inset-0 size-full" />

      {anchor ? (
        <>
          <div style={{ ...place(anchor.centre), zIndex: 20 }} className="absolute top-0 left-0">
            <div className="relative grid size-[clamp(4.25rem,7.5vw,6.25rem)] place-items-center rounded-2xl border border-brand/40 bg-surface shadow-float">
              <Lock className="size-[36%] text-brand" strokeWidth={2.2} />
            </div>
          </div>

          <div className="hidden md:block">
            {(["Ciphertext in", "Device verdicts"] as const).map((label, i) => (
              <span
                key={label}
                style={place([anchor.centre[0] + (i ? 1 : -1) * anchor.labelDx, anchor.centre[1]])}
                className="label-mono absolute top-0 left-0 text-[11px] text-muted"
              >
                {label}
              </span>
            ))}
          </div>
        </>
      ) : null}

      <div className="hidden md:block">
        {CARDS.map((c, i) => (
          <div
            key={`${c.side}-${c.name}`}
            ref={(el) => {
              cardRefs.current[i] = el;
            }}
            data-done="false"
            className="group absolute top-0 left-0 opacity-0"
          >
            <div className="flex w-44 items-center gap-2 rounded-xl border border-line-strong bg-surface/95 px-3 py-2 shadow-float backdrop-blur-sm">
              <span className="h-2 w-2 shrink-0 rounded-full bg-brand" />
              <span className="truncate text-[12.5px] font-medium text-ink">{c.name}</span>
              <span className="ml-auto font-mono text-[11px] text-muted group-data-[done=true]:hidden">···</span>
              <span
                className={`ml-auto hidden rounded-md px-1.5 py-0.5 font-mono text-[10.5px] group-data-[done=true]:inline ${
                  c.tone === "brand"
                    ? "bg-brand text-on-brand"
                    : c.tone === "refused"
                      ? "bg-refused-soft text-refused"
                      : "bg-surface-elevated text-muted"
                }`}
              >
                {c.value}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
