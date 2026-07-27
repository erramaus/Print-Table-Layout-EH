import type { LayoutResult, Painting, PlacedPainting } from './types';

const DEBUG = false;
const TABLE_WIDTH_INCHES = 96;
const TABLE_HEIGHT_INCHES = 80;
const SAMPLE_WIDTH_INCHES = 6;
const SAMPLE_HEIGHT_INCHES = 8;
const SPACING_INCHES = 1;

/**
 * Candidate point for placing the next painting.
 */
export interface Candidate {
  x: number;
  y: number;
}

/**
 * Free region abstraction for future optimization stages.
 */
export interface FreeRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Table state during the placement process.
 */
export interface TableState {
  tableNumber: number;
  paintings: PlacedPainting[];
  freeRegions: FreeRegion[];
}

/**
 * Result of a placement attempt.
 */
export interface PlacementResult {
  placement: PlacedPainting | null;
  table: TableState;
}

type NormalizedPainting = Painting & {
  normalizedWidth: number;
  normalizedHeight: number;
};

interface CandidateScore {
  score: number;
  x: number;
  y: number;
  boundingArea: number;
  contactLength: number;
  totalFreeArea: number;
  largestFreeRegionArea: number;
  fragmentCount: number;
  thinStripCount: number;
  isolatedPocketCount: number;
}

interface MinDimensions {
  minWidth: number;
  minHeight: number;
}

interface DebugCounters {
  candidatesEvaluated: number;
  freeRegionsCreated: number;
  freeRegionsMerged: number;
}

/**
 * Normalizes painting dimensions based on orientation.
 */
function normalizePainting(painting: Painting): NormalizedPainting {
  if (painting.orientation === 'HORIZONTAL') {
    return {
      ...painting,
      normalizedWidth: painting.height,
      normalizedHeight: painting.width,
    };
  }

  return {
    ...painting,
    normalizedWidth: painting.width,
    normalizedHeight: painting.height,
  };
}

/**
 * Normalizes every painting in the order.
 */
function normalizePaintings(order: Painting[]): NormalizedPainting[] {
  return order.map(normalizePainting);
}

/**
 * Sorts paintings by descending area, height, and width.
 */
function sortPaintings(order: Painting[]): NormalizedPainting[] {
  return normalizePaintings(order).sort((a, b) => {
    const aArea = a.normalizedWidth * a.normalizedHeight;
    const bArea = b.normalizedWidth * b.normalizedHeight;

    if (bArea !== aArea) {
      return bArea - aArea;
    }

    if (b.normalizedHeight !== a.normalizedHeight) {
      return b.normalizedHeight - a.normalizedHeight;
    }

    return b.normalizedWidth - a.normalizedWidth;
  });
}

function normalizedPaintingsMinDimensions(paintings: NormalizedPainting[]): MinDimensions {
  if (!paintings.length) {
    return { minWidth: 1, minHeight: 1 };
  }

  return paintings.reduce(
    (current, painting) => ({
      minWidth: Math.min(current.minWidth, painting.normalizedWidth),
      minHeight: Math.min(current.minHeight, painting.normalizedHeight),
    }),
    {
      minWidth: paintings[0].normalizedWidth,
      minHeight: paintings[0].normalizedHeight,
    }
  );
}

function createSamplePainting(tableNumber: number): PlacedPainting {
  return {
    id: sample-,
    referenceNumber: 'SAMPLE',
    name: 'SAMPLE',
    width: SAMPLE_WIDTH_INCHES,
    height: SAMPLE_HEIGHT_INCHES,
    orientation: 'VERTICAL',
    rotated: false,
    tableNumber,
    x: 0,
    y: 0,
    color: '#8b5cf6',
  };
}

function getCandidateKey(candidate: Candidate) {
  return ${candidate.x}:;
}

