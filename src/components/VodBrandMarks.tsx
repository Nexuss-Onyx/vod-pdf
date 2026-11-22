interface MarkProps {
  className?: string;
}

/**
 * Abstract Vod Brand Logo: interlocking folded prism ribbons representing
 * Vod's unified suite architecture (plum master planes + swappable app ribbon).
 */
export function VodLogo({ className = 'w-7 h-7' }: MarkProps) {
  return (
    <svg
      viewBox="0 0 36 36"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      {/* Left ascending structural plane — Vod Sovereign Plum */}
      <path
        d="M5.5 8.5L13.5 6L18.5 23.5L11.5 28.5L5.5 8.5Z"
        fill="#2E2252"
      />
      {/* Upper intersecting facet — Deep Amethyst */}
      <path
        d="M13.5 6L21.5 11.5L18.5 23.5L13.5 6Z"
        fill="#4A3680"
      />
      {/* Right kinetic ribbon — Swappable suite accent (Vod PDF plum by default) */}
      <path
        d="M23.5 7.5L31 10L23.5 29.5L16.5 26.5L23.5 7.5Z"
        fill="var(--app-accent, #4A3680)"
      />
      {/* Crystalline highlight fold */}
      <path
        d="M23.5 7.5L26.5 15.5L19.8 18.2L23.5 7.5Z"
        fill="var(--app-accent-light, #B9A9DC)"
        fillOpacity="0.85"
      />
    </svg>
  );
}

/**
 * PDF document badge: layered page with folded corner and a plum PDF ribbon.
 * Uses the app accent tokens so the mark follows the Vod PDF palette.
 */
export function PdfDocIcon({ className = 'w-10 h-10' }: MarkProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" className={className}>
      {/* Back page */}
      <path
        d="M14 4h13.5L34 10.5V34a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
        fill="#FFFFFF"
        stroke="var(--app-accent-border, #D6C9EE)"
        strokeWidth="1.25"
      />
      {/* Folded corner */}
      <path
        d="M27.5 4 34 10.5h-4.5a2 2 0 0 1-2-2V4Z"
        fill="var(--app-accent-soft, #F2EEF9)"
        stroke="var(--app-accent-border, #D6C9EE)"
        strokeWidth="1.1"
      />
      {/* Text rules */}
      <rect x="17" y="15" width="12.5" height="2.2" rx="1.1" fill="var(--app-accent-light, #B9A9DC)" />
      <rect x="17" y="20" width="12.5" height="2.2" rx="1.1" fill="var(--app-accent, #4A3680)" opacity="0.75" />
      <rect x="17" y="25" width="8.5" height="2.2" rx="1.1" fill="var(--app-accent-deep, #2E2252)" opacity="0.6" />
      {/* PDF ribbon */}
      <rect x="4" y="12" width="18" height="16" rx="3.5" fill="var(--app-accent-deep, #2E2252)" />
      <path
        d="M7.6 16.4h2.1l1.4 5 1.6-5h1.3l1.6 5 1.4-5h2l-2.4 8h-1.7l-1.6-4.8-1.6 4.8H10L7.6 16.4Z"
        fill="#FFFFFF"
        opacity="0.25"
      />
      <path
        d="M8 16.6h3.4c1.5 0 2.4.8 2.4 2.2 0 1.5-1 2.3-2.5 2.3H9.6v2.3H8V16.6Zm1.6 1.3v2h1.6c.7 0 1.1-.4 1.1-1s-.4-1-1.1-1H9.6Z"
        fill="#FFFFFF"
      />
      <path
        d="M14.2 16.6h2.7c2.4 0 3.9 1.5 3.9 3.4s-1.5 3.4-3.9 3.4h-2.7v-6.8Zm1.6 1.3v4.2h1.1c1.4 0 2.3-.8 2.3-2.1s-.9-2.1-2.3-2.1h-1.1Z"
        fill="#FFFFFF"
        opacity="0.92"
      />
    </svg>
  );
}
