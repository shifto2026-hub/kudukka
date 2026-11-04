// Simple stroke icons (24×24), coloured by currentColor.
const P = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18"/><path d="M16 15h2"/><path d="M6 6l9-3 2 3"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 16l-4-4 4-4M6 12h10"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 10h19M6 15h4"/>',
  bank: '<path d="M3 10l9-6 9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>',
  bills: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  food: '<path d="M4 9h16l-1.5 10a2 2 0 0 1-2 1.7h-9a2 2 0 0 1-2-1.7z"/><path d="M8 9l3-5M16 9l-3-5"/>',
  car: '<path d="M5 16l1.5-5.5A2 2 0 0 1 8.4 9h7.2a2 2 0 0 1 1.9 1.5L19 16"/><rect x="3" y="14" width="18" height="5" rx="2"/><circle cx="7.5" cy="19" r="1.5"/><circle cx="16.5" cy="19" r="1.5"/>',
  travel: '<path d="M10.5 13.5L4 11l1.5-1.5 7 1 4.5-4.5a1.8 1.8 0 0 1 2.5 2.5L15 13l1 7-1.5 1.5-2.5-6.5-3 3v2.5L7.5 22 6 18l-4-1.5L3.5 15H6z"/>',
  shopping: '<path d="M5 8h14l-1 12a1.5 1.5 0 0 1-1.5 1.4h-9A1.5 1.5 0 0 1 6 20z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/>',
  other: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2.5"/>',
  income: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  transfer: '<path d="M4 8h14M14 4l4 4-4 4"/><path d="M20 16H6M10 12l-4 4 4 4"/>',
  adjust: '<path d="M5 9h14M5 15h14"/>',
  pot: '<path d="M9 4h6v2.5c4 1.6 6.5 4.8 6.5 8.5 0 4.6-4 7-9.5 7S2.5 19.6 2.5 15c0-3.7 2.5-6.9 6.5-8.5z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l2 2M15 8l2 2"/>',
  face: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 9v1.5M15 9v1.5M12 9v3.5h-1M9.5 15.5c1.5 1 3.5 1 5 0"/>',
};

export function icon(name, size = 22, extra = '') {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${P[name] || P.other}</svg>`;
}

export const POT_LOGO = `<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">
  <circle cx="32" cy="6" r="4.5" fill="#D39932"/>
  <path d="M24 13 h16 v5 c10 4 16 12 16 22 c0 12 -10 19 -24 19 c-14 0 -24 -7 -24 -19 c0 -10 6 -18 16 -22 z" fill="#AE5238"/>
  <rect x="22" y="12" width="20" height="3.5" rx="1.75" fill="#7A2E22"/>
  <rect x="27" y="22" width="10" height="2.4" rx="1.2" fill="#3B2119"/>
  <path d="M14 40 c3 6 9 9 18 9 s15 -3 18 -9" fill="none" stroke="#E3D8C6" stroke-width="1.4" stroke-linecap="round" opacity="0.7"/>
  <path d="M17 34 c3 3 8 4.5 15 4.5 s12 -1.5 15 -4.5" fill="none" stroke="#E3D8C6" stroke-width="1" stroke-linecap="round" opacity="0.5"/>
</svg>`;