function rectanglesIntersect(a: FreeRegion, b: FreeRegion) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function getIntersection(a: FreeRegion, b: FreeRegion): FreeRegion | null {
  if (!rectanglesIntersect(a, b)) {
    return null;
  }

  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);

  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
}

function subtractRegion(freeRegion: FreeRegion, obstacle: FreeRegion): FreeRegion[] {
  const intersection = getIntersection(freeRegion, obstacle);
  if (!intersection) {
    return [freeRegion];
  }

  const regions: FreeRegion[] = [];

  if (intersection.y > freeRegion.y) {
    regions.push({
      x: freeRegion.x,
      y: freeRegion.y,
      width: freeRegion.width,
      height: intersection.y - freeRegion.y,
    });
  }

  if (intersection.y + intersection.height < freeRegion.y + freeRegion.height) {
    regions.push({
      x: freeRegion.x,
      y: intersection.y + intersection.height,
      width: freeRegion.width,
      height: freeRegion.y + freeRegion.height - (intersection.y + intersection.height),
    });
  }

  if (intersection.x > freeRegion.x) {
    regions.push({
      x: freeRegion.x,
      y: intersection.y,
      width: intersection.x - freeRegion.x,
      height: intersection.height,
    });
  }

  if (intersection.x + intersection.width < freeRegion.x + freeRegion.width) {
    regions.push({
      x: intersection.x + intersection.width,
      y: intersection.y,
      width: freeRegion.x + freeRegion.width - (intersection.x + intersection.width),
      height: intersection.height,
    });
  }

  return regions.filter((region) => region.width > 0 && region.height > 0);
}

function subtractFreeRegions(freeRegions: FreeRegion[], obstacle: FreeRegion) {
  const result: FreeRegion[] = [];

  for (const freeRegion of freeRegions) {
    result.push(...subtractRegion(freeRegion, obstacle));
  }

  return result;
}

function isRegionUseful(region: FreeRegion, minDimensions: MinDimensions) {
  return (
    region.width >= minDimensions.minWidth &&
    region.height >= minDimensions.minHeight &&
    region.width > 0 &&
    region.height > 0
  );
}

function sortFreeRegions(regions: FreeRegion[]) {
  return regions.sort((a, b) => {
    if (a.x !== b.x) {
      return a.x - b.x;
    }

    if (a.y !== b.y) {
      return a.y - b.y;
    }

    if (a.width !== b.width) {
      return a.width - b.width;
    }

    return a.height - b.height;
  });
}

function mergeTwoRegions(a: FreeRegion, b: FreeRegion): FreeRegion | null {
  if (a.y === b.y && a.height === b.height) {
    if (a.x + a.width === b.x) {
      return { x: a.x, y: a.y, width: a.width + b.width, height: a.height };
    }
    if (b.x + b.width === a.x) {
      return { x: b.x, y: b.y, width: b.width + a.width, height: b.height };
    }
  }

  if (a.x === b.x && a.width === b.width) {
    if (a.y + a.height === b.y) {
      return { x: a.x, y: a.y, width: a.width, height: a.height + b.height };
    }
    if (b.y + b.height === a.y) {
      return { x: b.x, y: b.y, width: b.width, height: b.height + a.height };
    }
  }

  return null;
}

function mergeFreeRegions(regions: FreeRegion[], debug?: DebugCounters) {
  let merged = sortFreeRegions(regions);
  let changed = true;

  while (changed) {
    changed = false;
    const next: FreeRegion[] = [];
    const used = new Array<boolean>(merged.length).fill(false);

    for (let i = 0; i < merged.length; i++) {
      if (used[i]) {
        continue;
      }

      let current = merged[i];

      for (let j = i + 1; j < merged.length; j++) {
        if (used[j]) {
          continue;
        }

        const mergedRegion = mergeTwoRegions(current, merged[j]);
        if (mergedRegion) {
          current = mergedRegion;
          used[j] = true;
          changed = true;
          if (debug) {
            debug.freeRegionsMerged += 1;
          }
        }
      }

      next.push(current);
    }

    merged = sortFreeRegions(next);
  }

  return merged;
}

