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
      {/* Right kinetic ribbon — Swappable Suite Accent (Word Cobalt by default) */}
      <path
        d="M23.5 7.5L31 10L23.5 29.5L16.5 26.5L23.5 7.5Z"
        fill="var(--app-accent, #185ABD)"
      />
      {/* Crystalline highlight fold */}
      <path
        d="M23.5 7.5L26.5 15.5L19.8 18.2L23.5 7.5Z"
        fill="var(--app-accent-light, #41A5EE)"
        fillOpacity="0.85"
      />
    </svg>
  );
}

/**
 * Distinct Microsoft Word-inspired layered document badge
 */
export function WordDocIcon({ className = 'w-10 h-10' }: MarkProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect x="10" y="4" width="24" height="32" rx="4" fill="#FFFFFF" stroke="#C7D8F4" strokeWidth="1.25" />
      <rect x="14" y="9" width="16" height="4" rx="1" fill="#41A5EE" />
      <rect x="14" y="15.5" width="16" height="4" rx="1" fill="#2B7CD3" />
      <rect x="14" y="22" width="16" height="4" rx="1" fill="#185ABD" />
      <rect x="14" y="28.5" width="11" height="3.5" rx="1" fill="#103F91" />
      <rect x="4" y="11" width="18" height="18" rx="3.5" fill="#103F91" />
      <path
        d="M7.6 15.8H9.5L10.9 21.8L12.5 16.4H13.9L15.4 21.8L16.9 15.8H18.7L16.3 24.4H14.6L13.1 19.2L11.6 24.4H9.9L7.6 15.8Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}
