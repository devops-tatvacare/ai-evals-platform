export type AppIconKind = 'image' | 'glyph';

// A path/URL renders as an image; anything else is a lucide glyph name.
export function iconKindOf(icon: string): AppIconKind {
  return icon.startsWith('/') || icon.includes('://') ? 'image' : 'glyph';
}