function getFreeRegionMetrics(freeRegions: FreeRegion[]) {
  let totalFreeArea = 0;
  let largestFreeRegionArea = 0;
  let thinStripCount = 0;
  let isolatedPocketCount = 0;

  for (const region of freeRegions) {
    const area = region.width * region.height;
    totalFreeArea += area;
    largestFreeRegionArea = Math.max(largestFreeRegionArea, area);

    if (region.width < 6 || region.height < 6) {
      thinStripCount += 1;
    }

    if (area < 40) {
      isolatedPocketCount += 1;
    }
  }

  return {
    totalFreeArea,
    largestFreeRegionArea,
    fragmentCount: freeRegions.length,
    thinStripCount,
    isolatedPocketCount,
  };
}

function expandRegion(region: FreeRegion, padding: number): FreeRegion {
  const x = Math.max(0, region.x - padding);
  const y = Math.max(0, region.y - padding);
  const right = Math.min(TABLE_WIDTH_INCHES, region.x + region.width + padding);
  const bottom = Math.min(TABLE_HEIGHT_INCHES, region.y + region.height + padding);

  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
}

function initializeFreeRegions(placements: PlacedPainting[], minDimensions: MinDimensions, debug?: DebugCounters) {
  let freeRegions: FreeRegion[] = [
    {
      x: 0,
      y: 0,
      width: TABLE_WIDTH_INCHES,
      height: TABLE_HEIGHT_INCHES,
    },
  ];

  for (const placement of placements) {
    const occupiedRegion = expandRegion({ x: placement.x, y: placement.y, width: placement.width, height: placement.height }, SPACING_INCHES);
    freeRegions = subtractFreeRegions(freeRegions, occupiedRegion);
    if (debug) {
      debug.freeRegionsCreated += freeRegions.length;
    }
  }

  freeRegions = mergeFreeRegions(freeRegions, debug);
  return freeRegions.filter((region) => isRegionUseful(region, minDimensions));
}

function createInitialTableState(tableNumber: number, minDimensions: MinDimensions): TableState {
  const sample = createSamplePainting(tableNumber);

  return {
    tableNumber,
    paintings: [sample],
    freeRegions: initializeFreeRegions([sample], minDimensions),
  };
}

function getCandidatePositions(table: TableState, width: number, height: number) {
  const candidates = new Map<string, Candidate>();

  for (const region of table.freeRegions) {
    if (region.width < width || region.height < height) {
      continue;
    }

    const xAnchors = new Set<number>([region.x, region.x + region.width - width]);
    const yAnchors = new Set<number>([region.y, region.y + region.height - height]);

    for (const placement of table.paintings) {
      const left = placement.x + placement.width + SPACING_INCHES;
      if (left >= region.x && left <= region.x + region.width - width) {
        xAnchors.add(left);
      }

      const right = placement.x - width - SPACING_INCHES;
      if (right >= region.x && right <= region.x + region.width - width) {
        xAnchors.add(right);
      }

      const top = placement.y + placement.height + SPACING_INCHES;
      if (top >= region.y && top <= region.y + region.height - height) {
        yAnchors.add(top);
      }

      const bottom = placement.y - height - SPACING_INCHES;
      if (bottom >= region.y && bottom <= region.y + region.height - height) {
        yAnchors.add(bottom);
      }
    }

    const sortedX = Array.from(xAnchors).sort((a, b) => a - b);
    const sortedY = Array.from(yAnchors).sort((a, b) => a - b);

    for (const x of sortedX) {
      for (const y of sortedY) {
        const candidate: Candidate = { x, y };
        candidates.set(getCandidateKey(candidate), candidate);
      }
    }
  }

  return Array.from(candidates.values());
}

