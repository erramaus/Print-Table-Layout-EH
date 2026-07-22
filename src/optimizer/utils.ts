const MM_PER_INCH = 25.4;

export function inchesToMillimeters(inches: number): number {
  return inches * MM_PER_INCH;
}

export function millimetersToInches(millimeters: number): number {
  return millimeters / MM_PER_INCH;
}

export function rectangleArea(width: number, height: number): number {
  return width * height;
}
