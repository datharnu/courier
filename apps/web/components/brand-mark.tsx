export function CourierMark({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" stroke="currentColor" strokeWidth="1.75" />
      <path d="M6.5 8.25H17.5L12 13.25L6.5 8.25Z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
      <path d="M12 11.5L14.25 13.75L12 16L9.75 13.75L12 11.5Z" fill="var(--color-brand)" />
    </svg>
  );
}
