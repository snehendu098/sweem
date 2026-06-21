// Pure-SVG recreation of the 3D orange "flower" mascot from the reference design.
// Petals are radial blobs around a soft center; two white rounded bars form the
// eyes. No image file, renders crisp at any size via the `size` prop.
export function Flower({ size = 130 }: { size?: number }) {
  const petals = Array.from({ length: 8 }, (_, i) => (i * 360) / 8);
  return (
    <svg
      className="dx-flower"
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      aria-hidden="true"
      style={{ filter: "drop-shadow(0 12px 22px rgba(245,98,45,0.32))" }}
    >
      <defs>
        <radialGradient id="dxPetal" cx="38%" cy="32%" r="75%">
          <stop offset="0%" stopColor="#ffd0b0" />
          <stop offset="55%" stopColor="#fb8a52" />
          <stop offset="100%" stopColor="#ef5e25" />
        </radialGradient>
        <radialGradient id="dxCenter" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#ffe1cb" />
          <stop offset="60%" stopColor="#fb904f" />
          <stop offset="100%" stopColor="#f0632b" />
        </radialGradient>
      </defs>
      <g transform="translate(100 100)">
        {petals.map((deg) => (
          <ellipse
            key={deg}
            rx="34"
            ry="46"
            cy="-44"
            fill="url(#dxPetal)"
            transform={`rotate(${deg})`}
          />
        ))}
        <circle r="50" fill="url(#dxCenter)" />
        {/* eyes, two rounded vertical bars */}
        <rect x="-20" y="-20" width="11" height="40" rx="5.5" fill="#fff" opacity="0.95" />
        <rect x="9" y="-20" width="11" height="40" rx="5.5" fill="#fff" opacity="0.95" />
      </g>
    </svg>
  );
}
