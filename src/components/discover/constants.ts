// Shared with Discover.tsx so it can compute pin numbers without a static
// import of MapPanel.tsx, which pulls in mapbox-gl (lazy-loaded — see its use
// of React.lazy in Discover.tsx).
export const MAX_PINS = 40
