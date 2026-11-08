import type { CatalogDevice } from "./devices";

export function PhoneArt({ device, large = false }: { device: CatalogDevice; large?: boolean }) {
  const isFold = device.name.includes("Fold");
  const isFlip = device.name.includes("Flip");
  const isUltra = device.name.includes("Ultra") || device.name.includes("Pro");
  const screenId = `screen-${device.id}`;
  const edgeId = `edge-${device.id}`;
  return (
    <svg
      className={`phone-art${large ? " phone-art-large" : ""}`}
      viewBox={isFold ? "0 0 124 200" : "0 0 100 200"}
      role="img"
      aria-label={`${device.name} phone illustration`}
    >
      <defs>
        <linearGradient id={screenId} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor={device.tone} />
          <stop offset="1" stopColor={device.accent} />
        </linearGradient>
        <linearGradient id={edgeId} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity=".4" />
          <stop offset=".48" stopColor="#ffffff" stopOpacity=".04" />
          <stop offset="1" stopColor="#000000" stopOpacity=".35" />
        </linearGradient>
      </defs>
      {isFold && <rect x="2" y="12" width="57" height="174" rx="14" fill="#080a0e" stroke={device.tone} strokeWidth="2" />}
      <rect x={isFold ? 63 : 6} y="4" width={isFold ? 57 : 88} height="192" rx={isFlip ? "22" : "18"} fill="#101217" stroke={device.tone} strokeWidth="2.5" />
      <rect x={isFold ? 67 : 10} y="9" width={isFold ? 49 : 80} height="182" rx={isFlip ? "19" : "14"} fill={`url(#${screenId})`} />
      <path d={isFold ? "M68 130 Q91 72 117 50 V190 H68Z" : "M10 132 Q38 74 90 67 V190 H10Z"} fill="#fff" opacity=".17" />
      <path d={isFold ? "M69 69 Q92 26 116 38 V92 Q91 108 69 143Z" : "M11 45 Q50 80 90 27 V77 Q54 120 11 89Z"} fill="#fff" opacity=".12" />
      {isUltra && <rect x={isFold ? 73 : 16} y="15" width="15" height="4" rx="2" fill="#101217" opacity=".88" />}
      {isFold && <line x1="62" y1="15" x2="62" y2="184" stroke="#fff" strokeOpacity=".22" />}
      {!isUltra && !isFold && <circle cx={isFlip ? 92 : 50} cy="18" r="3" fill="#171a20" stroke="#ffffff" strokeOpacity=".2" />}
      <rect x={isFold ? 63 : 6} y="4" width={isFold ? 57 : 88} height="192" rx={isFlip ? "22" : "18"} fill={`url(#${edgeId})`} opacity=".55" />
      {large && <ellipse cx={isFold ? 91 : 50} cy="183" rx="16" ry="3" fill="#fff" opacity=".1" />}
    </svg>
  );
}
