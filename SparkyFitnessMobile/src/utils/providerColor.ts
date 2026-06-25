// Stable per-provider signature colours used to tell sources apart at a glance
// in the All Providers search: a tinted badge behind Top Matches rows and a dot
// before each By Source provider. Known providers get a curated brand-ish
// colour; anything else gets a deterministic hue so new providers still get a
// stable colour with no maintenance.
const PROVIDER_COLORS: Record<string, string> = {
  openfoodfacts: '#3FA34D', // green
  fatsecret: '#E8772E', // orange
  usda: '#2F6FED', // blue
  swissfood: '#D64545', // red
  nutritionix: '#7C3AED', // purple
  mealie: '#0E9F9C', // teal
  tandoor: '#B45309', // amber
  yazio: '#DB2777', // pink
  norish: '#0891B2', // cyan
};

// Hex so callers can append an alpha suffix (e.g. `${color}22`) for a tint.
const FALLBACK_PALETTE = Object.values(PROVIDER_COLORS);

export function providerColor(providerType?: string | null): string {
  if (!providerType) return '#9CA3AF';
  const known = PROVIDER_COLORS[providerType];
  if (known) return known;
  let hash = 0;
  for (let i = 0; i < providerType.length; i++) {
    hash = (hash * 31 + providerType.charCodeAt(i)) >>> 0;
  }
  return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length];
}
