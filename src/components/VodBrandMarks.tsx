interface MarkProps {
  className?: string;
}

/**
 * Vod PDF Brand Mark: interlocking folded prism ribbons rendered in
 * Sovereign Garnet and Venetian Carmine (distinct from standard PDF red).
 */
export function VodLogo({ className = 'w-7 h-7' }: MarkProps) {
  return (
    <svg
      viewBox="0 0 36 36"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      {/* Left ascending structural plane — Sovereign Garnet */}
      <path
        d="M5.5 8.5L13.5 6L18.5 23.5L11.5 28.5L5.5 8.5Z"
        fill="#6E162B"
      />
      {/* Upper intersecting facet — Deep Ruby */}
      <path
        d="M13.5 6L21.5 11.5L18.5 23.5L13.5 6Z"
        fill="#851D35"
      />
      {/* Right kinetic ribbon — Venetian Carmine */}
      <path
        d="M23.5 7.5L31 10L23.5 29.5L16.5 26.5L23.5 7.5Z"
        fill="var(--app-accent, #A8203E)"
      />
      {/* Crystalline highlight fold */}
      <path
        d="M23.5 7.5L26.5 15.5L19.8 18.2L23.5 7.5Z"
        fill="var(--app-accent-light, #D98294)"
        fillOpacity="0.88"
      />
    </svg>
  );
}

/**
 * Vod PDF document badge: crisp editorial sheet with folded corner and a
 * Sovereign Garnet PDF ribbon (distinct from generic flat PDF red).
 */
export function PdfDocIcon({ className = 'w-10 h-10' }: MarkProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" className={className}>
      {/* Document sheet */}
      <path
        d="M13 4h14.5L34 10.5V34a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
        fill="#FFFFFF"
        stroke="var(--app-accent-border, #EBCBD2)"
        strokeWidth="1.25"
      />
      {/* Folded corner */}
      <path
        d="M27.5 4 34 10.5h-4.5a2 2 0 0 1-2-2V4Z"
        fill="var(--app-accent-soft, #FBF1F3)"
        stroke="var(--app-accent-border, #EBCBD2)"
        strokeWidth="1.1"
      />
      {/* Editorial text lines */}
      <rect x="17" y="15" width="12.5" height="2.2" rx="1.1" fill="var(--app-accent-light, #D98294)" />
      <rect x="17" y="20" width="12.5" height="2.2" rx="1.1" fill="var(--app-accent, #A8203E)" opacity="0.72" />
      <rect x="17" y="25" width="8.5" height="2.2" rx="1.1" fill="var(--app-accent-deep, #6E162B)" opacity="0.55" />
      {/* Sovereign Garnet PDF ribbon */}
      <rect x="3.5" y="12.5" width="19.5" height="15" rx="3.5" fill="var(--app-accent-deep, #6E162B)" />
      <rect x="3.5" y="12.5" width="19.5" height="15" rx="3.5" stroke="var(--app-accent, #A8203E)" strokeWidth="0.75" />
      <text
        x="13.25"
        y="22.4"
        textAnchor="middle"
        fill="#FFFFFF"
        fontSize="7.4"
        fontWeight="700"
        fontFamily="Plus Jakarta Sans, DM Sans, sans-serif"
        letterSpacing="0.06em"
      >
        PDF
      </text>
    </svg>
  );
}
