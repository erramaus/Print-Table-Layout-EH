const FALLBACK_HEX = '#bdbdbd';

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function normalizeHex(value: string): string | null {
  const raw = value.trim();
  const match = raw.match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) {
    return null;
  }
  return `#${match[1].toLowerCase()}`;
}

function hexToRgb(hex: string): Rgb | null {
  const normalized = normalizeHex(hex);
  if (!normalized) {
    return null;
  }

  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

function rgbToHex(rgb: Rgb): string {
  const toHex = (value: number) => clampByte(value).toString(16).padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

export function getMutedHexColor(inputHex: string, whiteMix = 0.5): string {
  const source = hexToRgb(inputHex);
  if (!source) {
    return FALLBACK_HEX;
  }

  const mix = Math.max(0, Math.min(1, whiteMix));
  const muted: Rgb = {
    r: source.r + (255 - source.r) * mix,
    g: source.g + (255 - source.g) * mix,
    b: source.b + (255 - source.b) * mix,
  };

  return rgbToHex(muted);
}

export function getMutedRgb01(inputHex: string, whiteMix = 0.5): Rgb {
  const mutedHex = getMutedHexColor(inputHex, whiteMix);
  const muted = hexToRgb(mutedHex);
  if (!muted) {
    return { r: 0.74, g: 0.74, b: 0.74 };
  }

  return {
    r: muted.r / 255,
    g: muted.g / 255,
    b: muted.b / 255,
  };
}

function srgbToLinear(channel: number): number {
  const normalized = channel / 255;
  if (normalized <= 0.03928) {
    return normalized / 12.92;
  }
  return Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function getRelativeLuminance(color: Rgb): number {
  const r = srgbToLinear(color.r);
  const g = srgbToLinear(color.g);
  const b = srgbToLinear(color.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function getContrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function getReadableTextColor(inputHex: string): '#ffffff' | '#111111' {
  const source = hexToRgb(inputHex);
  if (!source) {
    return '#111111';
  }

  const luminance = getRelativeLuminance(source);
  const whiteContrast = getContrastRatio(1, luminance);
  const blackContrast = getContrastRatio(luminance, 0);

  return whiteContrast >= blackContrast ? '#ffffff' : '#111111';
}
