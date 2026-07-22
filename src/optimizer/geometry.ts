import { rectangleArea } from './utils';

export function rectanglesOverlap(
  aX: number,
  aY: number,
  aWidth: number,
  aHeight: number,
  bX: number,
  bY: number,
  bWidth: number,
  bHeight: number,
): boolean {
  return aX < bX + bWidth && aX + aWidth > bX && aY < bY + bHeight && aY + aHeight > bY;
}

export function canPlaceRectangle(
  x: number,
  y: number,
  width: number,
  height: number,
  placedRectangles: Array<{ x: number; y: number; width: number; height: number }>,
): boolean {
  return !placedRectangles.some((rectangle) =>
    rectanglesOverlap(x, y, width, height, rectangle.x, rectangle.y, rectangle.width, rectangle.height),
  );
}

export function fitsInsideTable(
  x: number,
  y: number,
  width: number,
  height: number,
  tableWidth: number,
  tableHeight: number,
): boolean {
  return x >= 0 && y >= 0 && x + width <= tableWidth && y + height <= tableHeight;
}

export function scorePlacement(
  width: number,
  height: number,
  x: number,
  y: number,
  placedRectangles: Array<{ x: number; y: number; width: number; height: number }>,
): number {
  const area = rectangleArea(width, height);
  const overlapPenalty = placedRectangles.some((rectangle) => rectanglesOverlap(x, y, width, height, rectangle.x, rectangle.y, rectangle.width, rectangle.height)) ? 1_000_000 : 0;
  return area + overlapPenalty;
}