function simulatePlacementFreeRegions(
  table: TableState,
  candidate: Candidate,
  width: number,
  height: number,
  minDimensions: MinDimensions,
  debug?: DebugCounters
) {
  const placementRegion: FreeRegion = expandRegion({ x: candidate.x, y: candidate.y, width, height }, SPACING_INCHES);
  let freeRegions = subtractFreeRegions(table.freeRegions, placementRegion);
  if (debug) {
    debug.freeRegionsCreated += freeRegions.length;
  }
  freeRegions = mergeFreeRegions(freeRegions, debug);
  return freeRegions.filter((region) => isRegionUseful(region, minDimensions));
}

function getEdgeContactScore(candidate: Candidate, width: number, height: number, placements: PlacedPainting[]) {
  let score = 0;

  if (candidate.x === 0) {
    score += 2;
  }
  if (candidate.y === 0) {
    score += 2;
  }

  const candidateLeft = candidate.x;
  const candidateRight = candidate.x + width;
  const candidateBottom = candidate.y;
  const candidateTop = candidate.y + height;

  for (const placement of placements) {
    const existingLeft = placement.x;
    const existingRight = placement.x + placement.width;
    const existingBottom = placement.y;
    const existingTop = placement.y + placement.height;

    const verticalOverlap = Math.min(candidateTop, existingTop) - Math.max(candidateBottom, existingBottom);
    const horizontalOverlap = Math.min(candidateRight, existingRight) - Math.max(candidateLeft, existingLeft);

    if (verticalOverlap > 0) {
      if (candidateLeft === existingRight + SPACING_INCHES) {
        score += 3;
      }
      if (candidateRight === existingLeft - SPACING_INCHES) {
        score += 3;
      }
    }

    if (horizontalOverlap > 0) {
      if (candidateBottom === existingTop + SPACING_INCHES) {
        score += 3;
      }
      if (candidateTop === existingBottom - SPACING_INCHES) {
        score += 3;
      }
    }
  }

  return score;
}

function getNarrowGapPenalty(candidate: Candidate, width: number, height: number, placements: PlacedPainting[]) {
  let penalty = 0;
  const minGap = 6;

  const candidateLeft = candidate.x;
  const candidateRight = candidate.x + width;
  const candidateBottom = candidate.y;
  const candidateTop = candidate.y + height;

  for (const placement of placements) {
    const existingLeft = placement.x;
    const existingRight = placement.x + placement.width;
    const existingBottom = placement.y;
    const existingTop = placement.y + placement.height;

    const verticalOverlap = Math.min(candidateTop, existingTop) - Math.max(candidateBottom, existingBottom);
    if (verticalOverlap > 0) {
      const gap = Math.max(0, existingLeft - candidateRight, candidateLeft - existingRight);
      if (gap > 0 && gap < minGap) {
        penalty += 1;
      }
    }

    const horizontalOverlap = Math.min(candidateRight, existingRight) - Math.max(candidateLeft, existingLeft);
    if (horizontalOverlap > 0) {
      const gap = Math.max(0, existingBottom - candidateTop, candidateBottom - existingTop);
      if (gap > 0 && gap < minGap) {
        penalty += 1;
      }
    }
  }

  return penalty;
}

function getBoundingArea(placements: PlacedPainting[], candidate: Candidate, width: number, height: number) {
  let minX = candidate.x;
  let minY = candidate.y;
  let maxX = candidate.x + width;
  let maxY = candidate.y + height;

  for (const placement of placements) {
    minX = Math.min(minX, placement.x);
    minY = Math.min(minY, placement.y);
    maxX = Math.max(maxX, placement.x + placement.width);
    maxY = Math.max(maxY, placement.y + placement.height);
  }

  return (maxX - minX) * (maxY - minY);
}

