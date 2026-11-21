import { useId } from "react";

/** A hand-drawn brand underline beneath the hero's key words. Draws once after the headline settles. */
export function PencilLine() {
  const grain = useId();
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 400 40"
      className="pointer-events-none absolute top-[62%] -left-[1%] w-[102%] overflow-visible"
    >
      <defs>
        <filter id={grain} x="-5%" y="-50%" width="110%" height="200%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.5" result="rough" />
          <feColorMatrix
            in="noise"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  2.2 0 0 0 -0.25"
            result="paper"
          />
          <feComposite in="rough" in2="paper" operator="in" />
        </filter>
      </defs>
      <g filter={`url(#${grain})`} className="stroke-brand" fill="none" strokeLinecap="round">
        <path
          pathLength={1}
          className="pencil-stroke"
          strokeWidth="3.8"
          d="M4 31 C 70 29.5, 140 27, 205 23.5 S 330 16.5, 396 14"
        />
        <path
          pathLength={1}
          className="pencil-stroke pencil-stroke-again"
          strokeWidth="2"
          opacity="0.7"
          d="M58 33 C 130 30.5, 210 26.5, 280 22 S 350 18.5, 372 18"
        />
      </g>
    </svg>
  );
}
