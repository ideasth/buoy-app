export function Logo({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Anchor"
      className={className}
    >
      <circle cx="16" cy="8" r="3" stroke="currentColor" strokeWidth="2" />
      <path d="M16 11 L16 26" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M11 16 L21 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M6 20 C 7 25, 12 27, 16 27 C 20 27, 25 25, 26 20"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
