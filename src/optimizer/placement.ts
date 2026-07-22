import type { PlacedPainting } from './types';
import { canPlaceRectangle, fitsInsideTable, rectanglesOverlap, scorePlacement } from './geometry';

export function tryPlacePainting(
  painting: PlacedPainting,
  placedRectangles: Array<{ x: number; y: number; width: number; height: number }>,
  tableWidth: number,
  tableHeight: number,
): boolean {
  const width = painting.width;
  const height = painting.height;

  if (!fitsInsideTable(painting.x, painting.y, width, height, tableWidth, tableHeight)) {
    return false;
  }

  const canPlace = canPlaceRectangle(painting.x, painting.y, width, height, placedRectangles);
  return canPlace && !placedRectangles.some((rectangle) => rectanglesOverlap(painting.x, painting.y, width, height, rectangle.x, rectangle.y, rectangle.width, rectangle.height));
}

export function scorePlacementForPainting(
  painting: PlacedPainting,
  placedRectangles: Array<{ x: number; y: number; width: number; height: number }>,
): number {
  return scorePlacement(painting.width, painting.height, painting.x, painting.y, placedRectangles);
}