function scoreCandidate(
  candidate: Candidate,
  width: number,
  height: number,
  table: TableState,
  minDimensions: MinDimensions
): CandidateScore {
  const contactLength = getEdgeContactScore(candidate, width, height, table.paintings);
  const boundingArea = getBoundingArea(table.paintings, candidate, width, height);
  const freeRegions = simulatePlacementFreeRegions(table, candidate, width, height, minDimensions);
  const freeMetrics = getFreeRegionMetrics(freeRegions);
  const originDistance = candidate.x + candidate.y;

  const score =
    contactLength * 22 +
    freeMetrics.largestFreeRegionArea * 0.38 -
    freeMetrics.totalFreeArea * 1.05 -
    freeMetrics.fragmentCount * 26 -
    freeMetrics.thinStripCount * 20 -
    freeMetrics.isolatedPocketCount * 18 -
    boundingArea * 0.4 -
    originDistance * 0.35;

  return {
    score,
    x: candidate.x,
    y: candidate.y,
    boundingArea,
    contactLength,
    totalFreeArea: freeMetrics.totalFreeArea,
    largestFreeRegionArea: freeMetrics.largestFreeRegionArea,
    fragmentCount: freeMetrics.fragmentCount,
    thinStripCount: freeMetrics.thinStripCount,
    isolatedPocketCount: freeMetrics.isolatedPocketCount,
  };
}

function compareCandidateScores(a: CandidateScore, b: CandidateScore) {
  if (a.score !== b.score) {
    return b.score - a.score;
  }

  if (a.largestFreeRegionArea !== b.largestFreeRegionArea) {
    return b.largestFreeRegionArea - a.largestFreeRegionArea;
  }

  if (a.fragmentCount !== b.fragmentCount) {
    return a.fragmentCount - b.fragmentCount;
  }

  if (a.boundingArea !== b.boundingArea) {
    return a.boundingArea - b.boundingArea;
  }

  if (a.contactLength !== b.contactLength) {
    return b.contactLength - a.contactLength;
  }

  if (a.x !== b.x) {
    return a.x - b.x;
  }

  return a.y - b.y;
}

function isPlacementValid(
  candidate: Candidate,
  width: number,
  height: number,
  placements: PlacedPainting[]
): boolean {
  if (candidate.x < 0 || candidate.y < 0) {
    return false;
  }

  if (candidate.x + width > TABLE_WIDTH_INCHES || candidate.y + height > TABLE_HEIGHT_INCHES) {
    return false;
  }

  const candidateLeft = candidate.x;
  const candidateRight = candidate.x + width;
  const candidateBottom = candidate.y;
  const candidateTop = candidate.y + height;

  for (const existing of placements) {
    const existingLeft = existing.x;
    const existingRight = existing.x + existing.width;
    const existingBottom = existing.y;
    const existingTop = existing.y + existing.height;

    const horizontalGap =
      candidateLeft >= existingRight + SPACING_INCHES || existingLeft >= candidateRight + SPACING_INCHES;
    const verticalGap =
      candidateBottom >= existingTop + SPACING_INCHES || existingBottom >= candidateTop + SPACING_INCHES;

    if (!horizontalGap && !verticalGap) {
      return false;
    }
  }

  return true;
}

function placePainting(
  painting: NormalizedPainting,
  table: TableState,
  minDimensions: MinDimensions,
  debug: DebugCounters
): PlacementResult {
  const startTime = Date.now();
  const candidates = getCandidatePositions(table, painting.normalizedWidth, painting.normalizedHeight);
  const candidateCount = candidates.length;
  let bestScore: CandidateScore | null = null;
  let bestCandidate: Candidate | null = null;

  for (const candidate of candidates) {
    if (!isPlacementValid(candidate, painting.normalizedWidth, painting.normalizedHeight, table.paintings)) {
      continue;
    }

    debug.candidatesEvaluated += 1;
    const candidateScore = scoreCandidate(
      candidate,
      painting.normalizedWidth,
      painting.normalizedHeight,
      table,
      minDimensions
    );

    if (!bestScore || compareCandidateScores(candidateScore, bestScore) < 0) {
      bestScore = candidateScore;
      bestCandidate = candidate;
    }
  }

  const placement: PlacedPainting | null = bestCandidate
    ? {
        id: painting.id,
        referenceNumber: painting.referenceNumber,
        name: painting.name,
        width: painting.normalizedWidth,
        height: painting.normalizedHeight,
        orientation: painting.orientation,
        rotated: false,
        tableNumber: table.tableNumber,
        x: bestCandidate.x,
        y: bestCandidate.y,
        color: painting.color,
      }
    : null;

  if (DEBUG) {
    console.log(painting=, {
      candidateCount,
      placementTimeMs: Date.now() - startTime,
      placed: placement !== null,
      bestScore,
    });
  }

  return { placement, table };
}

function finalizeLayout(tables: TableState[], placements: PlacedPainting[], orderLength: number): LayoutResult {
  if (DEBUG) {
    const totalFreeArea = tables.reduce(
      (acc, table) => acc + table.freeRegions.reduce((inner, region) => inner + region.width * region.height, 0),
      0
    );
    const totalArea = tables.length * TABLE_WIDTH_INCHES * TABLE_HEIGHT_INCHES;
    console.log('finalizeLayout', {
      tablesUsed: tables.length,
      totalPaintings: orderLength,
      wastePercentage: ((totalFreeArea / totalArea) * 100).toFixed(2),
    });
  }

  return {
    tables: tables as LayoutResult['tables'],
    placements,
    messages: [
      'Reserved the sample rectangle in the front-right corner.',
      Placed  painting(s) across  table(s).,
    ],
  };
}

export function generateLayout(order: Painting[]): LayoutResult {
  const sortedPaintings = sortPaintings(order);
  const minDimensions = normalizedPaintingsMinDimensions(sortedPaintings);
  const firstTable = createInitialTableState(1, minDimensions);
  const tables: TableState[] = [firstTable];
  const placements: PlacedPainting[] = [firstTable.paintings[0]];
  let currentTableNumber = 1;
  const debug: DebugCounters = {
    candidatesEvaluated: 0,
    freeRegionsCreated: 0,
    freeRegionsMerged: 0,
  };

  if (DEBUG) {
    console.log('normalize and sort', sortedPaintings.map((item) => item.referenceNumber));
  }

  for (const painting of sortedPaintings) {
    let placed = false;

    while (!placed) {
      const currentTable = tables[tables.length - 1];
      const result = placePainting(painting, currentTable, minDimensions, debug);

      if (result.placement) {
        currentTable.paintings.push(result.placement);
        currentTable.freeRegions = simulatePlacementFreeRegions(
          currentTable,
          { x: result.placement.x, y: result.placement.y },
          result.placement.width,
          result.placement.height,
          minDimensions,
          debug
        );

        placements.push(result.placement);
        placed = true;
      } else {
        currentTableNumber += 1;
        const newTable = createInitialTableState(currentTableNumber, minDimensions);
        tables.push(newTable);
        placements.push(newTable.paintings[0]);
      }
    }
  }

  if (DEBUG) {
    const totalFreeArea = tables.reduce(
      (acc, table) => acc + table.freeRegions.reduce((inner, region) => inner + region.width * region.height, 0),
      0
    );
    const totalArea = tables.length * TABLE_WIDTH_INCHES * TABLE_HEIGHT_INCHES;
    console.log('optimizer debug', {
      tablesUsed: tables.length,
      candidatesEvaluated: debug.candidatesEvaluated,
      freeRegionsCreated: debug.freeRegionsCreated,
      freeRegionsMerged: debug.freeRegionsMerged,
      wastePercent: ((totalFreeArea / totalArea) * 100).toFixed(2),
    });
  }

  return finalizeLayout(tables, placements, order.length);
}
