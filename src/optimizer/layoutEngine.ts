import {
  MM_PER_INCH,
  SAMPLE_HEIGHT_INCHES,
  SAMPLE_WIDTH_INCHES,
  SPACING_INCHES,
  TABLE_HEIGHT_INCHES,
  TABLE_HEIGHT_MM,
  TABLE_WIDTH_INCHES,
  TABLE_WIDTH_MM,
} from '../constants/tableDimensions';
import type { LayoutResult, Painting, PlacedPainting } from './types';

const DEBUG = false;
const RUNTIME_ENV = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env;
const NODE_ENV_OVERRIDES =
  typeof globalThis !== 'undefined' && 'process' in globalThis
    ? ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? undefined)
    : undefined;
const DEV_MODE = Boolean(RUNTIME_ENV?.DEV);
const DETERMINISTIC_MODE =
  (NODE_ENV_OVERRIDES?.OPTIMIZER_DETERMINISTIC ?? RUNTIME_ENV?.VITE_OPTIMIZER_DETERMINISTIC ?? '0') === '1';
const DEBUG_OVERLAY_ENABLED = DEV_MODE && RUNTIME_ENV?.VITE_OPTIMIZER_DEBUG_OVERLAY === '1';
const PERF_TIMING_ENABLED = DEV_MODE && (RUNTIME_ENV?.VITE_OPTIMIZER_TIMING === '1' || RUNTIME_ENV?.VITE_OPTIMIZER_DEBUG_OVERLAY === '1');
const TIME_BUDGETS_ENABLED =
  !DETERMINISTIC_MODE && (NODE_ENV_OVERRIDES?.OPTIMIZER_TIME_BUDGETS ?? RUNTIME_ENV?.VITE_OPTIMIZER_TIME_BUDGETS ?? '1') !== '0';
const SEARCH_BRANCH_WIDTH = 14;
const SEARCH_MAX_NODES = 6000;
const REPACK_COMBINATION_LIMIT = 48;
const SEARCH_MAX_DEPTH = 80;
const POST_SOLVE_MAX_MS = 250;
const POST_SOLVE_MAX_ITERATIONS = 42;
const POST_SOLVE_STALL_LIMIT = 14;
const POST_SOLVE_NODE_BUDGET = 2400;
const EXTRA_SAMPLE_STEP_MM = 200;
const BASE_CANDIDATE_LAYOUT_COUNT = 30;
const MAX_CANDIDATE_LAYOUT_COUNT = 44;
const MIN_CANDIDATE_LAYOUT_COUNT = 12;
const DETERMINISTIC_CANDIDATE_LAYOUT_COUNT = 14;
const REGIONAL_IMPROVE_MAX_MS = 280;
const REGIONAL_IMPROVE_MAX_ITERATIONS = 36;
const REGIONAL_IMPROVE_STALL_LIMIT = 10;
const REGIONAL_REPAIR_ORDER_TRIES = 6;
const COORDINATE_SNAP_MM = 5;
const COORDINATE_SNAP_INCHES = COORDINATE_SNAP_MM / MM_PER_INCH;
const SNAP_COMPARE_EPSILON = 1e-6;
const FENCE_EPSILON_MM = 0.001;
const FENCE_EPSILON_INCHES = FENCE_EPSILON_MM / MM_PER_INCH;
const FENCE_SNAP_DIAGNOSTICS_ENABLED =
  (NODE_ENV_OVERRIDES?.OPTIMIZER_FENCE_SNAP_DIAGNOSTICS ?? RUNTIME_ENV?.VITE_OPTIMIZER_FENCE_SNAP_DIAGNOSTICS ?? '0') === '1';
const FENCE_SNAP_DIAGNOSTIC_TARGETS_MM = [330.2, 736.6];

const DEFAULT_Y_TRAVEL_WEIGHT = 4;
const DEFAULT_X_TRAVEL_WEIGHT = 1;
const DEFAULT_Y_DEPTH_WEIGHT = 4;
const DEFAULT_Y_CENTER_WEIGHT = 3;
const DEFAULT_Y_TRANSITION_WEIGHT = 2;
const PRINT_TRAVEL_TIE_EPSILON = 0.5;
const RIGHT_FENCE_Y_WEIGHT = 10;

function parsePositiveNumber(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

export interface PrintTravelWeights {
  yTravelWeight: number;
  xTravelWeight: number;
  yDepthWeight: number;
  yCenterWeight: number;
  yTransitionWeight: number;
}

const PRINT_TRAVEL_WEIGHTS: PrintTravelWeights = {
  yTravelWeight: parsePositiveNumber(NODE_ENV_OVERRIDES?.OPTIMIZER_Y_TRAVEL_WEIGHT ?? RUNTIME_ENV?.VITE_OPTIMIZER_Y_TRAVEL_WEIGHT, DEFAULT_Y_TRAVEL_WEIGHT),
  xTravelWeight: parsePositiveNumber(NODE_ENV_OVERRIDES?.OPTIMIZER_X_TRAVEL_WEIGHT ?? RUNTIME_ENV?.VITE_OPTIMIZER_X_TRAVEL_WEIGHT, DEFAULT_X_TRAVEL_WEIGHT),
  yDepthWeight: parsePositiveNumber(NODE_ENV_OVERRIDES?.OPTIMIZER_Y_DEPTH_WEIGHT ?? RUNTIME_ENV?.VITE_OPTIMIZER_Y_DEPTH_WEIGHT, DEFAULT_Y_DEPTH_WEIGHT),
  yCenterWeight: parsePositiveNumber(NODE_ENV_OVERRIDES?.OPTIMIZER_Y_CENTER_WEIGHT ?? RUNTIME_ENV?.VITE_OPTIMIZER_Y_CENTER_WEIGHT, DEFAULT_Y_CENTER_WEIGHT),
  yTransitionWeight: parsePositiveNumber(NODE_ENV_OVERRIDES?.OPTIMIZER_Y_TRANSITION_WEIGHT ?? RUNTIME_ENV?.VITE_OPTIMIZER_Y_TRANSITION_WEIGHT, DEFAULT_Y_TRANSITION_WEIGHT),
};

export type GapClassification =
  | 'LARGE_USABLE'
  | 'NARROW_STRIP'
  | 'CORNER_GAP'
  | 'ENCLOSED_POCKET'
  | 'IRREGULAR_FRAGMENT'
  | 'SAMPLE_EDGE_GAP'
  | 'FENCE_EDGE_GAP';

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

export type NormalizedPainting = Painting & {
  normalizedWidth: number;
  normalizedHeight: number;
};

interface CandidateScore {
  usesExistingTable: number;
  frontRowPenalty: number;
  occupiedDepth: number;
  rightFenceStackDepthCost: number;
  frontFenceTallPieceReward: number;
  frontFenceCoverageScore: number;
  frontOpeningWaste: number;
  frontFenceContactLength: number;
  rightFenceContactLength: number;
  touchesAnyFence: boolean;
  touchedFenceCount: number;
  totalFenceContactLength: number;
  emptyFenceLength: number;
  fenceDriftPenalty: number;
  gapLeftoverArea: number;
  gapFragmentCount: number;
  gapIrregularity: number;
  gapSliverCount: number;
  sharedEdgeLength: number;
  rowAlignmentCount: number;
  columnAlignmentCount: number;
  boundingArea: number;
  totalFreeArea: number;
  averageFreeRegionWidth: number;
  averageFreeRegionHeight: number;
  unusableRegionCount: number;
  futureFitCapacity: number;
  fragmentCount: number;
  thinStripCount: number;
  isolatedPocketCount: number;
  largestFreeRegionArea: number;
  floatingPenalty: number;
  gapPenalty: number;
  zigZagPenalty: number;
  totalPenalty: number;
  snapAlignedAxisCount: number;
  snapDistanceMm: number;
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

export interface CandidateScoreTrace {
  tableNumber: number;
  paintingId: string;
  referenceNumber: string;
  x: number;
  y: number;
  gapLeftoverArea: number;
  sharedEdgeLength: number;
  frontFenceContactLength: number;
  rightFenceContactLength: number;
  totalPenalty: number;
}

export interface OptimizerDebugRunData {
  runId: number;
  elapsedMs: number;
  candidatesEvaluated: number;
  freeRegionsCreated: number;
  freeRegionsMerged: number;
  finalScore: CompleteLayoutScore;
  candidateTrace: CandidateScoreTrace[];
}

export interface OptimizerDebugOverlayData {
  tableNumber: number;
  tableWidthMm: number;
  tableHeightMm: number;
  finalScore: CompleteLayoutScore;
  freeRegions: Array<FreeRegion & { classification: GapClassification }>;
  candidateTrace: CandidateScoreTrace[];
  run: Pick<OptimizerDebugRunData, 'runId' | 'elapsedMs' | 'candidatesEvaluated' | 'freeRegionsCreated' | 'freeRegionsMerged'> | null;
}

let optimizerRunId = 0;
let activeCandidateTrace: CandidateScoreTrace[] = [];
let lastOptimizerDebugRunData: OptimizerDebugRunData | null = null;

/**
 * Normalizes painting dimensions based on orientation.
 */
export function normalizePainting(painting: Painting): NormalizedPainting {
  if (painting.orientation === 'HORI') {
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
export function normalizePaintings(order: Painting[]): NormalizedPainting[] {
  return order.map(normalizePainting);
}

/**
 * Returns normalized paintings for global placement search.
 *
 * We intentionally do not area-sort here because placement selection evaluates
 * all remaining paintings each step, and preserving input order avoids hidden
 * "next painting" bias on rare exact-score ties.
 */
function sortPaintings(order: Painting[]): NormalizedPainting[] {
  return normalizePaintings(order);
}

function normalizedPaintingsMinDimensions(paintings: NormalizedPainting[]): MinDimensions {
  if (!paintings.length) {
    return { minWidth: 1, minHeight: 1 };
  }

  return paintings.reduce(
    (current, painting) => ({
      minWidth: Math.min(current.minWidth, painting.normalizedWidth),
      minHeight: Math.min(current.minHeight, painting.  normalizedHeight),
    }),
    {
      minWidth: paintings[0].normalizedWidth,
      minHeight: paintings[0].normalizedHeight,
    }
  );
}

function createSamplePainting(tableNumber: number): PlacedPainting {
  return {
    id: `sample-${tableNumber}`,
    referenceNumber: 'SAMPLE',
    name: 'SAMPLE',
    sampleType: 'required',
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

function isFixedSamplePlacement(placement: PlacedPainting) {
  return placement.sampleType === 'required';
}

function isExtraSamplePlacement(placement: PlacedPainting) {
  return placement.sampleType === 'extra';
}

function build200MmFenceAnchorsX(width: number) {
  const anchors: number[] = [];
  for (let mm = 0; mm <= TABLE_WIDTH_MM; mm += EXTRA_SAMPLE_STEP_MM) {
    const x = mm / MM_PER_INCH;
    if (x >= 0 && x + width <= TABLE_WIDTH_INCHES) {
      anchors.push(x);
    }
  }
  return anchors;
}

function build200MmFenceAnchorsY(height: number) {
  const anchors: number[] = [];
  for (let mm = 0; mm <= TABLE_HEIGHT_MM; mm += EXTRA_SAMPLE_STEP_MM) {
    const y = mm / MM_PER_INCH;
    if (y >= 0 && y + height <= TABLE_HEIGHT_INCHES) {
      anchors.push(y);
    }
  }
  return anchors;
}

function tryPlaceExtraSampleAt(table: TableState, x: number, y: number) {
  const width = SAMPLE_WIDTH_INCHES;
  const height = SAMPLE_HEIGHT_INCHES;

  if (x < 0 || y < 0 || x + width > TABLE_WIDTH_INCHES || y + height > TABLE_HEIGHT_INCHES) {
    return false;
  }

  if (!isPlacementValid({ x, y }, width, height, table.paintings)) {
    return false;
  }

  const extraIndex = table.paintings.filter((placement) => isExtraSamplePlacement(placement)).length + 1;
  table.paintings.push({
    id: `sample-extra-${table.tableNumber}-${extraIndex}`,
    referenceNumber: 'SAMPLE+',
    name: 'SAMPLE',
    sampleType: 'extra',
    width,
    height,
    orientation: 'VERTICAL',
    rotated: false,
    tableNumber: table.tableNumber,
    x,
    y,
    color: '#8b5cf6',
  });

  return true;
}

function fillExtraSamplesOnTable(table: TableState, minDimensions: MinDimensions) {
  let added = true;

  // Front fence pass first (y = 0), as requested.
  while (added) {
    added = false;
    const anchorsX = build200MmFenceAnchorsX(SAMPLE_WIDTH_INCHES);

    for (const x of anchorsX) {
      if (tryPlaceExtraSampleAt(table, x, 0)) {
        added = true;
      }
    }
  }

  // Right fence pass second (x = 0).
  added = true;
  while (added) {
    added = false;
    const anchorsY = build200MmFenceAnchorsY(SAMPLE_HEIGHT_INCHES);

    for (const y of anchorsY) {
      if (tryPlaceExtraSampleAt(table, 0, y)) {
        added = true;
      }
    }
  }

  table.freeRegions = initializeFreeRegions(table.paintings, minDimensions);
}

function applyExtraSampleFill(result: SearchResult, minDimensions: MinDimensions): SearchResult {
  const tables = cloneTables(result.tables);

  for (const table of tables) {
    // Ensure we are only adding extras after final painting placement.
    table.paintings = table.paintings.filter((placement) => !isExtraSamplePlacement(placement));
    fillExtraSamplesOnTable(table, minDimensions);
  }

  return {
    tables,
    placements: buildPlacementsFromTables(tables),
  };
}

function getCandidateKey(candidate: Candidate) {
  return `${candidate.x}:${candidate.y}`;
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

function removeRedundantFreeRegions(regions: FreeRegion[]) {
  return regions.filter((region, index) => {
    return !regions.some((other, otherIndex) => {
      if (index === otherIndex) {
        return false;
      }

      return (
        region.x >= other.x &&
        region.y >= other.y &&
        region.x + region.width <= other.x + other.width &&
        region.y + region.height <= other.y + other.height
      );
    });
  });
}

function getFreeRegionMetrics(freeRegions: FreeRegion[], remainingPaintings: NormalizedPainting[]) {
  let totalFreeArea = 0;
  let largestFreeRegionArea = 0;
  let thinStripCount = 0;
  let isolatedPocketCount = 0;
  let totalWidth = 0;
  let totalHeight = 0;
  let unusableRegionCount = 0;
  let futureFitCapacity = 0;

  for (const region of freeRegions) {
    const area = region.width * region.height;
    totalFreeArea += area;
    largestFreeRegionArea = Math.max(largestFreeRegionArea, area);
    totalWidth += region.width;
    totalHeight += region.height;

    if (region.width < 2 || region.height < 2) {
      thinStripCount += 1;
    }

    if (area < 40) {
      isolatedPocketCount += 1;
    }

    const fitsCount = remainingPaintings.filter((painting) => canFitPaintingInRegion(region, painting)).length;
    futureFitCapacity += fitsCount;
    if (remainingPaintings.length > 0 && fitsCount === 0) {
      unusableRegionCount += 1;
    }
  }

  const averageFreeRegionWidth = freeRegions.length > 0 ? totalWidth / freeRegions.length : 0;
  const averageFreeRegionHeight = freeRegions.length > 0 ? totalHeight / freeRegions.length : 0;

  return {
    totalFreeArea,
    largestFreeRegionArea,
    averageFreeRegionWidth,
    averageFreeRegionHeight,
    unusableRegionCount,
    futureFitCapacity,
    fragmentCount: freeRegions.length,
    thinStripCount,
    isolatedPocketCount,
  };
}

function getRegionPerimeter(region: FreeRegion) {
  return 2 * (region.width + region.height);
}

function regionTouchesSample(table: TableState, region: FreeRegion) {
  const sample = table.paintings.find((placement) => isFixedSamplePlacement(placement));
  if (!sample) {
    return false;
  }

  const sampleRegion = toOccupiedRegion(sample.x, sample.y, sample.width, sample.height, SPACING_INCHES);
  const xOverlap = Math.max(0, Math.min(region.x + region.width, sampleRegion.x + sampleRegion.width) - Math.max(region.x, sampleRegion.x));
  const yOverlap = Math.max(0, Math.min(region.y + region.height, sampleRegion.y + sampleRegion.height) - Math.max(region.y, sampleRegion.y));

  const touchesHorizontally = xOverlap > 0 && (region.y === sampleRegion.y + sampleRegion.height || sampleRegion.y === region.y + region.height);
  const touchesVertically = yOverlap > 0 && (region.x === sampleRegion.x + sampleRegion.width || sampleRegion.x === region.x + region.width);

  return touchesHorizontally || touchesVertically;
}

function isRegionEnclosedByPaintings(table: TableState, region: FreeRegion) {
  const touchesFrontFence = region.y === 0;
  const touchesRightFence = region.x + region.width === TABLE_WIDTH_INCHES;
  const touchesBackFence = region.y + region.height === TABLE_HEIGHT_INCHES;
  const touchesLeftFence = region.x === 0;

  if (touchesFrontFence || touchesRightFence || touchesBackFence || touchesLeftFence) {
    return false;
  }

  const movable = getTablePaintingsWithoutSample(table);
  const nearLeft = movable.some((placement) => {
    const edges = toRectEdges(placement.x, placement.y, placement.width, placement.height);
    return edges.right + SPACING_INCHES === region.x && !(edges.top <= region.y || edges.bottom >= region.y + region.height);
  });
  const nearRight = movable.some((placement) => {
    const edges = toRectEdges(placement.x, placement.y, placement.width, placement.height);
    return edges.left === region.x + region.width + SPACING_INCHES && !(edges.top <= region.y || edges.bottom >= region.y + region.height);
  });
  const nearBottom = movable.some((placement) => {
    const edges = toRectEdges(placement.x, placement.y, placement.width, placement.height);
    return edges.top + SPACING_INCHES === region.y && !(edges.right <= region.x || edges.left >= region.x + region.width);
  });
  const nearTop = movable.some((placement) => {
    const edges = toRectEdges(placement.x, placement.y, placement.width, placement.height);
    return edges.bottom === region.y + region.height + SPACING_INCHES && !(edges.right <= region.x || edges.left >= region.x + region.width);
  });

  return nearLeft && nearRight && nearBottom && nearTop;
}

function classifyGap(
  table: TableState,
  region: FreeRegion,
  fitCount: number,
  canFitSample: boolean,
  enclosedByPaintings: boolean
): GapClassification {
  const area = region.width * region.height;
  const minSide = Math.min(region.width, region.height);
  const maxSide = Math.max(region.width, region.height);
  const aspectRatio = minSide > 0 ? maxSide / minSide : Number.POSITIVE_INFINITY;
  const touchesFrontFence = region.y === 0;
  const touchesRightFence = region.x + region.width === TABLE_WIDTH_INCHES;
  const touchesOtherFence = region.x === 0 || region.y + region.height === TABLE_HEIGHT_INCHES;

  if (regionTouchesSample(table, region)) {
    return 'SAMPLE_EDGE_GAP';
  }

  if (enclosedByPaintings) {
    return 'ENCLOSED_POCKET';
  }

  if (touchesFrontFence && touchesRightFence) {
    return 'CORNER_GAP';
  }

  if (minSide <= 2.5 || aspectRatio >= 7) {
    return 'NARROW_STRIP';
  }

  if ((touchesFrontFence || touchesRightFence || touchesOtherFence) && fitCount > 0) {
    return 'FENCE_EDGE_GAP';
  }

  if (fitCount === 0 || area < 45) {
    return 'IRREGULAR_FRAGMENT';
  }

  if (area >= 120 && canFitSample) {
    return 'LARGE_USABLE';
  }

  return 'IRREGULAR_FRAGMENT';
}

export function analyzeFreeRegions(table: TableState, fitPaintings: NormalizedPainting[]): GapRegionAnalysis[] {
  return table.freeRegions.map((region) => {
    const area = region.width * region.height;
    const width = region.width;
    const height = region.height;
    const perimeter = getRegionPerimeter(region);
    const aspectRatio = Math.max(width, height) / Math.max(0.0001, Math.min(width, height));
    const touchesFrontFence = region.y === 0;
    const touchesRightFence = region.x + region.width === TABLE_WIDTH_INCHES;
    const touchesOtherFence = region.x === 0 || region.y + region.height === TABLE_HEIGHT_INCHES;
    const enclosedByPaintings = isRegionEnclosedByPaintings(table, region);

    const fittingAreas = fitPaintings
      .filter((painting) => canFitPaintingInRegion(region, painting))
      .map((painting) => painting.normalizedWidth * painting.normalizedHeight)
      .sort((a, b) => a - b);

    const remainingFitCount = fittingAreas.length;
    const smallestRemainingAreaFit = fittingAreas.length > 0 ? fittingAreas[0] : null;
    const canFitSample = width >= SAMPLE_WIDTH_INCHES && height >= SAMPLE_HEIGHT_INCHES;

    const classification = classifyGap(table, region, remainingFitCount, canFitSample, enclosedByPaintings);

    return {
      region,
      classification,
      area,
      width,
      height,
      perimeter,
      aspectRatio,
      touchesFrontFence,
      touchesRightFence,
      touchesOtherFence,
      enclosedByPaintings,
      smallestRemainingAreaFit,
      remainingFitCount,
      canFitSample,
    };
  });
}

export function scoreGapQuality(gaps: GapRegionAnalysis[]): GapQualityScore {
  let rewardLargeUsable = 0;
  let rewardRemainingFit = 0;
  let rewardFenceUsable = 0;
  let rewardSampleFit = 0;
  let penaltyEnclosedPockets = 0;
  let penaltyNarrowStrips = 0;
  let penaltyUnusable = 0;
  let penaltyFragments = 0;
  let penaltyExcessPerimeter = 0;
  let penaltySmallIsolated = 0;
  let largestUsableRectangle = 0;
  let unusableSlivers = 0;
  let totalPerimeter = 0;

  for (const gap of gaps) {
    totalPerimeter += gap.perimeter;

    if (gap.classification === 'LARGE_USABLE') {
      rewardLargeUsable += gap.area;
      largestUsableRectangle = Math.max(largestUsableRectangle, gap.area);
    }

    rewardRemainingFit += gap.remainingFitCount;

    if ((gap.classification === 'FENCE_EDGE_GAP' || gap.classification === 'CORNER_GAP') && gap.remainingFitCount > 0) {
      rewardFenceUsable += gap.area;
    }

    if (gap.canFitSample) {
      rewardSampleFit += 1;
    }

    if (gap.classification === 'ENCLOSED_POCKET' || gap.enclosedByPaintings) {
      penaltyEnclosedPockets += 1;
    }

    if (gap.classification === 'NARROW_STRIP') {
      penaltyNarrowStrips += 1;
      if (Math.min(gap.width, gap.height) < 2) {
        unusableSlivers += 1;
      }
    }

    if (gap.remainingFitCount === 0) {
      penaltyUnusable += 1;
    }

    if (gap.classification === 'IRREGULAR_FRAGMENT') {
      penaltyFragments += 1;
    }

    if (gap.area < 40) {
      penaltySmallIsolated += 1;
    }
  }

  const fragmentation = gaps.length;
  const largestArea = gaps.reduce((max, gap) => Math.max(max, gap.area), 0);
  const totalArea = gaps.reduce((sum, gap) => sum + gap.area, 0);
  const rewardContinuousSpace = Math.max(0, largestArea - Math.max(0, totalArea - largestArea));
  penaltyExcessPerimeter = Math.max(0, totalPerimeter - Math.sqrt(Math.max(0, totalArea)) * 8);

  const netGapScore =
    rewardLargeUsable * 1.4 +
    rewardContinuousSpace * 0.9 +
    rewardRemainingFit * 25 +
    rewardFenceUsable * 0.25 +
    rewardSampleFit * 18 -
    penaltyEnclosedPockets * 220 -
    penaltyNarrowStrips * 110 -
    penaltyUnusable * 85 -
    penaltyFragments * 65 -
    penaltyExcessPerimeter * 0.2 -
    penaltySmallIsolated * 45;

  return {
    rewardLargeUsable,
    rewardContinuousSpace,
    rewardRemainingFit,
    rewardFenceUsable,
    rewardSampleFit,
    penaltyEnclosedPockets,
    penaltyNarrowStrips,
    penaltyUnusable,
    penaltyFragments,
    penaltyExcessPerimeter,
    penaltySmallIsolated,
    largestUsableRectangle,
    fragmentation,
    unusableSlivers,
    netGapScore,
  };
}

function canFitPaintingInRegion(region: FreeRegion, painting: NormalizedPainting) {
  return region.width >= painting.normalizedWidth && region.height >= painting.normalizedHeight;
}

export function toLeftOriginX(x: number, width: number) {
  return TABLE_WIDTH_INCHES - (x + width);
}

export function toRectEdges(x: number, y: number, width: number, height: number) {
  const left = toLeftOriginX(x, width);
  const right = left + width;
  const bottom = y;
  const top = y + height;

  return { left, right, bottom, top };
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

function toOccupiedRegion(x: number, y: number, width: number, height: number, padding: number): FreeRegion {
  return expandRegion(
    {
      x: toLeftOriginX(x, width),
      y,
      width,
      height,
    },
    padding
  );
}

function toMillimeters(valueInches: number) {
  return valueInches * MM_PER_INCH;
}

function toInches(valueMm: number) {
  return valueMm / MM_PER_INCH;
}

export function snapToNearest5Mm(value: number): number {
  return toInches(Math.round(toMillimeters(value) / COORDINATE_SNAP_MM) * COORDINATE_SNAP_MM);
}

function getSnappedCoordinateCandidates(value: number, maxMm?: number) {
  const base = snapToNearest5Mm(value);
  if (maxMm === undefined || !Number.isFinite(maxMm)) {
    const candidates = [
      base,
      base - COORDINATE_SNAP_INCHES,
      base + COORDINATE_SNAP_INCHES,
      base - COORDINATE_SNAP_INCHES * 2,
      base + COORDINATE_SNAP_INCHES * 2,
    ];

    const unique = new Map<string, number>();
    for (const candidate of candidates) {
      if (candidate < 0) {
        continue;
      }
      unique.set(toMillimeters(candidate).toFixed(6), candidate);
    }

    return Array.from(unique.values());
  }

  const currentMm = toMillimeters(value);
  const maxIndex = Math.max(0, Math.floor(maxMm / COORDINATE_SNAP_MM));
  const candidates: number[] = [];

  for (let index = 0; index <= maxIndex; index += 1) {
    candidates.push(toInches(index * COORDINATE_SNAP_MM));
  }

  return candidates.sort((a, b) => Math.abs(toMillimeters(a) - currentMm) - Math.abs(toMillimeters(b) - currentMm));
}

export function getValidSnappedCoordinate(
  value: number,
  isValid: (candidate: number) => boolean,
  maxMm?: number
): number {
  const valid = getSnappedCoordinateCandidates(value, maxMm)
    .filter(isValid)
    .sort((a, b) => Math.abs(a - value) - Math.abs(b - value));

  return valid[0] ?? value;
}

function isSnappedCoordinate(value: number) {
  const mm = toMillimeters(value);
  const snappedMm = Math.round(mm / COORDINATE_SNAP_MM) * COORDINATE_SNAP_MM;
  return Math.abs(mm - snappedMm) <= 0.01;
}

function resolveSnappedCandidate(
  table: TableState,
  originalCandidate: Candidate,
  width: number,
  height: number,
  depthCap?: number
) {
  void table;
  void width;
  void height;
  void depthCap;

  return {
    candidate: originalCandidate,
    snapAlignedAxisCount: 0,
    snapDistanceMm: 0,
  };
}

export function initializeFreeRegions(placements: PlacedPainting[], minDimensions: MinDimensions, debug?: DebugCounters) {
  let freeRegions: FreeRegion[] = [
    {
      x: 0,
      y: 0,
      width: TABLE_WIDTH_INCHES,
      height: TABLE_HEIGHT_INCHES,
    },
  ];

  for (const placement of placements) {
    const occupiedRegion = toOccupiedRegion(placement.x, placement.y, placement.width, placement.height, SPACING_INCHES);
    freeRegions = subtractFreeRegions(freeRegions, occupiedRegion);
    if (debug) {
      debug.freeRegionsCreated += freeRegions.length;
    }
  }

  freeRegions = mergeFreeRegions(freeRegions, debug);
  freeRegions = removeRedundantFreeRegions(freeRegions);
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
  const xAnchors = new Set<number>([0]);
  const yAnchors = new Set<number>([0]);
  const movablePlacements = table.paintings.filter((placement) => placement.referenceNumber !== 'SAMPLE');

  // SAMPLE remains fixed dead-space and should not drive movable frontier generation.
  for (const placement of movablePlacements) {
    xAnchors.add(placement.x);
    xAnchors.add(placement.x + placement.width + SPACING_INCHES);
    yAnchors.add(placement.y);
    yAnchors.add(placement.y + placement.height + SPACING_INCHES);
  }

  const addCandidate = (x: number, y: number) => {
    if (x < 0 || y < 0 || x + width > TABLE_WIDTH_INCHES || y + height > TABLE_HEIGHT_INCHES) {
      return;
    }

    const candidate: Candidate = { x, y };
    candidates.set(getCandidateKey(candidate), candidate);
  };

  // Right fence origins: x = 0 touches the right fence.
  for (const y of yAnchors) {
    addCandidate(0, y);
  }

  // Front fence origins: y = 0 touches the front fence.
  for (const x of xAnchors) {
    addCandidate(x, 0);
  }

  // Left fence origins.
  for (const y of yAnchors) {
    addCandidate(TABLE_WIDTH_INCHES - width, y);
  }

  // Back fence origins.
  for (const x of xAnchors) {
    addCandidate(x, TABLE_HEIGHT_INCHES - height);
  }

  // Left/top side origins from real paintings only.
  for (const placement of movablePlacements) {
    const leftOfPlacement = placement.x + placement.width + SPACING_INCHES;
    const topOfPlacement = placement.y + placement.height + SPACING_INCHES;

    for (const y of yAnchors) {
      addCandidate(leftOfPlacement, y);
    }

    for (const x of xAnchors) {
      addCandidate(x, topOfPlacement);
    }
  }

  // Operate within free rectangles carved around dead-space obstacles (including SAMPLE + spacing).
  for (const region of table.freeRegions) {
    const regionCornerXs = [
      TABLE_WIDTH_INCHES - (region.x + width),
      TABLE_WIDTH_INCHES - (region.x + region.width),
    ];
    const regionCornerYs = [
      region.y,
      region.y + region.height - height,
    ];

    for (const x of regionCornerXs) {
      for (const y of regionCornerYs) {
        addCandidate(x, y);
      }
    }
  }

  return Array.from(candidates.values());
}

function simulatePlacementFreeRegions(table: TableState, candidate: Candidate, width: number, height: number, debug?: DebugCounters) {
  const placementRegion: FreeRegion = toOccupiedRegion(candidate.x, candidate.y, width, height, SPACING_INCHES);
  let freeRegions = subtractFreeRegions(table.freeRegions, placementRegion);
  if (debug) {
    debug.freeRegionsCreated += freeRegions.length;
  }
  freeRegions = mergeFreeRegions(freeRegions, debug);
  freeRegions = removeRedundantFreeRegions(freeRegions);
  return freeRegions;
}

interface CandidateMetrics {
  frontFenceContactLength: number;
  rightFenceContactLength: number;
  backFenceContactLength: number;
  leftFenceContactLength: number;
  paintingContactLength: number;
  sharedEdgeLength: number;
  rowAlignmentCount: number;
  columnAlignmentCount: number;
  supported: boolean;
}

interface PerimeterMetrics {
  touchedFenceCount: number;
  totalFenceContactLength: number;
  emptyFenceLength: number;
}

function mergeIntervals(intervals: Array<{ start: number; end: number }>) {
  if (intervals.length === 0) {
    return [];
  }

  const sorted = [...intervals].sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start;
    }
    return a.end - b.end;
  });

  const merged: Array<{ start: number; end: number }> = [sorted[0]];

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
      continue;
    }

    merged.push({ start: current.start, end: current.end });
  }

  return merged;
}

function sumMergedIntervalLength(intervals: Array<{ start: number; end: number }>) {
  return mergeIntervals(intervals).reduce((acc, interval) => acc + Math.max(0, interval.end - interval.start), 0);
}

function getPerimeterMetricsForPlacements(placements: PlacedPainting[]): PerimeterMetrics {
  const frontIntervals: Array<{ start: number; end: number }> = [];
  const backIntervals: Array<{ start: number; end: number }> = [];
  const leftIntervals: Array<{ start: number; end: number }> = [];
  const rightIntervals: Array<{ start: number; end: number }> = [];

  for (const placement of placements) {
    if (placement.referenceNumber === 'SAMPLE') {
      continue;
    }

    const edges = toRectEdges(placement.x, placement.y, placement.width, placement.height);

    if (edges.bottom === 0) {
      frontIntervals.push({ start: edges.left, end: edges.right });
    }
    if (edges.top === TABLE_HEIGHT_INCHES) {
      backIntervals.push({ start: edges.left, end: edges.right });
    }
    if (edges.left === 0) {
      leftIntervals.push({ start: edges.bottom, end: edges.top });
    }
    if (edges.right === TABLE_WIDTH_INCHES) {
      rightIntervals.push({ start: edges.bottom, end: edges.top });
    }
  }

  const frontLength = sumMergedIntervalLength(frontIntervals);
  const backLength = sumMergedIntervalLength(backIntervals);
  const leftLength = sumMergedIntervalLength(leftIntervals);
  const rightLength = sumMergedIntervalLength(rightIntervals);

  const touchedFenceCount = [frontLength, backLength, leftLength, rightLength].filter((length) => length > 0).length;
  const totalFenceContactLength = frontLength + backLength + leftLength + rightLength;
  const totalPerimeterLength = 2 * (TABLE_WIDTH_INCHES + TABLE_HEIGHT_INCHES);

  return {
    touchedFenceCount,
    totalFenceContactLength,
    emptyFenceLength: Math.max(0, totalPerimeterLength - totalFenceContactLength),
  };
}

function getCandidateMetrics(candidate: Candidate, width: number, height: number, placements: PlacedPainting[]): CandidateMetrics {
  const candidateEdges = toRectEdges(candidate.x, candidate.y, width, height);
  let frontFenceContactLength = 0;
  let rightFenceContactLength = 0;
  let backFenceContactLength = 0;
  let leftFenceContactLength = 0;
  let paintingContactLength = 0;
  let sharedEdgeLength = 0;
  let rowAlignmentCount = 0;
  let columnAlignmentCount = 0;

  if (candidate.y === 0) {
    frontFenceContactLength += width;
  }

  if (candidate.x === 0) {
    rightFenceContactLength += height;
  }

  if (candidate.y + height === TABLE_HEIGHT_INCHES) {
    backFenceContactLength += width;
  }

  if (candidate.x + width === TABLE_WIDTH_INCHES) {
    leftFenceContactLength += height;
  }

  for (const placement of placements) {
    if (placement.referenceNumber === 'SAMPLE') {
      continue;
    }

    const existingEdges = toRectEdges(placement.x, placement.y, placement.width, placement.height);

    const verticalOverlap = Math.max(
      0,
      Math.min(candidateEdges.top, existingEdges.top) - Math.max(candidateEdges.bottom, existingEdges.bottom)
    );
    const horizontalOverlap = Math.max(
      0,
      Math.min(candidateEdges.right, existingEdges.right) - Math.max(candidateEdges.left, existingEdges.left)
    );

    const rightAdjacency = candidateEdges.left === existingEdges.right + SPACING_INCHES && verticalOverlap > 0;
    const leftAdjacency = candidateEdges.right + SPACING_INCHES === existingEdges.left && verticalOverlap > 0;
    const bottomAdjacency = candidateEdges.bottom === existingEdges.top + SPACING_INCHES && horizontalOverlap > 0;
    const topAdjacency = candidateEdges.top + SPACING_INCHES === existingEdges.bottom && horizontalOverlap > 0;

    if (rightAdjacency || leftAdjacency || bottomAdjacency || topAdjacency) {
      const sharedEdge = rightAdjacency || leftAdjacency ? verticalOverlap : horizontalOverlap;
      sharedEdgeLength += sharedEdge;
      paintingContactLength += sharedEdge;
    }

    if (candidateEdges.left === existingEdges.left || candidateEdges.right === existingEdges.right) {
      columnAlignmentCount += 1;
    }
    if (candidateEdges.top === existingEdges.top || candidateEdges.bottom === existingEdges.bottom) {
      rowAlignmentCount += 1;
    }
  }

  const supported =
    frontFenceContactLength > 0 ||
    rightFenceContactLength > 0 ||
    backFenceContactLength > 0 ||
    leftFenceContactLength > 0 ||
    paintingContactLength > 0;

  return {
    frontFenceContactLength,
    rightFenceContactLength,
    backFenceContactLength,
    leftFenceContactLength,
    paintingContactLength,
    sharedEdgeLength,
    rowAlignmentCount,
    columnAlignmentCount,
    supported,
  };
}

function getNarrowGapPenalty(candidate: Candidate, width: number, height: number, placements: PlacedPainting[]) {
  let penalty = 0;
  const minGap = 6;

  const candidateEdges = toRectEdges(candidate.x, candidate.y, width, height);

  for (const placement of placements) {
    if (placement.referenceNumber === 'SAMPLE') {
      continue;
    }

    const existingEdges = toRectEdges(placement.x, placement.y, placement.width, placement.height);

    const verticalOverlap = Math.min(candidateEdges.top, existingEdges.top) - Math.max(candidateEdges.bottom, existingEdges.bottom);
    if (verticalOverlap > 0) {
      const gapRight = existingEdges.left - candidateEdges.right;
      if (gapRight > 0 && gapRight < minGap) {
        penalty += 1;
      }

      const gapLeft = candidateEdges.left - existingEdges.right;
      if (gapLeft > 0 && gapLeft < minGap) {
        penalty += 1;
      }
    }

    const horizontalOverlap = Math.min(candidateEdges.right, existingEdges.right) - Math.max(candidateEdges.left, existingEdges.left);
    if (horizontalOverlap > 0) {
      const gapBottom = existingEdges.bottom - candidateEdges.top;
      if (gapBottom > 0 && gapBottom < minGap) {
        penalty += 1;
      }

      const gapTop = candidateEdges.bottom - existingEdges.top;
      if (gapTop > 0 && gapTop < minGap) {
        penalty += 1;
      }
    }
  }

  return penalty;
}

function fitsWithinAnyFreeRegion(candidate: Candidate, width: number, height: number, freeRegions: FreeRegion[]) {
  const candidateLeft = toLeftOriginX(candidate.x, width);
  const candidateRight = candidateLeft + width;

  return freeRegions.some((region) => {
    return (
      candidateLeft >= region.x &&
      candidate.y >= region.y &&
      candidateRight <= region.x + region.width &&
      candidate.y + height <= region.y + region.height
    );
  });
}

function getZigZagPenalty(candidate: Candidate, width: number, height: number, placements: PlacedPainting[]) {
  const candidateEdges = toRectEdges(candidate.x, candidate.y, width, height);

  const aligned = placements.some((placement) => {
    if (placement.referenceNumber === 'SAMPLE') {
      return false;
    }

    const existingEdges = toRectEdges(placement.x, placement.y, placement.width, placement.height);

    return (
      candidateEdges.left === existingEdges.left ||
      candidateEdges.right === existingEdges.right ||
      candidateEdges.top === existingEdges.top ||
      candidateEdges.bottom === existingEdges.bottom
    );
  });

  return aligned ? 0 : 1;
}

function getBoundingArea(placements: PlacedPainting[], candidate: Candidate, width: number, height: number) {
  let minX = toLeftOriginX(candidate.x, width);
  let minY = candidate.y;
  let maxX = minX + width;
  let maxY = candidate.y + height;

  for (const placement of placements) {
    const placementLeft = toLeftOriginX(placement.x, placement.width);
    minX = Math.min(minX, placementLeft);
    minY = Math.min(minY, placement.y);
    maxX = Math.max(maxX, placementLeft + placement.width);
    maxY = Math.max(maxY, placement.y + placement.height);
  }

  return (maxX - minX) * (maxY - minY);
}

function getGapFitMetrics(candidate: Candidate, width: number, height: number, freeRegions: FreeRegion[]) {
  const candidateLeft = toLeftOriginX(candidate.x, width);
  const candidateRegion: FreeRegion = {
    x: candidateLeft,
    y: candidate.y,
    width,
    height,
  };

  let bestLeftoverArea = Number.POSITIVE_INFINITY;
  let bestFragmentCount = Number.POSITIVE_INFINITY;
  let bestIrregularity = Number.POSITIVE_INFINITY;
  let bestSliverCount = Number.POSITIVE_INFINITY;

  for (const region of freeRegions) {
    const containsCandidate =
      candidateRegion.x >= region.x &&
      candidateRegion.y >= region.y &&
      candidateRegion.x + candidateRegion.width <= region.x + region.width &&
      candidateRegion.y + candidateRegion.height <= region.y + region.height;

    if (!containsCandidate) {
      continue;
    }

    const leftoverArea = region.width * region.height - candidateRegion.width * candidateRegion.height;
    const fragments = subtractRegion(region, candidateRegion);
    const fragmentCount = fragments.length;
    const irregularity = Math.max(0, fragmentCount - 1);
    const sliverCount = fragments.filter((fragment) => fragment.width < 2 || fragment.height < 2).length;

    if (
      leftoverArea < bestLeftoverArea ||
      (leftoverArea === bestLeftoverArea && irregularity < bestIrregularity) ||
      (leftoverArea === bestLeftoverArea && irregularity === bestIrregularity && fragmentCount < bestFragmentCount) ||
      (leftoverArea === bestLeftoverArea && irregularity === bestIrregularity && fragmentCount === bestFragmentCount && sliverCount < bestSliverCount)
    ) {
      bestLeftoverArea = leftoverArea;
      bestFragmentCount = fragmentCount;
      bestIrregularity = irregularity;
      bestSliverCount = sliverCount;
    }
  }

  return {
    gapLeftoverArea: Number.isFinite(bestLeftoverArea) ? bestLeftoverArea : Number.POSITIVE_INFINITY,
    gapFragmentCount: Number.isFinite(bestFragmentCount) ? bestFragmentCount : Number.POSITIVE_INFINITY,
    gapIrregularity: Number.isFinite(bestIrregularity) ? bestIrregularity : Number.POSITIVE_INFINITY,
    gapSliverCount: Number.isFinite(bestSliverCount) ? bestSliverCount : Number.POSITIVE_INFINITY,
  };
}

function scoreCandidate(
  candidate: Candidate,
  width: number,
  height: number,
  table: TableState,
  freeRegions: FreeRegion[],
  remainingPaintings: NormalizedPainting[],
  frontRowPenalty: number,
  snapAlignedAxisCount: number,
  snapDistanceMm: number
): CandidateScore {
  const metrics = getCandidateMetrics(candidate, width, height, table.paintings);
  const gapFitMetrics = getGapFitMetrics(candidate, width, height, table.freeRegions);
  const boundingArea = getBoundingArea(table.paintings, candidate, width, height);
  const freeMetrics = getFreeRegionMetrics(freeRegions, remainingPaintings);

  const syntheticCandidate: PlacedPainting = {
    id: '__candidate__',
    referenceNumber: '__candidate__',
    name: undefined,
    width,
    height,
    orientation: 'VERTICAL',
    rotated: false,
    tableNumber: table.tableNumber,
    x: candidate.x,
    y: candidate.y,
    color: '#000000',
  };

  const perimeterMetrics = getPerimeterMetricsForPlacements([
    ...table.paintings,
    syntheticCandidate,
  ]);

  const movableWithCandidate = [
    ...getTablePaintingsWithoutSample(table),
    syntheticCandidate,
  ];
  const sample = table.paintings.find((placement) => isFixedSamplePlacement(placement));
  const sampleTop = sample ? sample.y + sample.height : 0;
  const isAboveSampleOnRightFence =
    sample !== undefined &&
    candidate.x === 0 &&
    candidate.y >= sampleTop + SPACING_INCHES - 1e-6;
  const rightFenceStackDepthCost = isAboveSampleOnRightFence ? height * RIGHT_FENCE_Y_WEIGHT : 0;
  const frontFenceTallPieceReward = candidate.y === 0 ? height : 0;
  const occupiedDepth = movableWithCandidate.reduce((max, placement) => {
    return Math.max(max, placement.y + placement.height);
  }, 0);
  const frontFenceCoverageLength = movableWithCandidate.reduce((sum, placement) => {
    return placement.y === 0 ? sum + placement.width : sum;
  }, 0);
  const frontFenceCoverageScore = TABLE_WIDTH_INCHES > 0 ? frontFenceCoverageLength / TABLE_WIDTH_INCHES : 0;

  let frontOpeningWaste = Number.POSITIVE_INFINITY;
  if (candidate.y === 0) {
    for (const region of table.freeRegions) {
      if (region.y !== 0) {
        continue;
      }

      const candidateLeft = toLeftOriginX(candidate.x, width);
      const candidateRight = candidateLeft + width;
      const regionLeft = region.x;
      const regionRight = region.x + region.width;
      const canUseRegion =
        candidateLeft >= regionLeft &&
        candidateRight <= regionRight &&
        height <= region.height;

      if (!canUseRegion) {
        continue;
      }

      const waste = Math.max(0, region.width - width);
      if (waste < frontOpeningWaste) {
        frontOpeningWaste = waste;
      }
    }
  }

  const candidateEdges = toRectEdges(candidate.x, candidate.y, width, height);
  const touchesAnyFence =
    candidateEdges.bottom === 0 ||
    candidateEdges.top === TABLE_HEIGHT_INCHES ||
    candidateEdges.left === 0 ||
    candidateEdges.right === TABLE_WIDTH_INCHES;

  const fenceDriftPenalty = touchesAnyFence ? 0 : 1;
  const floatingPenalty = metrics.supported ? 0 : 1;
  const gapPenalty = getNarrowGapPenalty(candidate, width, height, table.paintings);
  const zigZagPenalty = getZigZagPenalty(candidate, width, height, table.paintings);
  const totalPenalty =
    floatingPenalty +
    fenceDriftPenalty +
    gapPenalty +
    zigZagPenalty +
    freeMetrics.isolatedPocketCount +
    freeMetrics.thinStripCount;

  return {
    usesExistingTable: 1,
    frontRowPenalty,
    occupiedDepth,
    rightFenceStackDepthCost,
    frontFenceTallPieceReward,
    frontFenceCoverageScore,
    frontOpeningWaste,
    frontFenceContactLength: metrics.frontFenceContactLength,
    rightFenceContactLength: metrics.rightFenceContactLength,
    touchesAnyFence,
    touchedFenceCount: perimeterMetrics.touchedFenceCount,
    totalFenceContactLength: perimeterMetrics.totalFenceContactLength,
    emptyFenceLength: perimeterMetrics.emptyFenceLength,
    fenceDriftPenalty,
    gapLeftoverArea: gapFitMetrics.gapLeftoverArea,
    gapFragmentCount: gapFitMetrics.gapFragmentCount,
    gapIrregularity: gapFitMetrics.gapIrregularity,
    gapSliverCount: gapFitMetrics.gapSliverCount,
    sharedEdgeLength: metrics.sharedEdgeLength,
    rowAlignmentCount: metrics.rowAlignmentCount,
    columnAlignmentCount: metrics.columnAlignmentCount,
    boundingArea,
    totalFreeArea: freeMetrics.totalFreeArea,
    averageFreeRegionWidth: freeMetrics.averageFreeRegionWidth,
    averageFreeRegionHeight: freeMetrics.averageFreeRegionHeight,
    unusableRegionCount: freeMetrics.unusableRegionCount,
    futureFitCapacity: freeMetrics.futureFitCapacity,
    fragmentCount: freeMetrics.fragmentCount,
    thinStripCount: freeMetrics.thinStripCount,
    isolatedPocketCount: freeMetrics.isolatedPocketCount,
    largestFreeRegionArea: freeMetrics.largestFreeRegionArea,
    floatingPenalty,
    gapPenalty,
    zigZagPenalty,
    totalPenalty,
    snapAlignedAxisCount,
    snapDistanceMm,
  };
}

function compareCandidateScores(a: CandidateScore, b: CandidateScore) {
  if (a.usesExistingTable !== b.usesExistingTable) {
    return b.usesExistingTable - a.usesExistingTable;
  }

  if (a.frontRowPenalty !== b.frontRowPenalty) {
    return a.frontRowPenalty - b.frontRowPenalty;
  }

  if (a.occupiedDepth !== b.occupiedDepth) {
    return a.occupiedDepth - b.occupiedDepth;
  }

  if (a.rightFenceStackDepthCost !== b.rightFenceStackDepthCost) {
    return a.rightFenceStackDepthCost - b.rightFenceStackDepthCost;
  }

  if (a.frontFenceTallPieceReward !== b.frontFenceTallPieceReward) {
    return b.frontFenceTallPieceReward - a.frontFenceTallPieceReward;
  }

  if (a.frontFenceCoverageScore !== b.frontFenceCoverageScore) {
    return b.frontFenceCoverageScore - a.frontFenceCoverageScore;
  }

  if (a.frontOpeningWaste !== b.frontOpeningWaste) {
    return a.frontOpeningWaste - b.frontOpeningWaste;
  }

  if (a.gapLeftoverArea !== b.gapLeftoverArea) {
    return a.gapLeftoverArea - b.gapLeftoverArea;
  }

  if (a.gapIrregularity !== b.gapIrregularity) {
    return a.gapIrregularity - b.gapIrregularity;
  }

  if (a.gapFragmentCount !== b.gapFragmentCount) {
    return a.gapFragmentCount - b.gapFragmentCount;
  }

  if (a.gapSliverCount !== b.gapSliverCount) {
    return a.gapSliverCount - b.gapSliverCount;
  }

  // Prioritize preserving one large contiguous free area and future capacity.
  if (a.largestFreeRegionArea !== b.largestFreeRegionArea) {
    return b.largestFreeRegionArea - a.largestFreeRegionArea;
  }

  if (a.futureFitCapacity !== b.futureFitCapacity) {
    return b.futureFitCapacity - a.futureFitCapacity;
  }

  if (a.fragmentCount !== b.fragmentCount) {
    return a.fragmentCount - b.fragmentCount;
  }

  if (a.unusableRegionCount !== b.unusableRegionCount) {
    return a.unusableRegionCount - b.unusableRegionCount;
  }

  if (a.thinStripCount !== b.thinStripCount) {
    return a.thinStripCount - b.thinStripCount;
  }

  if (a.isolatedPocketCount !== b.isolatedPocketCount) {
    return a.isolatedPocketCount - b.isolatedPocketCount;
  }

  if (a.averageFreeRegionWidth !== b.averageFreeRegionWidth) {
    return b.averageFreeRegionWidth - a.averageFreeRegionWidth;
  }

  if (a.averageFreeRegionHeight !== b.averageFreeRegionHeight) {
    return b.averageFreeRegionHeight - a.averageFreeRegionHeight;
  }

  // Physical priorities: FRONT fence first, then RIGHT fence.
  if (a.frontFenceContactLength !== b.frontFenceContactLength) {
    return b.frontFenceContactLength - a.frontFenceContactLength;
  }

  if (a.rightFenceContactLength !== b.rightFenceContactLength) {
    return b.rightFenceContactLength - a.rightFenceContactLength;
  }

  // Use fences as natural anchors after preserving packing efficiency.
  if (a.totalFenceContactLength !== b.totalFenceContactLength) {
    return b.totalFenceContactLength - a.totalFenceContactLength;
  }

  if (a.emptyFenceLength !== b.emptyFenceLength) {
    return a.emptyFenceLength - b.emptyFenceLength;
  }

  if (a.touchedFenceCount !== b.touchedFenceCount) {
    return b.touchedFenceCount - a.touchedFenceCount;
  }

  if (a.touchesAnyFence !== b.touchesAnyFence) {
    return a.touchesAnyFence ? -1 : 1;
  }

  if (a.sharedEdgeLength !== b.sharedEdgeLength) {
    return b.sharedEdgeLength - a.sharedEdgeLength;
  }

  if (a.boundingArea !== b.boundingArea) {
    return a.boundingArea - b.boundingArea;
  }

  if (a.totalFreeArea !== b.totalFreeArea) {
    return a.totalFreeArea - b.totalFreeArea;
  }

  if (a.totalPenalty !== b.totalPenalty) {
    return a.totalPenalty - b.totalPenalty;
  }

  return 0;
}

function filterFreeRegionsForRemaining(freeRegions: FreeRegion[], remainingPaintings: NormalizedPainting[]) {
  const minDimensions = normalizedPaintingsMinDimensions(remainingPaintings);
  return freeRegions.filter((region) => isRegionUseful(region, minDimensions));
}

export function isPlacementValid(
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

  const candidateEdges = toRectEdges(candidate.x, candidate.y, width, height);

  for (const existing of placements) {
    const existingEdges = toRectEdges(existing.x, existing.y, existing.width, existing.height);

    const horizontalGap =
      candidateEdges.left >= existingEdges.right + SPACING_INCHES || existingEdges.left >= candidateEdges.right + SPACING_INCHES;
    const verticalGap =
      candidateEdges.bottom >= existingEdges.top + SPACING_INCHES || existingEdges.bottom >= candidateEdges.top + SPACING_INCHES;

    if (!horizontalGap && !verticalGap) {
      return false;
    }
  }

  return true;
}

interface PlacementSearchResult {
  paintingIndex: number;
  placement: PlacedPainting;
  score: CandidateScore;
  freeRegions: FreeRegion[];
}

interface OrientationVariant {
  width: number;
  height: number;
  orientation: 'HORIZONTAL' | 'VERTICAL';
  rotated: boolean;
}

interface LegalPlacementOption {
  paintingIndex: number;
  painting: NormalizedPainting;
  variant: OrientationVariant;
  originalCandidate: Candidate;
  candidate: Candidate;
  snapAlignedAxisCount: number;
  snapDistanceMm: number;
  freeRegions: FreeRegion[];
}

interface ScoredPlacementOption extends LegalPlacementOption {
  score: CandidateScore;
  placement: PlacedPainting;
}

interface SearchRuntime {
  nodesVisited: number;
  visitedStates: Set<string>;
  maxNodes: number;
  deadlineMs: number;
}

interface SearchState {
  tables: TableState[];
  placements: PlacedPainting[];
  remainingPaintings: NormalizedPainting[];
}

interface SearchResult {
  tables: TableState[];
  placements: PlacedPainting[];
}

interface SearchStateQuality {
  tableCount: number;
  paintingsOnCurrentTable: number;
  currentTableFreeArea: number;
  currentTableLargestFreeRegionArea: number;
  currentTableOccupiedBoundingArea: number;
  currentTableFrontFenceContactLength: number;
  currentTableRightFenceContactLength: number;
  currentTableGrowthFromSample: number;
  sharedEdgeLength: number;
  isolatedPaintingCount: number;
  totalFenceContactLength: number;
  fragmentCount: number;
  unusableRegionCount: number;
  thinStripCount: number;
  isolatedPocketCount: number;
  futureFitCapacity: number;
  rowAlignmentPairs: number;
  columnAlignmentPairs: number;
}

export interface GapRegionAnalysis {
  region: FreeRegion;
  classification: GapClassification;
  area: number;
  width: number;
  height: number;
  perimeter: number;
  aspectRatio: number;
  touchesFrontFence: boolean;
  touchesRightFence: boolean;
  touchesOtherFence: boolean;
  enclosedByPaintings: boolean;
  smallestRemainingAreaFit: number | null;
  remainingFitCount: number;
  canFitSample: boolean;
}

export interface GapQualityScore {
  rewardLargeUsable: number;
  rewardContinuousSpace: number;
  rewardRemainingFit: number;
  rewardFenceUsable: number;
  rewardSampleFit: number;
  penaltyEnclosedPockets: number;
  penaltyNarrowStrips: number;
  penaltyUnusable: number;
  penaltyFragments: number;
  penaltyExcessPerimeter: number;
  penaltySmallIsolated: number;
  largestUsableRectangle: number;
  fragmentation: number;
  unusableSlivers: number;
  netGapScore: number;
}

export interface PrintTravelMetrics {
  maxBackY: number;
  areaWeightedY: number;
  estimatedYTransitions: number;
  estimatedXTravel: number;
  totalCost: number;
}

export interface CompleteLayoutScore {
  tableCount: number;
  paintingsByTable: number[];
  totalUtilization: number;
  totalPaintingArea: number;
  maximumOccupiedDepth: number;
  areaWeightedYCenter: number;
  frontFenceCoverageScore: number;
  rightFenceStackDepthCost: number;
  frontFenceTallPieceReward: number;
  printTravel: PrintTravelMetrics;
  gapQuality: GapQualityScore;
  occupiedBoundingArea: number;
  frontFenceContactLength: number;
  rightFenceContactLength: number;
  sharedEdgeLength: number;
  rowAlignmentPairs: number;
  columnAlignmentPairs: number;
}

interface RepairRegion {
  tableNumber: number;
  reason:
    | 'LARGE_GAP'
    | 'ENCLOSED_POCKET'
    | 'FLOATING'
    | 'NARROW_STRIP'
    | 'FRONT_EDGE'
    | 'RIGHT_EDGE'
    | 'TABLE_REDUCTION'
    | 'TRAVEL_DEPTH';
  region: FreeRegion;
}

export interface VerificationGapTableReport {
  tableNumber: number;
  gapRegions: GapRegionAnalysis[];
  gapScore: GapQualityScore;
  legalExtraSamplePositions: number;
}

function clonePainting(placement: PlacedPainting): PlacedPainting {
  return { ...placement };
}

function cloneRegion(region: FreeRegion): FreeRegion {
  return { ...region };
}

function cloneTable(table: TableState): TableState {
  return {
    tableNumber: table.tableNumber,
    paintings: table.paintings.map(clonePainting),
    freeRegions: table.freeRegions.map(cloneRegion),
  };
}

function cloneTables(tables: TableState[]): TableState[] {
  return tables.map(cloneTable);
}

function cloneSearchResult(result: SearchResult): SearchResult {
  return {
    tables: cloneTables(result.tables),
    placements: result.placements.map(clonePainting),
  };
}

function cloneSearchState(state: SearchState): SearchState {
  return {
    tables: cloneTables(state.tables),
    placements: state.placements.map(clonePainting),
    remainingPaintings: [...state.remainingPaintings],
  };
}

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }

  return Date.now();
}

function createSearchRuntime(maxNodes: number, deadlineMs: number): SearchRuntime {
  return {
    nodesVisited: 0,
    visitedStates: new Set<string>(),
    maxNodes,
    deadlineMs,
  };
}

function recordCandidateTrace(table: TableState, placement: PlacedPainting, score: CandidateScore) {
  if (!DEBUG_OVERLAY_ENABLED) {
    return;
  }

  activeCandidateTrace.push({
    tableNumber: table.tableNumber,
    paintingId: placement.id,
    referenceNumber: placement.referenceNumber,
    x: placement.x,
    y: placement.y,
    gapLeftoverArea: score.gapLeftoverArea,
    sharedEdgeLength: score.sharedEdgeLength,
    frontFenceContactLength: score.frontFenceContactLength,
    rightFenceContactLength: score.rightFenceContactLength,
    totalPenalty: score.totalPenalty,
  });

  if (activeCandidateTrace.length > 500) {
    activeCandidateTrace = activeCandidateTrace.slice(-500);
  }
}

export function isOptimizerDebugOverlayEnabled() {
  return DEBUG_OVERLAY_ENABLED;
}

export function getLastOptimizerDebugRunData() {
  return lastOptimizerDebugRunData;
}

export function getOptimizerDebugOverlay(layout: LayoutResult, referenceOrder: Painting[], tableNumber: number): OptimizerDebugOverlayData | null {
  if (!DEBUG_OVERLAY_ENABLED) {
    return null;
  }

  const fitPaintings = normalizePaintings(referenceOrder);
  const searchResult = toSearchResultWithFreeRegions(layout, fitPaintings);
  const targetTable =
    searchResult.tables.find((table) => table.tableNumber === tableNumber) ??
    searchResult.tables[0];

  if (!targetTable) {
    return null;
  }

  const gaps = analyzeFreeRegions(targetTable, fitPaintings);
  const finalScore = scoreCompleteLayout(searchResult, fitPaintings);
  const run = lastOptimizerDebugRunData
    ? {
        runId: lastOptimizerDebugRunData.runId,
        elapsedMs: lastOptimizerDebugRunData.elapsedMs,
        candidatesEvaluated: lastOptimizerDebugRunData.candidatesEvaluated,
        freeRegionsCreated: lastOptimizerDebugRunData.freeRegionsCreated,
        freeRegionsMerged: lastOptimizerDebugRunData.freeRegionsMerged,
      }
    : null;

  return {
    tableNumber: targetTable.tableNumber,
    tableWidthMm: TABLE_WIDTH_MM,
    tableHeightMm: TABLE_HEIGHT_MM,
    finalScore,
    freeRegions: gaps.map((gap) => ({ ...gap.region, classification: gap.classification })),
    candidateTrace: activeCandidateTrace.filter((entry) => entry.tableNumber === targetTable.tableNumber).slice(-12),
    run,
  };
}

function getMovablePlacements(result: SearchResult) {
  return result.placements.filter((placement) => placement.referenceNumber !== 'SAMPLE');
}

function placementArea(placement: PlacedPainting) {
  return placement.width * placement.height;
}

function getDeterministicSubsetIds(movable: PlacedPainting[], iteration: number, minCount: number, maxCount: number) {
  const ids = new Set<string>();
  if (movable.length === 0) {
    return ids;
  }

  const count = Math.min(movable.length, Math.max(minCount, Math.min(maxCount, minCount + (iteration % Math.max(1, maxCount - minCount + 1)))));
  const step = 2 * iteration + 1;
  for (let i = 0; i < count; i += 1) {
    const index = (iteration * 3 + i * step) % movable.length;
    ids.add(movable[index].id);
  }

  return ids;
}

function getLargestOccupiedTableIds(result: SearchResult) {
  let bestTableNumber: number | null = null;
  let bestArea = -1;

  for (const table of result.tables) {
    const area = getOccupiedBoundingAreaByTable(table);
    if (area > bestArea) {
      bestArea = area;
      bestTableNumber = table.tableNumber;
    }
  }

  const ids = new Set<string>();
  if (bestTableNumber === null) {
    return ids;
  }

  for (const placement of getMovablePlacements(result)) {
    if (placement.tableNumber === bestTableNumber) {
      ids.add(placement.id);
    }
  }

  return ids;
}

function getPostSolvePerturbationSets(result: SearchResult, iteration: number) {
  const movable = getMovablePlacements(result);
  if (movable.length === 0) {
    return [] as Array<Set<string>>;
  }

  const perturbations: Array<Set<string>> = [];

  // Always include full rebuild so each optimization pass can freely reorganize everything.
  perturbations.push(new Set(movable.map((placement) => placement.id)));

  // Add broad and medium subsets to keep exploration diverse between full rebuilds.
  perturbations.push(getDeterministicSubsetIds(movable, iteration + 5, Math.max(2, Math.floor(movable.length * 0.45)), Math.max(3, Math.floor(movable.length * 0.75))));
  perturbations.push(getDeterministicSubsetIds(movable, iteration + 11, Math.max(2, Math.floor(movable.length * 0.2)), Math.max(3, Math.floor(movable.length * 0.45))));
  perturbations.push(getDeterministicSubsetIds(movable, iteration, 1, 4));

  // Rebuild the largest occupied region from scratch.
  const largestRegionIds = getLargestOccupiedTableIds(result);
  if (largestRegionIds.size > 0) {
    perturbations.push(largestRegionIds);
  }

  return perturbations.filter((set) => set.size > 0);
}

function buildPostSolveState(
  baseResult: SearchResult,
  minDimensions: MinDimensions,
  removedIds: Set<string>
): SearchState {
  const tables = cloneTables(baseResult.tables);
  const placements = baseResult.placements
    .filter((placement) => !removedIds.has(placement.id))
    .map(clonePainting);
  const remainingPaintings: NormalizedPainting[] = [];

  for (const table of tables) {
    const removedFromTable = table.paintings.filter((painting) => removedIds.has(painting.id));
    if (removedFromTable.length > 0) {
      remainingPaintings.push(...removedFromTable.map(toNormalizedPaintingFromPlacement));
    }

    table.paintings = table.paintings.filter((painting) => !removedIds.has(painting.id));
    table.freeRegions = initializeFreeRegions(table.paintings, minDimensions);
  }

  for (const table of tables) {
    table.freeRegions = filterFreeRegionsForRemaining(table.freeRegions, remainingPaintings);
  }

  return {
    tables,
    placements,
    remainingPaintings,
  };
}

function buildPlacementsFromTables(tables: TableState[]) {
  return tables.flatMap((table) => table.paintings.map(clonePainting));
}

function createInitialSearchState(remainingPaintings: NormalizedPainting[], minDimensions: MinDimensions): SearchState {
  const firstTable = createInitialTableState(1, minDimensions);
  return {
    tables: [firstTable],
    placements: [firstTable.paintings[0]],
    remainingPaintings: [...remainingPaintings],
  };
}

function createDeterministicRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashPaintingsSeed(paintings: NormalizedPainting[]) {
  let hash = 2166136261;
  for (const painting of paintings) {
    const signature = `${painting.referenceNumber}|${painting.id}|${painting.normalizedWidth}|${painting.normalizedHeight}|${painting.orientation}`;
    for (let i = 0; i < signature.length; i += 1) {
      hash ^= signature.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  return hash >>> 0;
}

function deterministicShuffle<T>(items: T[], seed: number): T[] {
  const rng = createDeterministicRng(seed);
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = next[i];
    next[i] = next[j];
    next[j] = tmp;
  }
  return next;
}

function compareByReferenceNumber(a: NormalizedPainting, b: NormalizedPainting) {
  const aMatch = a.referenceNumber.match(/\d+/);
  const bMatch = b.referenceNumber.match(/\d+/);
  const aNum = aMatch ? Number(aMatch[0]) : Number.POSITIVE_INFINITY;
  const bNum = bMatch ? Number(bMatch[0]) : Number.POSITIVE_INFINITY;

  if (aNum !== bNum) {
    return aNum - bNum;
  }

  return a.referenceNumber.localeCompare(b.referenceNumber);
}

function getCandidateLayoutCount(paintingCount: number) {
  if (DETERMINISTIC_MODE) {
    return DETERMINISTIC_CANDIDATE_LAYOUT_COUNT;
  }

  if (paintingCount <= 100) {
    return BASE_CANDIDATE_LAYOUT_COUNT;
  }

  if (paintingCount <= 140) {
    return 24;
  }

  if (paintingCount <= 180) {
    return 18;
  }

  return MIN_CANDIDATE_LAYOUT_COUNT;
}

function generateInitialOrders(sortedPaintings: NormalizedPainting[]) {
  const uniqueOrders: NormalizedPainting[][] = [];
  const seen = new Set<string>();

  const addOrder = (items: NormalizedPainting[]) => {
    const key = items.map((painting) => painting.id).join('|');
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    uniqueOrders.push(items);
  };

  const byAreaDesc = [...sortedPaintings].sort((a, b) => {
    const delta = b.normalizedWidth * b.normalizedHeight - a.normalizedWidth * a.normalizedHeight;
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });
  const byLongestSideDesc = [...sortedPaintings].sort((a, b) => {
    const delta = Math.max(b.normalizedWidth, b.normalizedHeight) - Math.max(a.normalizedWidth, a.normalizedHeight);
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });
  const byTallestDesc = [...sortedPaintings].sort((a, b) => {
    const delta = b.normalizedHeight - a.normalizedHeight;
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });
  const byWidestDesc = [...sortedPaintings].sort((a, b) => {
    const delta = b.normalizedWidth - a.normalizedWidth;
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });
  const byAspectDesc = [...sortedPaintings].sort((a, b) => {
    const aAspect = Math.max(a.normalizedWidth, a.normalizedHeight) / Math.max(0.0001, Math.min(a.normalizedWidth, a.normalizedHeight));
    const bAspect = Math.max(b.normalizedWidth, b.normalizedHeight) / Math.max(0.0001, Math.min(b.normalizedWidth, b.normalizedHeight));
    const delta = bAspect - aAspect;
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });
  const byAspectAsc = [...sortedPaintings].sort((a, b) => {
    const aAspect = Math.max(a.normalizedWidth, a.normalizedHeight) / Math.max(0.0001, Math.min(a.normalizedWidth, a.normalizedHeight));
    const bAspect = Math.max(b.normalizedWidth, b.normalizedHeight) / Math.max(0.0001, Math.min(b.normalizedWidth, b.normalizedHeight));
    const delta = aAspect - bAspect;
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });
  const byAreaAsc = [...sortedPaintings].sort((a, b) => {
    const delta = a.normalizedWidth * a.normalizedHeight - b.normalizedWidth * b.normalizedHeight;
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });
  const byReferenceOrder = [...sortedPaintings].sort(compareByReferenceNumber);

  addOrder([...sortedPaintings]);
  addOrder(byAreaDesc);
  addOrder(byLongestSideDesc);
  addOrder(byTallestDesc);
  addOrder(byWidestDesc);
  addOrder(byAspectDesc);
  addOrder(byAspectAsc);
  addOrder(byAreaAsc);
  addOrder(byReferenceOrder);

  const targetCount = Math.max(
    MIN_CANDIDATE_LAYOUT_COUNT,
    Math.min(MAX_CANDIDATE_LAYOUT_COUNT, getCandidateLayoutCount(sortedPaintings.length))
  );

  const baseSeed = hashPaintingsSeed(sortedPaintings);
  let shuffleIndex = 0;
  while (uniqueOrders.length < targetCount) {
    const seed = (baseSeed + shuffleIndex * 7919) >>> 0;
    addOrder(deterministicShuffle(sortedPaintings, seed));
    shuffleIndex += 1;
    if (shuffleIndex > 256) {
      break;
    }
  }

  return uniqueOrders;
}

function solveSearchState(
  initialState: SearchState,
  minDimensions: MinDimensions,
  debug: DebugCounters
): SearchResult | null {
  const runtime = createSearchRuntime(SEARCH_MAX_NODES, Number.POSITIVE_INFINITY);
  const layout = attemptLayout(initialState, minDimensions, debug, runtime, false, 0);
  if (!layout) {
    return null;
  }

  const compacted = compactSearchResult(layout, minDimensions);
  return postSolveOptimize(compacted, minDimensions, debug);
}

function isValidPlacementInTable(table: TableState, placement: PlacedPainting, x: number, y: number) {
  const others = table.paintings.filter((item) => item.id !== placement.id);
  return isPlacementValid({ x, y }, placement.width, placement.height, others);
}

function slidePlacementToRightFence(table: TableState, placement: PlacedPainting) {
  const width = placement.width;
  const height = placement.height;
  const left = toLeftOriginX(placement.x, width);
  let maxLeft = TABLE_WIDTH_INCHES - width;

  for (const obstacle of table.paintings) {
    if (obstacle.id === placement.id) {
      continue;
    }

    const obstacleLeft = toLeftOriginX(obstacle.x, obstacle.width);
    const verticalGap =
      placement.y >= obstacle.y + obstacle.height + SPACING_INCHES ||
      obstacle.y >= placement.y + height + SPACING_INCHES;

    if (verticalGap) {
      continue;
    }

    if (left + width + SPACING_INCHES <= obstacleLeft) {
      maxLeft = Math.min(maxLeft, obstacleLeft - SPACING_INCHES - width);
    }
  }

  const nextLeft = Math.max(left, maxLeft);
  const nextX = TABLE_WIDTH_INCHES - (nextLeft + width);
  return { x: Math.max(0, nextX), y: placement.y };
}

function slidePlacementToFrontFence(table: TableState, placement: PlacedPainting) {
  const width = placement.width;
  let minY = 0;
  const left = toLeftOriginX(placement.x, width);
  const right = left + width;

  for (const obstacle of table.paintings) {
    if (obstacle.id === placement.id) {
      continue;
    }

    const obstacleLeft = toLeftOriginX(obstacle.x, obstacle.width);
    const obstacleRight = obstacleLeft + obstacle.width;
    const horizontalGap = left >= obstacleRight + SPACING_INCHES || obstacleLeft >= right + SPACING_INCHES;

    if (horizontalGap) {
      continue;
    }

    if (obstacle.y + obstacle.height + SPACING_INCHES <= placement.y) {
      minY = Math.max(minY, obstacle.y + obstacle.height + SPACING_INCHES);
    }
  }

  return { x: placement.x, y: Math.min(placement.y, minY) };
}

function compactTableToFences(table: TableState, minDimensions: MinDimensions) {
  const movableIds = table.paintings.filter((painting) => painting.referenceNumber !== 'SAMPLE').map((painting) => painting.id);
  if (movableIds.length === 0) {
    table.freeRegions = initializeFreeRegions(table.paintings, minDimensions);
    return;
  }

  const COORDINATE_EPSILON = 1e-9;
  const hasMovement = (a: number, b: number) => Math.abs(a - b) > COORDINATE_EPSILON;

  let changed = true;
  let guardIterations = 0;
  while (changed && guardIterations < 1200) {
    guardIterations += 1;
    changed = false;

    for (const id of movableIds) {
      const index = table.paintings.findIndex((painting) => painting.id === id);
      if (index === -1) {
        continue;
      }

      // Gravity phase 1: pull toward FRONT fence (physical bottom edge).
      const current = table.paintings[index];
      const frontSlide = slidePlacementToFrontFence(table, current);
      if ((hasMovement(frontSlide.x, current.x) || hasMovement(frontSlide.y, current.y)) && isValidPlacementInTable(table, current, frontSlide.x, frontSlide.y)) {
        table.paintings[index] = { ...current, x: frontSlide.x, y: frontSlide.y };
        changed = true;
      }

      // Gravity phase 2: pull toward RIGHT fence after front compaction.
      const afterFront = table.paintings[index];
      const rightSlide = slidePlacementToRightFence(table, afterFront);
      if ((hasMovement(rightSlide.x, afterFront.x) || hasMovement(rightSlide.y, afterFront.y)) && isValidPlacementInTable(table, afterFront, rightSlide.x, rightSlide.y)) {
        table.paintings[index] = { ...afterFront, x: rightSlide.x, y: rightSlide.y };
        changed = true;
      }
    }
  }

  table.freeRegions = initializeFreeRegions(table.paintings, minDimensions);
}

function compactSearchResult(result: SearchResult, minDimensions: MinDimensions): SearchResult {
  const tables = cloneTables(result.tables);

  for (const table of tables) {
    compactTableToFences(table, minDimensions);
  }

  return {
    tables,
    placements: buildPlacementsFromTables(tables),
  };
}

function getTableMovableMaxDepth(table: TableState) {
  return getTablePaintingsWithoutSample(table).reduce((maxDepth, placement) => {
    return Math.max(maxDepth, placement.y + placement.height);
  }, 0);
}

function isFrontFenceCoordinate(y: number) {
  return Math.abs(toMillimeters(y)) <= FENCE_EPSILON_MM;
}

function isRightFenceCoordinate(x: number) {
  return Math.abs(toMillimeters(x)) <= FENCE_EPSILON_MM;
}

function buildBoundedFenceSnapCandidates(value: number) {
  const valueMm = toMillimeters(value);
  const baseMm = Math.round(valueMm / COORDINATE_SNAP_MM) * COORDINATE_SNAP_MM;
  const candidatesMm = [baseMm, baseMm - 5, baseMm + 5, baseMm - 10, baseMm + 10];
  const unique = new Map<string, number>();

  for (const candidateMm of candidatesMm) {
    unique.set(candidateMm.toFixed(6), toInches(candidateMm));
  }

  return Array.from(unique.values());
}

function explainPlacementRejection(
  x: number,
  y: number,
  width: number,
  height: number,
  others: PlacedPainting[]
) {
  if (x < -SNAP_COMPARE_EPSILON || y < -SNAP_COMPARE_EPSILON) {
    return 'negative-coordinate';
  }
  if (x + width > TABLE_WIDTH_INCHES + SNAP_COMPARE_EPSILON || y + height > TABLE_HEIGHT_INCHES + SNAP_COMPARE_EPSILON) {
    return 'out-of-bounds';
  }

  const candidateEdges = toRectEdges(x, y, width, height);
  for (const other of others) {
    const otherEdges = toRectEdges(other.x, other.y, other.width, other.height);
    const xOverlap = Math.max(0, Math.min(candidateEdges.right, otherEdges.right) - Math.max(candidateEdges.left, otherEdges.left));
    const yOverlap = Math.max(0, Math.min(candidateEdges.top, otherEdges.top) - Math.max(candidateEdges.bottom, otherEdges.bottom));

    if (xOverlap > SNAP_COMPARE_EPSILON && yOverlap > SNAP_COMPARE_EPSILON) {
      return `overlap:${other.referenceNumber}`;
    }

    if (yOverlap > SNAP_COMPARE_EPSILON) {
      const horizontalGap =
        candidateEdges.right <= otherEdges.left
          ? otherEdges.left - candidateEdges.right
          : candidateEdges.left >= otherEdges.right
            ? candidateEdges.left - otherEdges.right
            : 0;
      if (horizontalGap + SNAP_COMPARE_EPSILON < SPACING_INCHES) {
        return `spacing-x:${other.referenceNumber}`;
      }
    }

    if (xOverlap > SNAP_COMPARE_EPSILON) {
      const verticalGap =
        candidateEdges.top <= otherEdges.bottom
          ? otherEdges.bottom - candidateEdges.top
          : candidateEdges.bottom >= otherEdges.top
            ? candidateEdges.bottom - otherEdges.top
            : 0;
      if (verticalGap + SNAP_COMPARE_EPSILON < SPACING_INCHES) {
        return `spacing-y:${other.referenceNumber}`;
      }
    }
  }

  return 'invalid-placement';
}

function shouldLogFenceSnapDiagnostics(placement: PlacedPainting, beforeX: number, beforeY: number) {
  if (!FENCE_SNAP_DIAGNOSTICS_ENABLED) {
    return false;
  }

  if (!isFrontFenceCoordinate(beforeY)) {
    return false;
  }

  const beforeXmm = toMillimeters(beforeX);
  return FENCE_SNAP_DIAGNOSTIC_TARGETS_MM.some((target) => Math.abs(beforeXmm - target) <= 0.25);
}

function snapUpToFiveMm(valueMm: number) {
  return Math.ceil(valueMm / COORDINATE_SNAP_MM) * COORDINATE_SNAP_MM;
}

function snapFenceAxis(
  axis: 'x' | 'y',
  placement: PlacedPainting,
  others: PlacedPainting[]
) {
  const original = axis === 'x' ? placement.x : placement.y;
  const candidates = buildBoundedFenceSnapCandidates(original);
  const tested: Array<{ candidateMm: number; valid: boolean; reason?: string }> = [];
  let chosen = original;

  for (const candidate of candidates) {
    const candidatePlacement =
      axis === 'x'
        ? { x: candidate, y: placement.y }
        : { x: placement.x, y: candidate };

    const valid = isPlacementValid(candidatePlacement, placement.width, placement.height, others);
    if (valid) {
      tested.push({ candidateMm: toMillimeters(candidate), valid: true });
      chosen = candidate;
      break;
    }

    tested.push({
      candidateMm: toMillimeters(candidate),
      valid: false,
      reason: explainPlacementRejection(candidatePlacement.x, candidatePlacement.y, placement.width, placement.height, others),
    });
  }

  return {
    chosen,
    tested,
  };
}

function buildFenceAxisCandidatesWithFallback(value: number) {
  const snapped = buildBoundedFenceSnapCandidates(value).sort((a, b) => Math.abs(a - value) - Math.abs(b - value));
  const unique = new Map<string, number>();
  for (const candidate of snapped) {
    unique.set(toMillimeters(candidate).toFixed(6), candidate);
  }

  const originalKey = toMillimeters(value).toFixed(6);
  if (!unique.has(originalKey)) {
    unique.set(originalKey, value);
  }

  return Array.from(unique.values());
}

function snapTableMovablePlacementCoordinates(table: TableState) {
  const movableOrder = getTablePaintingsWithoutSample(table)
    .filter((placement) => !isExtraSamplePlacement(placement))
    .sort((a, b) => {
      if (a.y !== b.y) {
        return a.y - b.y;
      }
      if (a.x !== b.x) {
        return a.x - b.x;
      }
      return a.id.localeCompare(b.id);
    });

  const movableIds = movableOrder.map((placement) => placement.id);

  // Normalize near-fence coordinates to exact fence lines first.
  for (const movableId of movableIds) {
    const index = table.paintings.findIndex((item) => item.id === movableId);
    if (index < 0) {
      continue;
    }

    const placement = table.paintings[index];
    const onFront = isFrontFenceCoordinate(placement.y);
    const onRight = isRightFenceCoordinate(placement.x);

    table.paintings[index] = {
      ...placement,
      x: onRight ? 0 : placement.x,
      y: onFront ? 0 : placement.y,
    };
  }

  // Front fence row: snap X on 5 mm grid while keeping at least 25.4 mm clearance.
  const frontFenceIds = movableIds.filter((id) => {
    const placement = table.paintings.find((item) => item.id === id);
    return placement ? isFrontFenceCoordinate(placement.y) && !isRightFenceCoordinate(placement.x) : false;
  });

  frontFenceIds.sort((a, b) => {
    const pa = table.paintings.find((item) => item.id === a);
    const pb = table.paintings.find((item) => item.id === b);
    if (!pa || !pb) {
      return 0;
    }
    if (pa.x !== pb.x) {
      return pa.x - pb.x;
    }
    return pa.id.localeCompare(pb.id);
  });

  let minNextFrontX = SAMPLE_WIDTH_INCHES + SPACING_INCHES;
  const frontFenceIdSet = new Set(frontFenceIds);
  const processedFrontFenceIds = new Set<string>();
  for (const movableId of frontFenceIds) {
    const index = table.paintings.findIndex((item) => item.id === movableId);
    if (index < 0) {
      continue;
    }

    const placement = table.paintings[index];
    const beforeX = placement.x;
    const beforeY = placement.y;
    const others = table.paintings.filter((item) => {
      if (item.id === placement.id) {
        return false;
      }

      // Ignore unprocessed front-fence neighbors because they are repacked later in this pass.
      if (frontFenceIdSet.has(item.id) && !processedFrontFenceIds.has(item.id)) {
        return false;
      }

      return true;
    });
    const tested: Array<{ candidateMm: number; valid: boolean; reason?: string }> = [];

    const startMm = snapUpToFiveMm(toMillimeters(minNextFrontX));
    const maxMm = TABLE_WIDTH_MM - toMillimeters(placement.width);
    let chosenX = placement.x;
    let found = false;

    for (let candidateMm = startMm; candidateMm <= maxMm + 1e-6; candidateMm += COORDINATE_SNAP_MM) {
      const candidateX = toInches(candidateMm);
      const valid = isPlacementValid({ x: candidateX, y: 0 }, placement.width, placement.height, others);
      if (valid) {
        tested.push({ candidateMm, valid: true });
        chosenX = candidateX;
        found = true;
        break;
      }

      tested.push({
        candidateMm,
        valid: false,
        reason: explainPlacementRejection(candidateX, 0, placement.width, placement.height, others),
      });
    }

    if (!found) {
      chosenX = placement.x;
    }

    table.paintings[index] = {
      ...placement,
      x: chosenX,
      y: 0,
    };

    processedFrontFenceIds.add(movableId);

    minNextFrontX = chosenX + placement.width + SPACING_INCHES;

    if (shouldLogFenceSnapDiagnostics(table.paintings[index], beforeX, beforeY)) {
      console.log('fence-snap-diagnostics', {
        table: table.paintings[index].tableNumber,
        reference: table.paintings[index].referenceNumber,
        beforeFinalSnap: {
          xMm: Number(toMillimeters(beforeX).toFixed(3)),
          yMm: Number(toMillimeters(beforeY).toFixed(3)),
        },
        candidateChecks: [
          {
            axis: 'x',
            tested,
            chosenMm: Number(toMillimeters(chosenX).toFixed(3)),
          },
        ],
        chosen: {
          xMm: Number(toMillimeters(chosenX).toFixed(3)),
          yMm: 0,
        },
        afterPostProcessing: {
          xMm: Number(toMillimeters(table.paintings[index].x).toFixed(3)),
          yMm: Number(toMillimeters(table.paintings[index].y).toFixed(3)),
        },
      });
    }
  }

  // Right fence column: snap Y on 5 mm grid while keeping at least 25.4 mm clearance.
  const rightFenceIds = movableIds.filter((id) => {
    const placement = table.paintings.find((item) => item.id === id);
    return placement ? isRightFenceCoordinate(placement.x) && !isFrontFenceCoordinate(placement.y) : false;
  });

  rightFenceIds.sort((a, b) => {
    const pa = table.paintings.find((item) => item.id === a);
    const pb = table.paintings.find((item) => item.id === b);
    if (!pa || !pb) {
      return 0;
    }
    if (pa.y !== pb.y) {
      return pa.y - pb.y;
    }
    return pa.id.localeCompare(pb.id);
  });

  let minNextRightY = SAMPLE_HEIGHT_INCHES + SPACING_INCHES;
  const rightFenceIdSet = new Set(rightFenceIds);
  const processedRightFenceIds = new Set<string>();
  for (const movableId of rightFenceIds) {
    const index = table.paintings.findIndex((item) => item.id === movableId);
    if (index < 0) {
      continue;
    }

    const placement = table.paintings[index];
    const others = table.paintings.filter((item) => {
      if (item.id === placement.id) {
        return false;
      }

      // Ignore unprocessed right-fence neighbors because they are repacked later in this pass.
      if (rightFenceIdSet.has(item.id) && !processedRightFenceIds.has(item.id)) {
        return false;
      }

      return true;
    });
    const startMm = snapUpToFiveMm(toMillimeters(minNextRightY));
    const maxMm = TABLE_HEIGHT_MM - toMillimeters(placement.height);
    let chosenY = placement.y;

    for (let candidateMm = startMm; candidateMm <= maxMm + 1e-6; candidateMm += COORDINATE_SNAP_MM) {
      const candidateY = toInches(candidateMm);
      const valid = isPlacementValid({ x: 0, y: candidateY }, placement.width, placement.height, others);
      if (valid) {
        chosenY = candidateY;
        break;
      }
    }

    table.paintings[index] = {
      ...placement,
      x: 0,
      y: chosenY,
    };

    processedRightFenceIds.add(movableId);

    minNextRightY = chosenY + placement.height + SPACING_INCHES;
  }
}

function applyCoordinateSnapping(result: SearchResult, minDimensions: MinDimensions): SearchResult {
  void minDimensions;
  return result;
}

export function getTablePaintingsWithoutSample(table: TableState) {
  return table.paintings.filter((placement) => !isFixedSamplePlacement(placement) && !isExtraSamplePlacement(placement));
}

function arePaintingsAdjacent(a: PlacedPainting, b: PlacedPainting) {
  const aEdges = toRectEdges(a.x, a.y, a.width, a.height);
  const bEdges = toRectEdges(b.x, b.y, b.width, b.height);
  const verticalOverlap = Math.max(0, Math.min(aEdges.top, bEdges.top) - Math.max(aEdges.bottom, bEdges.bottom));
  const horizontalOverlap = Math.max(0, Math.min(aEdges.right, bEdges.right) - Math.max(aEdges.left, bEdges.left));

  const sideAdjacency = (aEdges.left === bEdges.right + SPACING_INCHES || aEdges.right + SPACING_INCHES === bEdges.left) && verticalOverlap > 0;
  const verticalAdjacency = (aEdges.bottom === bEdges.top + SPACING_INCHES || aEdges.top + SPACING_INCHES === bEdges.bottom) && horizontalOverlap > 0;

  return sideAdjacency || verticalAdjacency;
}

function getTableClusterCount(table: TableState) {
  const movable = getTablePaintingsWithoutSample(table);
  if (movable.length === 0) {
    return 0;
  }

  const visited = new Set<string>();
  let clusters = 0;

  for (const start of movable) {
    if (visited.has(start.id)) {
      continue;
    }

    clusters += 1;
    const queue: PlacedPainting[] = [start];
    visited.add(start.id);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      for (const neighbor of movable) {
        if (visited.has(neighbor.id) || neighbor.id === current.id) {
          continue;
        }

        if (!arePaintingsAdjacent(current, neighbor)) {
          continue;
        }

        visited.add(neighbor.id);
        queue.push(neighbor);
      }
    }
  }

  return clusters;
}

function getPlacementSupportCount(table: TableState, target: PlacedPainting) {
  const edges = toRectEdges(target.x, target.y, target.width, target.height);
  let supportCount = 0;

  if (edges.bottom === 0) {
    supportCount += 1;
  }
  if (edges.left === 0) {
    supportCount += 1;
  }
  if (edges.top === TABLE_HEIGHT_INCHES) {
    supportCount += 1;
  }
  if (edges.right === TABLE_WIDTH_INCHES) {
    supportCount += 1;
  }

  for (const placement of getTablePaintingsWithoutSample(table)) {
    if (placement.id === target.id) {
      continue;
    }

    if (arePaintingsAdjacent(target, placement)) {
      supportCount += 1;
    }
  }

  return supportCount;
}

function canSlideTowardAnotherPainting(table: TableState, placement: PlacedPainting) {
  const others = getTablePaintingsWithoutSample(table).filter((item) => item.id !== placement.id);
  const candidateEdges = toRectEdges(placement.x, placement.y, placement.width, placement.height);

  for (const other of others) {
    const otherEdges = toRectEdges(other.x, other.y, other.width, other.height);
    const verticalOverlap = Math.max(0, Math.min(candidateEdges.top, otherEdges.top) - Math.max(candidateEdges.bottom, otherEdges.bottom));
    const horizontalOverlap = Math.max(0, Math.min(candidateEdges.right, otherEdges.right) - Math.max(candidateEdges.left, otherEdges.left));

    if (verticalOverlap > 0) {
      const moveLeftTarget = otherEdges.left - SPACING_INCHES - placement.width;
      if (moveLeftTarget > toLeftOriginX(placement.x, placement.width)) {
        const x = TABLE_WIDTH_INCHES - (moveLeftTarget + placement.width);
        if (isValidPlacementInTable(table, placement, x, placement.y)) {
          return true;
        }
      }

      const moveRightTarget = otherEdges.right + SPACING_INCHES;
      if (moveRightTarget < toLeftOriginX(placement.x, placement.width)) {
        const x = TABLE_WIDTH_INCHES - (moveRightTarget + placement.width);
        if (isValidPlacementInTable(table, placement, x, placement.y)) {
          return true;
        }
      }
    }

    if (horizontalOverlap > 0) {
      const moveFrontTarget = otherEdges.top + SPACING_INCHES;
      if (moveFrontTarget < placement.y) {
        if (isValidPlacementInTable(table, placement, placement.x, moveFrontTarget)) {
          return true;
        }
      }

      const moveBackTarget = otherEdges.bottom - SPACING_INCHES - placement.height;
      if (moveBackTarget > placement.y) {
        if (isValidPlacementInTable(table, placement, placement.x, moveBackTarget)) {
          return true;
        }
      }
    }
  }

  return false;
}

function isFloatingPainting(table: TableState, placement: PlacedPainting) {
  const frontSlide = slidePlacementToFrontFence(table, placement);
  if (frontSlide.y < placement.y && isValidPlacementInTable(table, placement, frontSlide.x, frontSlide.y)) {
    return true;
  }

  const rightSlide = slidePlacementToRightFence(table, placement);
  if (rightSlide.x < placement.x && isValidPlacementInTable(table, placement, rightSlide.x, rightSlide.y)) {
    return true;
  }

  return canSlideTowardAnotherPainting(table, placement);
}

function getSmallPaintingGapFillCount(tables: TableState[]) {
  const movable = tables.flatMap((table) => getTablePaintingsWithoutSample(table));
  if (movable.length === 0) {
    return 0;
  }

  const sortedAreas = movable.map((placement) => placementArea(placement)).sort((a, b) => a - b);
  const thresholdIndex = Math.floor((sortedAreas.length - 1) * 0.35);
  const smallAreaThreshold = sortedAreas[thresholdIndex];
  let count = 0;

  for (const table of tables) {
    for (const placement of getTablePaintingsWithoutSample(table)) {
      if (placementArea(placement) > smallAreaThreshold) {
        continue;
      }

      if (getPlacementSupportCount(table, placement) >= 2) {
        count += 1;
      }
    }
  }

  return count;
}

function getDistinctBands(intervals: Array<{ start: number; end: number }>, gapTolerance: number) {
  if (intervals.length === 0) {
    return [] as Array<{ start: number; end: number }>;
  }

  const sorted = [...intervals].sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start;
    }
    return a.end - b.end;
  });

  const bands: Array<{ start: number; end: number }> = [sorted[0]];

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    const last = bands[bands.length - 1];
    if (current.start <= last.end + gapTolerance) {
      last.end = Math.max(last.end, current.end);
      continue;
    }

    bands.push({ start: current.start, end: current.end });
  }

  return bands;
}

function calculatePrintTravelMetrics(tables: TableState[], weights: PrintTravelWeights): PrintTravelMetrics {
  const movableByTable = tables.map((table) => getTablePaintingsWithoutSample(table));
  const movable = movableByTable.flatMap((paintings) => paintings);

  if (movable.length === 0) {
    return {
      maxBackY: 0,
      areaWeightedY: 0,
      estimatedYTransitions: 0,
      estimatedXTravel: 0,
      totalCost: 0,
    };
  }

  let maxBackY = 0;
  let areaSum = 0;
  let weightedYSum = 0;
  let estimatedYTransitions = 0;
  let estimatedXTravel = 0;

  for (let tableIndex = 0; tableIndex < tables.length; tableIndex += 1) {
    const table = tables[tableIndex];
    const tableMovable = movableByTable[tableIndex];
    if (tableMovable.length === 0) {
      continue;
    }

    const yIntervals = tableMovable.map((placement) => ({
      start: placement.y,
      end: placement.y + placement.height,
    }));
    const xIntervals = tableMovable.map((placement) => ({
      start: placement.x,
      end: placement.x + placement.width,
    }));

    const yBands = getDistinctBands(yIntervals, SPACING_INCHES * 0.5);
    const xBands = getDistinctBands(xIntervals, SPACING_INCHES * 0.5);

    const frontBandStart = yBands[0]?.start ?? 0;
    const frontGapPenalty = Math.max(0, frontBandStart - (SAMPLE_HEIGHT_INCHES + SPACING_INCHES));
    const yBandTransitions = Math.max(0, yBands.length - 1);
    estimatedYTransitions += yBandTransitions + frontGapPenalty / Math.max(0.5, SPACING_INCHES);

    const xSpread = xBands.reduce((acc, band) => acc + Math.max(0, band.end - band.start), 0);
    const xBandSwitching = Math.max(0, xBands.length - 1);
    estimatedXTravel += xSpread + xBandSwitching * SPACING_INCHES;

    for (const placement of tableMovable) {
      const area = placement.width * placement.height;
      const centerY = placement.y + placement.height / 2;
      const backY = placement.y + placement.height;
      maxBackY = Math.max(maxBackY, backY);
      areaSum += area;
      weightedYSum += area * centerY;
    }
  }

  const areaWeightedY = areaSum > 0 ? weightedYSum / areaSum : 0;
  const totalCost =
    maxBackY * weights.yTravelWeight * weights.yDepthWeight +
    areaWeightedY * weights.yTravelWeight * weights.yCenterWeight +
    estimatedYTransitions * weights.yTravelWeight * weights.yTransitionWeight +
    estimatedXTravel * weights.xTravelWeight;

  return {
    maxBackY,
    areaWeightedY,
    estimatedYTransitions,
    estimatedXTravel,
    totalCost,
  };
}

export function calculatePrintTravelCost(placements: PlacedPainting[], weights?: Partial<PrintTravelWeights>) {
  const mergedWeights: PrintTravelWeights = {
    yTravelWeight: weights?.yTravelWeight ?? PRINT_TRAVEL_WEIGHTS.yTravelWeight,
    xTravelWeight: weights?.xTravelWeight ?? PRINT_TRAVEL_WEIGHTS.xTravelWeight,
    yDepthWeight: weights?.yDepthWeight ?? PRINT_TRAVEL_WEIGHTS.yDepthWeight,
    yCenterWeight: weights?.yCenterWeight ?? PRINT_TRAVEL_WEIGHTS.yCenterWeight,
    yTransitionWeight: weights?.yTransitionWeight ?? PRINT_TRAVEL_WEIGHTS.yTransitionWeight,
  };

  const tablesByNumber = new Map<number, TableState>();
  for (const placement of placements) {
    const existing = tablesByNumber.get(placement.tableNumber);
    if (existing) {
      existing.paintings.push(placement);
      continue;
    }

    tablesByNumber.set(placement.tableNumber, {
      tableNumber: placement.tableNumber,
      paintings: [placement],
      freeRegions: [],
    });
  }

  const tables = Array.from(tablesByNumber.values()).sort((a, b) => a.tableNumber - b.tableNumber);
  return calculatePrintTravelMetrics(tables, mergedWeights);
}

export function scoreCompleteLayout(result: SearchResult, fitPaintings: NormalizedPainting[]): CompleteLayoutScore {
  const tableArea = TABLE_WIDTH_INCHES * TABLE_HEIGHT_INCHES;
  const movableByTable = result.tables.map((table) => getTablePaintingsWithoutSample(table).length);
  let occupiedArea = 0;
  let occupiedBoundingArea = 0;
  let frontFenceContactLength = 0;
  let rightFenceContactLength = 0;
  let rightFenceStackDepthCost = 0;
  let frontFenceTallPieceReward = 0;
  let sharedEdgeLength = 0;
  let rowAlignmentPairs = 0;
  let columnAlignmentPairs = 0;
  let gapQualityAccum: GapQualityScore = {
    rewardLargeUsable: 0,
    rewardContinuousSpace: 0,
    rewardRemainingFit: 0,
    rewardFenceUsable: 0,
    rewardSampleFit: 0,
    penaltyEnclosedPockets: 0,
    penaltyNarrowStrips: 0,
    penaltyUnusable: 0,
    penaltyFragments: 0,
    penaltyExcessPerimeter: 0,
    penaltySmallIsolated: 0,
    largestUsableRectangle: 0,
    fragmentation: 0,
    unusableSlivers: 0,
    netGapScore: 0,
  };

  for (const table of result.tables) {
    const movable = getTablePaintingsWithoutSample(table);
    occupiedArea += movable.reduce((sum, placement) => sum + placementArea(placement), 0);
    occupiedBoundingArea += getOccupiedBoundingAreaByTable(table);

    const adjacency = getTableAdjacencyMetrics(table);
    frontFenceContactLength += adjacency.frontFenceContactLength;
    rightFenceContactLength += adjacency.rightFenceContactLength;
    rightFenceStackDepthCost += adjacency.rightFenceStackDepthCost;
    frontFenceTallPieceReward += adjacency.frontFenceTallPieceReward;
    sharedEdgeLength += adjacency.sharedEdgeLength;

    const alignmentPairs = getTableAlignmentPairCounts(table);
    rowAlignmentPairs += alignmentPairs.rowPairs;
    columnAlignmentPairs += alignmentPairs.columnPairs;

    const gapAnalysis = analyzeFreeRegions(table, fitPaintings);
    const gapScore = scoreGapQuality(gapAnalysis);
    gapQualityAccum = {
      rewardLargeUsable: gapQualityAccum.rewardLargeUsable + gapScore.rewardLargeUsable,
      rewardContinuousSpace: gapQualityAccum.rewardContinuousSpace + gapScore.rewardContinuousSpace,
      rewardRemainingFit: gapQualityAccum.rewardRemainingFit + gapScore.rewardRemainingFit,
      rewardFenceUsable: gapQualityAccum.rewardFenceUsable + gapScore.rewardFenceUsable,
      rewardSampleFit: gapQualityAccum.rewardSampleFit + gapScore.rewardSampleFit,
      penaltyEnclosedPockets: gapQualityAccum.penaltyEnclosedPockets + gapScore.penaltyEnclosedPockets,
      penaltyNarrowStrips: gapQualityAccum.penaltyNarrowStrips + gapScore.penaltyNarrowStrips,
      penaltyUnusable: gapQualityAccum.penaltyUnusable + gapScore.penaltyUnusable,
      penaltyFragments: gapQualityAccum.penaltyFragments + gapScore.penaltyFragments,
      penaltyExcessPerimeter: gapQualityAccum.penaltyExcessPerimeter + gapScore.penaltyExcessPerimeter,
      penaltySmallIsolated: gapQualityAccum.penaltySmallIsolated + gapScore.penaltySmallIsolated,
      largestUsableRectangle: Math.max(gapQualityAccum.largestUsableRectangle, gapScore.largestUsableRectangle),
      fragmentation: gapQualityAccum.fragmentation + gapScore.fragmentation,
      unusableSlivers: gapQualityAccum.unusableSlivers + gapScore.unusableSlivers,
      netGapScore: gapQualityAccum.netGapScore + gapScore.netGapScore,
    };
  }

  const totalArea = result.tables.length * tableArea;
  const totalUtilization = totalArea > 0 ? occupiedArea / totalArea : 0;
  const printTravel = calculatePrintTravelMetrics(result.tables, PRINT_TRAVEL_WEIGHTS);
  const frontFenceCoverageScore =
    result.tables.length > 0
      ? frontFenceContactLength / (result.tables.length * TABLE_WIDTH_INCHES)
      : 0;

  return {
    tableCount: result.tables.length,
    paintingsByTable: movableByTable,
    totalUtilization,
    totalPaintingArea: occupiedArea,
    maximumOccupiedDepth: printTravel.maxBackY,
    areaWeightedYCenter: printTravel.areaWeightedY,
    frontFenceCoverageScore,
    rightFenceStackDepthCost,
    frontFenceTallPieceReward,
    printTravel,
    gapQuality: gapQualityAccum,
    occupiedBoundingArea,
    frontFenceContactLength,
    rightFenceContactLength,
    sharedEdgeLength,
    rowAlignmentPairs,
    columnAlignmentPairs,
  };
}

function comparePaintingsByEarlierTables(a: number[], b: number[]) {
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) {
      return bv - av;
    }
  }
  return 0;
}

function compareCompleteLayoutScore(a: CompleteLayoutScore, b: CompleteLayoutScore) {
  // 1) Fewest tables used.
  if (a.tableCount !== b.tableCount) {
    return a.tableCount - b.tableCount;
  }

  // 2) Lowest occupied depth.
  if (a.maximumOccupiedDepth !== b.maximumOccupiedDepth) {
    return a.maximumOccupiedDepth - b.maximumOccupiedDepth;
  }

  // 3) Lowest area-weighted Y center.
  if (a.areaWeightedYCenter !== b.areaWeightedYCenter) {
    return a.areaWeightedYCenter - b.areaWeightedYCenter;
  }

  // 4) Highest front-fence coverage.
  if (a.frontFenceCoverageScore !== b.frontFenceCoverageScore) {
    return b.frontFenceCoverageScore - a.frontFenceCoverageScore;
  }

  // 5) Lowest right-fence stack depth cost.
  if (a.rightFenceStackDepthCost !== b.rightFenceStackDepthCost) {
    return a.rightFenceStackDepthCost - b.rightFenceStackDepthCost;
  }

  // 6) Lower print-travel cost (Y weighted more heavily than X).
  const printTravelDelta = a.printTravel.totalCost - b.printTravel.totalCost;
  if (Math.abs(printTravelDelta) > PRINT_TRAVEL_TIE_EPSILON) {
    return printTravelDelta;
  }

  // 7) Best gap-quality score.
  if (a.gapQuality.netGapScore !== b.gapQuality.netGapScore) {
    return b.gapQuality.netGapScore - a.gapQuality.netGapScore;
  }

  // 8) Lowest fragmentation.
  if (a.gapQuality.fragmentation !== b.gapQuality.fragmentation) {
    return a.gapQuality.fragmentation - b.gapQuality.fragmentation;
  }

  // Front-fence tall-piece preference remains a depth-focused tie-break.
  if (a.frontFenceTallPieceReward !== b.frontFenceTallPieceReward) {
    return b.frontFenceTallPieceReward - a.frontFenceTallPieceReward;
  }

  // 8) Alignment tie-breakers.
  if (a.sharedEdgeLength !== b.sharedEdgeLength) {
    return b.sharedEdgeLength - a.sharedEdgeLength;
  }

  if (a.rowAlignmentPairs !== b.rowAlignmentPairs) {
    return b.rowAlignmentPairs - a.rowAlignmentPairs;
  }

  if (a.columnAlignmentPairs !== b.columnAlignmentPairs) {
    return b.columnAlignmentPairs - a.columnAlignmentPairs;
  }

  // Secondary compactness and fence tie-breakers after depth-aware priorities.
  const earlyTableComparison = comparePaintingsByEarlierTables(a.paintingsByTable, b.paintingsByTable);
  if (earlyTableComparison !== 0) {
    return earlyTableComparison;
  }

  if (a.totalUtilization !== b.totalUtilization) {
    return b.totalUtilization - a.totalUtilization;
  }

  if (a.totalPaintingArea !== b.totalPaintingArea) {
    return b.totalPaintingArea - a.totalPaintingArea;
  }

  if (a.occupiedBoundingArea !== b.occupiedBoundingArea) {
    return a.occupiedBoundingArea - b.occupiedBoundingArea;
  }

  if (a.gapQuality.largestUsableRectangle !== b.gapQuality.largestUsableRectangle) {
    return b.gapQuality.largestUsableRectangle - a.gapQuality.largestUsableRectangle;
  }

  if (a.gapQuality.unusableSlivers !== b.gapQuality.unusableSlivers) {
    return a.gapQuality.unusableSlivers - b.gapQuality.unusableSlivers;
  }

  if (a.frontFenceContactLength !== b.frontFenceContactLength) {
    return b.frontFenceContactLength - a.frontFenceContactLength;
  }

  if (a.rightFenceContactLength !== b.rightFenceContactLength) {
    return b.rightFenceContactLength - a.rightFenceContactLength;
  }

  return 0;
}

function getOccupiedBoundingAreaByTable(table: TableState) {
  const movable = getTablePaintingsWithoutSample(table);
  if (movable.length === 0) {
    return 0;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const placement of movable) {
    const left = toLeftOriginX(placement.x, placement.width);
    minX = Math.min(minX, left);
    minY = Math.min(minY, placement.y);
    maxX = Math.max(maxX, left + placement.width);
    maxY = Math.max(maxY, placement.y + placement.height);
  }

  return (maxX - minX) * (maxY - minY);
}

function getTableAlignmentPairCounts(table: TableState) {
  const movable = getTablePaintingsWithoutSample(table);
  let rowPairs = 0;
  let columnPairs = 0;

  for (let i = 0; i < movable.length; i += 1) {
    for (let j = i + 1; j < movable.length; j += 1) {
      const a = toRectEdges(movable[i].x, movable[i].y, movable[i].width, movable[i].height);
      const b = toRectEdges(movable[j].x, movable[j].y, movable[j].width, movable[j].height);

      if (a.left === b.left || a.right === b.right) {
        columnPairs += 1;
      }

      if (a.bottom === b.bottom || a.top === b.top) {
        rowPairs += 1;
      }
    }
  }

  return { rowPairs, columnPairs };
}

function getTableAdjacencyMetrics(table: TableState) {
  const movable = getTablePaintingsWithoutSample(table);
  const sample = table.paintings.find((placement) => isFixedSamplePlacement(placement));
  const sampleTop = sample ? sample.y + sample.height : 0;
  let sharedEdgeLength = 0;
  let isolatedPaintingCount = 0;
  let frontFenceContactLength = 0;
  let rightFenceContactLength = 0;
  let rightFenceStackDepthCost = 0;
  let frontFenceTallPieceReward = 0;
  let furthestLeftReachFromRight = 0;
  let furthestBackReachFromFront = 0;

  for (const placement of movable) {
    if (placement.x === 0) {
      rightFenceContactLength += placement.height;
    }
    if (placement.y === 0) {
      frontFenceContactLength += placement.width;
      frontFenceTallPieceReward += placement.height;
    }

    if (
      sample !== undefined &&
      placement.x === 0 &&
      placement.y >= sampleTop + SPACING_INCHES - 1e-6
    ) {
      rightFenceStackDepthCost += placement.height * RIGHT_FENCE_Y_WEIGHT;
    }

    furthestLeftReachFromRight = Math.max(furthestLeftReachFromRight, placement.x + placement.width);
    furthestBackReachFromFront = Math.max(furthestBackReachFromFront, placement.y + placement.height);
  }

  for (let i = 0; i < movable.length; i += 1) {
    const a = toRectEdges(movable[i].x, movable[i].y, movable[i].width, movable[i].height);
    let hasNeighbor = false;

    for (let j = 0; j < movable.length; j += 1) {
      if (i === j) {
        continue;
      }

      const b = toRectEdges(movable[j].x, movable[j].y, movable[j].width, movable[j].height);
      const verticalOverlap = Math.max(0, Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom));
      const horizontalOverlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));

      const sideAdjacency = (a.left === b.right + SPACING_INCHES || a.right + SPACING_INCHES === b.left) && verticalOverlap > 0;
      const verticalAdjacency = (a.bottom === b.top + SPACING_INCHES || a.top + SPACING_INCHES === b.bottom) && horizontalOverlap > 0;

      if (sideAdjacency || verticalAdjacency) {
        hasNeighbor = true;
      }
    }

    if (!hasNeighbor) {
      isolatedPaintingCount += 1;
    }
  }

  for (let i = 0; i < movable.length; i += 1) {
    for (let j = i + 1; j < movable.length; j += 1) {
      const a = toRectEdges(movable[i].x, movable[i].y, movable[i].width, movable[i].height);
      const b = toRectEdges(movable[j].x, movable[j].y, movable[j].width, movable[j].height);

      const verticalOverlap = Math.max(0, Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom));
      const horizontalOverlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));

      const sideAdjacency = (a.left === b.right + SPACING_INCHES || a.right + SPACING_INCHES === b.left) && verticalOverlap > 0;
      const verticalAdjacency = (a.bottom === b.top + SPACING_INCHES || a.top + SPACING_INCHES === b.bottom) && horizontalOverlap > 0;

      if (sideAdjacency) {
        sharedEdgeLength += verticalOverlap;
      }
      if (verticalAdjacency) {
        sharedEdgeLength += horizontalOverlap;
      }
    }
  }

  return {
    sharedEdgeLength,
    isolatedPaintingCount,
    frontFenceContactLength,
    rightFenceContactLength,
    rightFenceStackDepthCost,
    frontFenceTallPieceReward,
    growthFromSample: furthestLeftReachFromRight + furthestBackReachFromFront,
  };
}

function getTableMaxOccupiedY(table: TableState) {
  return getTablePaintingsWithoutSample(table).reduce((maxY, placement) => {
    return Math.max(maxY, placement.y + placement.height);
  }, 0);
}

function tryDepthAwareRightFenceSwapOnTable(table: TableState, minDimensions: MinDimensions) {
  const sample = table.paintings.find((placement) => isFixedSamplePlacement(placement));
  if (!sample) {
    return false;
  }

  const movable = getTablePaintingsWithoutSample(table);
  if (movable.length < 2) {
    return false;
  }

  const sampleTop = sample.y + sample.height;
  const rightStack = movable.filter((placement) => placement.x === 0 && placement.y >= sampleTop + SPACING_INCHES - 1e-6);
  const frontRow = movable.filter((placement) => placement.y === 0);

  if (rightStack.length === 0 || frontRow.length === 0) {
    return false;
  }

  const currentMaxY = getTableMaxOccupiedY(table);
  let bestPaintings: PlacedPainting[] | null = null;
  let bestMaxY = currentMaxY;

  for (const rightPlacement of rightStack) {
    for (const frontPlacement of frontRow) {
      if (rightPlacement.id === frontPlacement.id) {
        continue;
      }

      if (frontPlacement.height >= rightPlacement.height) {
        continue;
      }

      const staticPlacements = table.paintings.filter(
        (placement) => placement.id !== rightPlacement.id && placement.id !== frontPlacement.id
      );

      const nextFrontAtRight: PlacedPainting = {
        ...frontPlacement,
        tableNumber: table.tableNumber,
        x: rightPlacement.x,
        y: rightPlacement.y,
      };

      if (!isPlacementValid({ x: nextFrontAtRight.x, y: nextFrontAtRight.y }, nextFrontAtRight.width, nextFrontAtRight.height, staticPlacements)) {
        continue;
      }

      const placementsWithFront = [...staticPlacements, nextFrontAtRight];
      const placementTable: TableState = {
        tableNumber: table.tableNumber,
        paintings: placementsWithFront,
        freeRegions: [],
      };
      const frontCandidates = getCandidatePositions(placementTable, rightPlacement.width, rightPlacement.height)
        .filter((candidate) => candidate.y === 0)
        .filter((candidate) =>
          isPlacementValid(candidate, rightPlacement.width, rightPlacement.height, placementsWithFront)
        );

      for (const frontCandidate of frontCandidates) {
        const nextRightAtFront: PlacedPainting = {
          ...rightPlacement,
          tableNumber: table.tableNumber,
          x: frontCandidate.x,
          y: 0,
        };

        const swappedPaintings = table.paintings.map((placement) => {
          if (placement.id === frontPlacement.id) {
            return nextFrontAtRight;
          }
          if (placement.id === rightPlacement.id) {
            return nextRightAtFront;
          }
          return placement;
        });

        const swappedTable: TableState = {
          tableNumber: table.tableNumber,
          paintings: swappedPaintings,
          freeRegions: [],
        };
        const swappedMaxY = getTableMaxOccupiedY(swappedTable);
        if (swappedMaxY + 1e-6 < bestMaxY) {
          bestMaxY = swappedMaxY;
          bestPaintings = swappedPaintings;
        }
      }
    }
  }

  if (!bestPaintings) {
    return false;
  }

  table.paintings = bestPaintings;
  table.freeRegions = initializeFreeRegions(table.paintings, minDimensions);
  return true;
}

function applyDepthAwareRightFenceSwapRepair(baseResult: SearchResult, minDimensions: MinDimensions): SearchResult | null {
  const tables = cloneTables(baseResult.tables);
  let changed = false;

  for (const table of tables) {
    if (tryDepthAwareRightFenceSwapOnTable(table, minDimensions)) {
      changed = true;
    }
  }

  if (!changed) {
    return null;
  }

  return {
    tables,
    placements: buildPlacementsFromTables(tables),
  };
}
function evaluateSearchStateQuality(state: SearchState): SearchStateQuality {
  const currentTable = state.tables[state.tables.length - 1];
  const currentTableMovableCount = getTablePaintingsWithoutSample(currentTable).length;

  let currentTableFreeArea = 0;
  let currentTableLargestFreeRegionArea = 0;
  let currentTableOccupiedBoundingArea = 0;
  let currentTableFrontFenceContactLength = 0;
  let currentTableRightFenceContactLength = 0;
  let currentTableGrowthFromSample = 0;
  let sharedEdgeLength = 0;
  let isolatedPaintingCount = 0;
  let totalFenceContactLength = 0;
  let fragmentCount = 0;
  let unusableRegionCount = 0;
  let thinStripCount = 0;
  let isolatedPocketCount = 0;
  let futureFitCapacity = 0;
  let rowAlignmentPairs = 0;
  let columnAlignmentPairs = 0;

  for (const table of state.tables) {
    const tableMetrics = getFreeRegionMetrics(table.freeRegions, state.remainingPaintings);
    fragmentCount += tableMetrics.fragmentCount;
    unusableRegionCount += tableMetrics.unusableRegionCount;
    thinStripCount += tableMetrics.thinStripCount;
    isolatedPocketCount += tableMetrics.isolatedPocketCount;
    futureFitCapacity += tableMetrics.futureFitCapacity;

    const alignmentPairs = getTableAlignmentPairCounts(table);
    rowAlignmentPairs += alignmentPairs.rowPairs;
    columnAlignmentPairs += alignmentPairs.columnPairs;

    const perimeter = getPerimeterMetricsForPlacements(table.paintings);
    totalFenceContactLength += perimeter.totalFenceContactLength;

    if (table.tableNumber === currentTable.tableNumber) {
      for (const region of table.freeRegions) {
        const area = region.width * region.height;
        currentTableFreeArea += area;
        currentTableLargestFreeRegionArea = Math.max(currentTableLargestFreeRegionArea, area);
      }

      currentTableOccupiedBoundingArea = getOccupiedBoundingAreaByTable(table);
      const adjacency = getTableAdjacencyMetrics(table);
      sharedEdgeLength += adjacency.sharedEdgeLength;
      isolatedPaintingCount += adjacency.isolatedPaintingCount;
      currentTableFrontFenceContactLength += adjacency.frontFenceContactLength;
      currentTableRightFenceContactLength += adjacency.rightFenceContactLength;
      currentTableGrowthFromSample += adjacency.growthFromSample;
    }
  }

  return {
    tableCount: state.tables.length,
    paintingsOnCurrentTable: currentTableMovableCount,
    currentTableFreeArea,
    currentTableLargestFreeRegionArea,
    currentTableOccupiedBoundingArea,
    currentTableFrontFenceContactLength,
    currentTableRightFenceContactLength,
    currentTableGrowthFromSample,
    sharedEdgeLength,
    isolatedPaintingCount,
    totalFenceContactLength,
    fragmentCount,
    unusableRegionCount,
    thinStripCount,
    isolatedPocketCount,
    futureFitCapacity,
    rowAlignmentPairs,
    columnAlignmentPairs,
  };
}

function compareSearchStateQuality(a: SearchStateQuality, b: SearchStateQuality) {
  if (a.tableCount !== b.tableCount) {
    return a.tableCount - b.tableCount;
  }

  // 1) Keep as many paintings as possible on the active table.
  if (a.paintingsOnCurrentTable !== b.paintingsOnCurrentTable) {
    return b.paintingsOnCurrentTable - a.paintingsOnCurrentTable;
  }

  // 2) Minimize wasted space on the active table.
  if (a.currentTableFreeArea !== b.currentTableFreeArea) {
    return a.currentTableFreeArea - b.currentTableFreeArea;
  }

  if (a.currentTableLargestFreeRegionArea !== b.currentTableLargestFreeRegionArea) {
    return a.currentTableLargestFreeRegionArea - b.currentTableLargestFreeRegionArea;
  }

  // 3) Maximize packing density.
  if (a.currentTableOccupiedBoundingArea !== b.currentTableOccupiedBoundingArea) {
    return a.currentTableOccupiedBoundingArea - b.currentTableOccupiedBoundingArea;
  }

  // 4) Maximize FRONT fence usage (physical bottom edge, operator side).
  if (a.currentTableFrontFenceContactLength !== b.currentTableFrontFenceContactLength) {
    return b.currentTableFrontFenceContactLength - a.currentTableFrontFenceContactLength;
  }

  // 5) Maximize RIGHT fence usage.
  if (a.currentTableRightFenceContactLength !== b.currentTableRightFenceContactLength) {
    return b.currentTableRightFenceContactLength - a.currentTableRightFenceContactLength;
  }

  // 6) Grow away from the sample (front-right origin) while staying dense.
  if (a.currentTableGrowthFromSample !== b.currentTableGrowthFromSample) {
    return b.currentTableGrowthFromSample - a.currentTableGrowthFromSample;
  }

  // 7) Reward long shared edges for human-like grouping.
  if (a.sharedEdgeLength !== b.sharedEdgeLength) {
    return b.sharedEdgeLength - a.sharedEdgeLength;
  }

  // 8) Penalize isolated paintings.
  if (a.isolatedPaintingCount !== b.isolatedPaintingCount) {
    return a.isolatedPaintingCount - b.isolatedPaintingCount;
  }

  // 9) Penalize fragmented and unusable empty regions.
  if (a.fragmentCount !== b.fragmentCount) {
    return a.fragmentCount - b.fragmentCount;
  }

  if (a.isolatedPocketCount !== b.isolatedPocketCount) {
    return a.isolatedPocketCount - b.isolatedPocketCount;
  }

  if (a.unusableRegionCount !== b.unusableRegionCount) {
    return a.unusableRegionCount - b.unusableRegionCount;
  }

  if (a.thinStripCount !== b.thinStripCount) {
    return a.thinStripCount - b.thinStripCount;
  }

  // Secondary global tie-breakers.
  if (a.futureFitCapacity !== b.futureFitCapacity) {
    return b.futureFitCapacity - a.futureFitCapacity;
  }

  if (a.totalFenceContactLength !== b.totalFenceContactLength) {
    return b.totalFenceContactLength - a.totalFenceContactLength;
  }

  return 0;
}

function getSearchStateSignature(state: SearchState, allowOrientationFlip: boolean): string {
  const tableSignature = state.tables
    .map((table) => {
      const placementSignature = table.paintings
        .map((placement) => `${placement.id}:${placement.tableNumber}:${placement.x}:${placement.y}:${placement.width}:${placement.height}`)
        .join(',');

      return `T${table.tableNumber}[${placementSignature}]`;
    })
    .join('|');

  const remainingSignature = state.remainingPaintings
    .map((painting) => `${painting.id}:${painting.normalizedWidth}:${painting.normalizedHeight}:${painting.orientation}`)
    .join(',');

  return `${allowOrientationFlip ? 'flip' : 'locked'}::${tableSignature}::R[${remainingSignature}]`;
}

function toNormalizedPaintingFromPlacement(placement: PlacedPainting): NormalizedPainting {
  const orientation: 'HORI' | 'VERT' = placement.orientation === 'HORIZONTAL' ? 'HORI' : 'VERT';
  const baseWidth = orientation === 'HORI' ? placement.height : placement.width;
  const baseHeight = orientation === 'HORI' ? placement.width : placement.height;

  return {
    id: placement.id,
    referenceNumber: placement.referenceNumber,
    name: placement.name,
    width: baseWidth,
    height: baseHeight,
    orientation,
    color: placement.color,
    normalizedWidth: placement.width,
    normalizedHeight: placement.height,
  };
}

function getOrientationVariants(painting: NormalizedPainting, allowOrientationFlip: boolean): OrientationVariant[] {
  const baseOrientation: 'HORIZONTAL' | 'VERTICAL' = painting.orientation === 'HORI' ? 'HORIZONTAL' : 'VERTICAL';

  // Keep operator-selected orientation fixed for all candidates and repairs.
  const variants: OrientationVariant[] = [
    {
      width: painting.normalizedWidth,
      height: painting.normalizedHeight,
      orientation: baseOrientation,
      rotated: baseOrientation === 'HORIZONTAL',
    },
  ];

  return variants;
}

function collectLegalPlacementsOnCurrentTable(
  table: TableState,
  remainingPaintings: NormalizedPainting[],
  debug: DebugCounters,
  allowOrientationFlip: boolean
): LegalPlacementOption[] {
  const legalPlacements: LegalPlacementOption[] = [];

  for (let index = 0; index < remainingPaintings.length; index += 1) {
    const painting = remainingPaintings[index];
    const orientationVariants = getOrientationVariants(painting, allowOrientationFlip);

    for (const variant of orientationVariants) {
      const candidates = getCandidatePositions(table, variant.width, variant.height);

      for (const candidate of candidates) {
        if (!fitsWithinAnyFreeRegion(candidate, variant.width, variant.height, table.freeRegions)) {
          continue;
        }

        if (!isPlacementValid(candidate, variant.width, variant.height, table.paintings)) {
          continue;
        }

        const snapped = resolveSnappedCandidate(table, candidate, variant.width, variant.height);
        const freeRegions = simulatePlacementFreeRegions(table, snapped.candidate, variant.width, variant.height, debug);
        debug.candidatesEvaluated += 1;

        legalPlacements.push({
          paintingIndex: index,
          painting,
          variant,
          originalCandidate: candidate,
          candidate: snapped.candidate,
          snapAlignedAxisCount: snapped.snapAlignedAxisCount,
          snapDistanceMm: snapped.snapDistanceMm,
          freeRegions,
        });
      }
    }
  }

  return legalPlacements;
}

function scoreLegalPlacement(
  table: TableState,
  option: LegalPlacementOption,
  remainingPaintings: NormalizedPainting[],
  hasFrontRowPlacement: boolean
): ScoredPlacementOption {
  const remainingAfterPlacement = remainingPaintings.filter((_, index) => index !== option.paintingIndex);
  const frontRowPenalty = hasFrontRowPlacement && option.candidate.y > 0 ? 1 : 0;
  const score = scoreCandidate(
    option.candidate,
    option.variant.width,
    option.variant.height,
    table,
    option.freeRegions,
    remainingAfterPlacement,
    frontRowPenalty,
    option.snapAlignedAxisCount,
    option.snapDistanceMm
  );

  return {
    ...option,
    score,
    placement: {
      id: option.painting.id,
      referenceNumber: option.painting.referenceNumber,
      name: option.painting.name,
      width: option.variant.width,
      height: option.variant.height,
      orientation: option.variant.orientation,
      rotated: option.variant.rotated,
      tableNumber: table.tableNumber,
      x: option.candidate.x,
      y: option.candidate.y,
      color: option.painting.color,
    },
  };
}

function findBestPlacementOnCurrentTable(
  table: TableState,
  remainingPaintings: NormalizedPainting[],
  debug: DebugCounters,
  allowOrientationFlip: boolean
): PlacementSearchResult | null {
  const legalPlacements = collectLegalPlacementsOnCurrentTable(table, remainingPaintings, debug, allowOrientationFlip);

  if (legalPlacements.length === 0) {
    return null;
  }

  const hasFrontRowPlacement = legalPlacements.some((option) => option.candidate.y === 0);
  const scoredPlacements = legalPlacements.map((option) =>
    scoreLegalPlacement(table, option, remainingPaintings, hasFrontRowPlacement)
  );

  const bestPlacement = scoredPlacements.reduce<ScoredPlacementOption | null>((best, option) => {
    if (!best) {
      return option;
    }

    const scoreComparison = compareCandidateScores(option.score, best.score);
    if (scoreComparison < 0) {
      return option;
    }

    if (scoreComparison > 0) {
      return best;
    }

    // Deterministic tie-break that avoids size or iteration-order bias.
    const optionKey = `${option.painting.referenceNumber}|${option.painting.id}`;
    const bestKey = `${best.painting.referenceNumber}|${best.painting.id}`;
    if (optionKey < bestKey) {
      return option;
    }

    return best;
  }, null);

  if (!bestPlacement) {
    return null;
  }

  recordCandidateTrace(table, bestPlacement.placement, bestPlacement.score);

  return {
    paintingIndex: bestPlacement.paintingIndex,
    placement: bestPlacement.placement,
    score: bestPlacement.score,
    freeRegions: bestPlacement.freeRegions,
  };
}

function getTotalFreeArea(tables: TableState[]) {
  return tables.reduce(
    (acc, table) => acc + table.freeRegions.reduce((inner, region) => inner + region.width * region.height, 0),
    0
  );
}

function compareSearchResults(a: SearchResult, b: SearchResult) {
  const aReferencePaintings = getMovablePlacements(a).map(toNormalizedPaintingFromPlacement);
  const bReferencePaintings = getMovablePlacements(b).map(toNormalizedPaintingFromPlacement);

  const aQuality = scoreCompleteLayout(a, aReferencePaintings);
  const bQuality = scoreCompleteLayout(b, bReferencePaintings);
  const qualityComparison = compareCompleteLayoutScore(aQuality, bQuality);
  if (qualityComparison !== 0) {
    return qualityComparison;
  }

  const aPlacementKey = a.placements
    .filter((placement) => placement.referenceNumber !== 'SAMPLE')
    .map((placement) => `${placement.referenceNumber}:${placement.tableNumber}:${placement.x}:${placement.y}`)
    .join('|');
  const bPlacementKey = b.placements
    .filter((placement) => placement.referenceNumber !== 'SAMPLE')
    .map((placement) => `${placement.referenceNumber}:${placement.tableNumber}:${placement.x}:${placement.y}`)
    .join('|');
  if (aPlacementKey < bPlacementKey) {
    return -1;
  }
  if (aPlacementKey > bPlacementKey) {
    return 1;
  }

  return 0;
}

function completeLayoutGreedy(
  state: SearchState,
  minDimensions: MinDimensions,
  debug: DebugCounters,
  allowOrientationFlip: boolean
): SearchResult {
  const tables = cloneTables(state.tables);
  const placements = state.placements.map(clonePainting);
  const remainingPaintings = [...state.remainingPaintings];

  while (remainingPaintings.length > 0) {
    const currentTable = tables[tables.length - 1];
    currentTable.freeRegions = filterFreeRegionsForRemaining(currentTable.freeRegions, remainingPaintings);
    const bestPlacement = findBestPlacementOnCurrentTable(currentTable, remainingPaintings, debug, allowOrientationFlip);

    if (bestPlacement?.placement) {
      const placement = bestPlacement.placement;
      currentTable.paintings.push(placement);
      currentTable.freeRegions = bestPlacement.freeRegions;

      placements.push(placement);
      remainingPaintings.splice(bestPlacement.paintingIndex, 1);
      if (remainingPaintings.length > 0) {
        currentTable.freeRegions = filterFreeRegionsForRemaining(currentTable.freeRegions, remainingPaintings);
      }
      continue;
    }

    const newTable = createInitialTableState(tables.length + 1, minDimensions);
    tables.push(newTable);
    placements.push(newTable.paintings[0]);
  }

  return { tables, placements };
}

function getMoveCombinations(movablePaintings: PlacedPainting[], moveCount: number): PlacedPainting[][] {
  if (moveCount <= 0) {
    return [];
  }

  if (moveCount === 1) {
    return movablePaintings.slice(0, REPACK_COMBINATION_LIMIT).map((painting) => [painting]);
  }

  if (moveCount === 2) {
    const combinations: PlacedPainting[][] = [];
    for (let i = 0; i < movablePaintings.length; i += 1) {
      for (let j = i + 1; j < movablePaintings.length; j += 1) {
        combinations.push([movablePaintings[i], movablePaintings[j]]);
        if (combinations.length >= REPACK_COMBINATION_LIMIT) {
          return combinations;
        }
      }
    }
    return combinations;
  }

  return [];
}

function tryRepackCurrentTable(
  state: SearchState,
  minDimensions: MinDimensions,
  debug: DebugCounters,
  runtime: SearchRuntime,
  moveCount: number,
  allowOrientationFlip: boolean,
  depth: number
): SearchResult | null {
  const currentTable = state.tables[state.tables.length - 1];
  const movablePaintings = currentTable.paintings.filter((painting) => painting.referenceNumber !== 'SAMPLE');

  if (movablePaintings.length < moveCount) {
    return null;
  }

  const combinations = getMoveCombinations(movablePaintings, moveCount);
  let bestResult: SearchResult | null = null;

  for (const combination of combinations) {
    const nextState = cloneSearchState(state);
    const nextTable = nextState.tables[nextState.tables.length - 1];
    const movedIds = new Set(combination.map((painting) => painting.id));

    const movedPlacements = nextTable.paintings.filter((painting) => movedIds.has(painting.id));
    nextTable.paintings = nextTable.paintings.filter((painting) => !movedIds.has(painting.id));
    nextTable.freeRegions = initializeFreeRegions(nextTable.paintings, minDimensions);
    nextState.placements = nextState.placements.filter(
      (placement) => !(placement.tableNumber === nextTable.tableNumber && movedIds.has(placement.id))
    );

    nextState.remainingPaintings.push(...movedPlacements.map(toNormalizedPaintingFromPlacement));
    nextTable.freeRegions = filterFreeRegionsForRemaining(nextTable.freeRegions, nextState.remainingPaintings);

    const repackResult = attemptLayout(nextState, minDimensions, debug, runtime, allowOrientationFlip, depth + 1);
    if (!repackResult) {
      continue;
    }

    if (!bestResult || compareSearchResults(repackResult, bestResult) < 0) {
      bestResult = repackResult;
    }
  }

  return bestResult;
}

function attemptLayout(
  state: SearchState,
  minDimensions: MinDimensions,
  debug: DebugCounters,
  runtime: SearchRuntime,
  allowOrientationFlip: boolean,
  depth: number
): SearchResult | null {
  if (state.remainingPaintings.length === 0) {
    return {
      tables: cloneTables(state.tables),
      placements: state.placements.map(clonePainting),
    };
  }

  runtime.nodesVisited += 1;
  if (runtime.nodesVisited >= runtime.maxNodes || nowMs() >= runtime.deadlineMs) {
    return completeLayoutGreedy(state, minDimensions, debug, allowOrientationFlip);
  }

  if (depth >= SEARCH_MAX_DEPTH) {
    return completeLayoutGreedy(state, minDimensions, debug, allowOrientationFlip);
  }

  const stateSignature = getSearchStateSignature(state, allowOrientationFlip);
  if (runtime.visitedStates.has(stateSignature)) {
    return completeLayoutGreedy(state, minDimensions, debug, allowOrientationFlip);
  }
  runtime.visitedStates.add(stateSignature);

  const baseState = cloneSearchState(state);
  const currentTable = baseState.tables[baseState.tables.length - 1];
  currentTable.freeRegions = filterFreeRegionsForRemaining(currentTable.freeRegions, baseState.remainingPaintings);

  const legalPlacements = collectLegalPlacementsOnCurrentTable(
    currentTable,
    baseState.remainingPaintings,
    debug,
    allowOrientationFlip
  );

  if (legalPlacements.length === 0) {
    if (!allowOrientationFlip) {
      const moveOneResult = tryRepackCurrentTable(baseState, minDimensions, debug, runtime, 1, false, depth);
      if (moveOneResult) {
        return moveOneResult;
      }

      const moveTwoResult = tryRepackCurrentTable(baseState, minDimensions, debug, runtime, 2, false, depth);
      if (moveTwoResult) {
        return moveTwoResult;
      }

      const orientationRetryResult = attemptLayout(baseState, minDimensions, debug, runtime, true, depth + 1);
      if (orientationRetryResult) {
        return orientationRetryResult;
      }
    }

    const newTable = createInitialTableState(baseState.tables.length + 1, minDimensions);
    newTable.freeRegions = filterFreeRegionsForRemaining(newTable.freeRegions, baseState.remainingPaintings);
    baseState.tables.push(newTable);
    baseState.placements.push(newTable.paintings[0]);
    return attemptLayout(baseState, minDimensions, debug, runtime, allowOrientationFlip, depth + 1);
  }

  const hasFrontRowPlacement = legalPlacements.some((option) => option.candidate.y === 0);
  const scoredPlacements = legalPlacements
    .map((option) => scoreLegalPlacement(currentTable, option, baseState.remainingPaintings, hasFrontRowPlacement))
    .sort((a, b) => compareCandidateScores(a.score, b.score));

  const rankedPlacements = scoredPlacements
    .map((placementOption) => {
      const previewState = cloneSearchState(baseState);
      const previewTable = previewState.tables[previewState.tables.length - 1];

      previewTable.paintings.push(clonePainting(placementOption.placement));
      previewTable.freeRegions = placementOption.freeRegions.map(cloneRegion);
      previewState.placements.push(clonePainting(placementOption.placement));
      previewState.remainingPaintings.splice(placementOption.paintingIndex, 1);

      if (previewState.remainingPaintings.length > 0) {
        previewTable.freeRegions = filterFreeRegionsForRemaining(previewTable.freeRegions, previewState.remainingPaintings);
      }

      return {
        placementOption,
        quality: evaluateSearchStateQuality(previewState),
      };
    })
    .sort((a, b) => {
      const qualityComparison = compareSearchStateQuality(a.quality, b.quality);
      if (qualityComparison !== 0) {
        return qualityComparison;
      }

      return compareCandidateScores(a.placementOption.score, b.placementOption.score);
    });

  const topPlacements = rankedPlacements
    .slice(0, Math.min(SEARCH_BRANCH_WIDTH, rankedPlacements.length))
    .map((entry) => entry.placementOption);
  let bestResult: SearchResult | null = null;

  for (const placementOption of topPlacements) {
    const nextState = cloneSearchState(baseState);
    const nextTable = nextState.tables[nextState.tables.length - 1];

    nextTable.paintings.push(clonePainting(placementOption.placement));
    nextTable.freeRegions = placementOption.freeRegions.map(cloneRegion);
    nextState.placements.push(clonePainting(placementOption.placement));
    nextState.remainingPaintings.splice(placementOption.paintingIndex, 1);

    if (nextState.remainingPaintings.length > 0) {
      nextTable.freeRegions = filterFreeRegionsForRemaining(nextTable.freeRegions, nextState.remainingPaintings);
    }

    const candidateResult = attemptLayout(nextState, minDimensions, debug, runtime, allowOrientationFlip, depth + 1);
    if (!candidateResult) {
      continue;
    }

    if (!bestResult || compareSearchResults(candidateResult, bestResult) < 0) {
      bestResult = candidateResult;
    }
  }

  if (!bestResult) {
    return completeLayoutGreedy(baseState, minDimensions, debug, allowOrientationFlip);
  }

  return bestResult;
}

function postSolveOptimize(
  initialResult: SearchResult,
  minDimensions: MinDimensions,
  debug: DebugCounters
): SearchResult {
  let currentResult = compactSearchResult(cloneSearchResult(initialResult), minDimensions);
  let bestResult = cloneSearchResult(currentResult);

  const deadlineMs = TIME_BUDGETS_ENABLED ? nowMs() + POST_SOLVE_MAX_MS : Number.POSITIVE_INFINITY;
  let stallCount = 0;

  for (let iteration = 0; iteration < POST_SOLVE_MAX_ITERATIONS; iteration += 1) {
    if (nowMs() >= deadlineMs || stallCount >= POST_SOLVE_STALL_LIMIT) {
      break;
    }

    const perturbationSets = getPostSolvePerturbationSets(currentResult, iteration);
    if (perturbationSets.length === 0) {
      break;
    }

    let bestCandidateInIteration: SearchResult | null = null;

    for (const removedIds of perturbationSets) {
      if (nowMs() >= deadlineMs) {
        break;
      }

      const perturbedState = buildPostSolveState(currentResult, minDimensions, removedIds);
      const runtime = createSearchRuntime(POST_SOLVE_NODE_BUDGET, deadlineMs);
      const candidate = attemptLayout(perturbedState, minDimensions, debug, runtime, true, 0);

      if (!candidate) {
        continue;
      }

      const compactedCandidate = compactSearchResult(candidate, minDimensions);

      // Improvement pass must never increase table count.
      if (compactedCandidate.tables.length > bestResult.tables.length) {
        continue;
      }

      if (!bestCandidateInIteration || compareSearchResults(compactedCandidate, bestCandidateInIteration) < 0) {
        bestCandidateInIteration = compactedCandidate;
      }
    }

    if (!bestCandidateInIteration) {
      stallCount += 1;
      continue;
    }

    const bestComparison = compareSearchResults(bestCandidateInIteration, bestResult);
    const currentComparison = compareSearchResults(bestCandidateInIteration, currentResult);

    if (bestComparison < 0) {
      bestResult = cloneSearchResult(bestCandidateInIteration);
      currentResult = cloneSearchResult(bestCandidateInIteration);
      stallCount = 0;
      continue;
    }

    const allowEscapeMove = stallCount >= 2 && bestCandidateInIteration.tables.length <= currentResult.tables.length;
    if (currentComparison < 0 || allowEscapeMove) {
      currentResult = cloneSearchResult(bestCandidateInIteration);
    }

    stallCount += 1;
  }

  return bestResult;
}

function getRegionCenter(region: FreeRegion) {
  return {
    x: region.x + region.width / 2,
    y: region.y + region.height / 2,
  };
}

function intersectsOrAdjacentToRegion(region: FreeRegion, placement: PlacedPainting) {
  const occupied = toOccupiedRegion(placement.x, placement.y, placement.width, placement.height, SPACING_INCHES);
  const expanded = expandRegion(region, SPACING_INCHES);
  return rectanglesIntersect(expanded, occupied);
}

function placementWithinRegionBounds(candidate: Candidate, width: number, height: number, bounds: FreeRegion) {
  const left = toLeftOriginX(candidate.x, width);
  const right = left + width;
  const bottom = candidate.y;
  const top = candidate.y + height;

  return left >= bounds.x && right <= bounds.x + bounds.width && bottom >= bounds.y && top <= bounds.y + bounds.height;
}

function findRepairRegions(result: SearchResult, fitPaintings: NormalizedPainting[]): RepairRegion[] {
  const regions: RepairRegion[] = [];

  for (const table of result.tables) {
    const gapAnalysis = analyzeFreeRegions(table, fitPaintings);
    const largestGap = [...gapAnalysis].sort((a, b) => b.area - a.area)[0];

    if (largestGap) {
      regions.push({
        tableNumber: table.tableNumber,
        reason: 'LARGE_GAP',
        region: expandRegion(largestGap.region, 3),
      });
    }

    for (const gap of gapAnalysis) {
      if (gap.classification === 'ENCLOSED_POCKET') {
        regions.push({
          tableNumber: table.tableNumber,
          reason: 'ENCLOSED_POCKET',
          region: expandRegion(gap.region, 2),
        });
      }

      if (gap.classification === 'NARROW_STRIP') {
        regions.push({
          tableNumber: table.tableNumber,
          reason: 'NARROW_STRIP',
          region: expandRegion(gap.region, 2),
        });
      }
    }

    for (const placement of getTablePaintingsWithoutSample(table)) {
      if (!isFloatingPainting(table, placement)) {
        continue;
      }

      regions.push({
        tableNumber: table.tableNumber,
        reason: 'FLOATING',
        region: expandRegion(toOccupiedRegion(placement.x, placement.y, placement.width, placement.height, 0), 3),
      });
    }

    regions.push({
      tableNumber: table.tableNumber,
      reason: 'FRONT_EDGE',
      region: { x: 0, y: 0, width: TABLE_WIDTH_INCHES, height: Math.min(30, TABLE_HEIGHT_INCHES) },
    });

    regions.push({
      tableNumber: table.tableNumber,
      reason: 'RIGHT_EDGE',
      region: {
        x: Math.max(0, TABLE_WIDTH_INCHES - 30),
        y: 0,
        width: Math.min(30, TABLE_WIDTH_INCHES),
        height: TABLE_HEIGHT_INCHES,
      },
    });

    const movable = getTablePaintingsWithoutSample(table);
    if (movable.length > 0) {
      const deepest = movable.reduce((best, placement) => {
        if (!best) {
          return placement;
        }
        const bestBack = best.y + best.height;
        const placementBack = placement.y + placement.height;
        return placementBack > bestBack ? placement : best;
      }, null as PlacedPainting | null);

      if (deepest) {
        regions.push({
          tableNumber: table.tableNumber,
          reason: 'TRAVEL_DEPTH',
          region: expandRegion(toOccupiedRegion(deepest.x, deepest.y, deepest.width, deepest.height, 0), 6),
        });
      }
    }
  }

  if (result.tables.length > 1) {
    const firstTable = result.tables[0];
    const firstTableGaps = analyzeFreeRegions(firstTable, fitPaintings).sort((a, b) => b.area - a.area);
    const targetGap = firstTableGaps[0]?.region ?? { x: 0, y: 0, width: TABLE_WIDTH_INCHES, height: TABLE_HEIGHT_INCHES };
    regions.push({
      tableNumber: 1,
      reason: 'TABLE_REDUCTION',
      region: expandRegion(targetGap, 5),
    });
  }

  return regions.slice(0, 48);
}

function buildLocalRepackOrders(paintings: NormalizedPainting[], seed: number) {
  const byAreaDesc = [...paintings].sort((a, b) => (b.normalizedWidth * b.normalizedHeight) - (a.normalizedWidth * a.normalizedHeight));
  const byAreaAsc = [...paintings].sort((a, b) => (a.normalizedWidth * a.normalizedHeight) - (b.normalizedWidth * b.normalizedHeight));
  const byTallest = [...paintings].sort((a, b) => b.normalizedHeight - a.normalizedHeight);
  const byWidest = [...paintings].sort((a, b) => b.normalizedWidth - a.normalizedWidth);
  const shuffledA = deterministicShuffle(paintings, seed);
  const shuffledB = deterministicShuffle(paintings, seed + 131);

  return [paintings, byAreaDesc, byAreaAsc, byTallest, byWidest, shuffledA, shuffledB].slice(0, REGIONAL_REPAIR_ORDER_TRIES);
}

function pruneTrailingEmptyTables(tables: TableState[], minDimensions: MinDimensions) {
  while (tables.length > 1) {
    const last = tables[tables.length - 1];
    if (getTablePaintingsWithoutSample(last).length > 0) {
      break;
    }
    tables.pop();
  }

  for (let index = 0; index < tables.length; index += 1) {
    const tableNumber = index + 1;
    const table = tables[index];
    table.tableNumber = tableNumber;
    table.paintings = table.paintings.map((placement) => {
      if (isFixedSamplePlacement(placement)) {
        return { ...placement, id: `sample-${tableNumber}`, tableNumber };
      }
      return { ...placement, tableNumber };
    });
    table.freeRegions = initializeFreeRegions(table.paintings, minDimensions);
  }
}

function repackRegion(
  baseResult: SearchResult,
  repairRegion: RepairRegion,
  minDimensions: MinDimensions,
  debug: DebugCounters,
  deadlineMs: number
): SearchResult | null {
  if (nowMs() >= deadlineMs) {
    return null;
  }

  const tables = cloneTables(baseResult.tables);
  const tableIndex = tables.findIndex((table) => table.tableNumber === repairRegion.tableNumber);
  if (tableIndex === -1) {
    return null;
  }

  const table = tables[tableIndex];
  const maxSize = repairRegion.reason === 'TABLE_REDUCTION' ? 12 : repairRegion.reason === 'LARGE_GAP' ? 8 : 4;
  let selectable = getTablePaintingsWithoutSample(table)
    .filter((placement) => intersectsOrAdjacentToRegion(repairRegion.region, placement));

  if (repairRegion.reason === 'TRAVEL_DEPTH') {
    selectable = getTablePaintingsWithoutSample(table)
      .sort((a, b) => (b.y + b.height) - (a.y + a.height))
      .slice(0, Math.max(4, maxSize));
  }

  if (repairRegion.reason === 'TABLE_REDUCTION' && tables.length > 1 && table.tableNumber === 1) {
    const donorTable = tables[1];
    const donorCandidates = getTablePaintingsWithoutSample(donorTable).slice(0, 4);
    selectable = [...selectable, ...donorCandidates];
  }

  if (selectable.length === 0) {
    return null;
  }

  const center = getRegionCenter(repairRegion.region);
  selectable = selectable
    .sort((a, b) => {
      const aRegion = toOccupiedRegion(a.x, a.y, a.width, a.height, 0);
      const bRegion = toOccupiedRegion(b.x, b.y, b.width, b.height, 0);
      const ac = getRegionCenter(aRegion);
      const bc = getRegionCenter(bRegion);
      const ad = Math.abs(ac.x - center.x) + Math.abs(ac.y - center.y);
      const bd = Math.abs(bc.x - center.x) + Math.abs(bc.y - center.y);
      return ad - bd;
    })
    .slice(0, maxSize);

  const removedIds = new Set(selectable.map((placement) => placement.id));
  const removedPaintings: NormalizedPainting[] = selectable.map(toNormalizedPaintingFromPlacement);

  for (const localTable of tables) {
    localTable.paintings = localTable.paintings.filter((placement) => !removedIds.has(placement.id));
    localTable.freeRegions = initializeFreeRegions(localTable.paintings, minDimensions);
  }

  const localOrders = buildLocalRepackOrders(removedPaintings, hashPaintingsSeed(removedPaintings));
  let bestLocal: SearchResult | null = null;

  for (const localOrder of localOrders) {
    if (nowMs() >= deadlineMs) {
      break;
    }

    const localTables = cloneTables(tables);
    const localTable = localTables[tableIndex];
    let remaining = [...localOrder];
    let success = true;
    let guard = 0;

    while (remaining.length > 0 && guard < 256) {
      guard += 1;
      localTable.freeRegions = filterFreeRegionsForRemaining(localTable.freeRegions, remaining);
      const legalPlacements = collectLegalPlacementsOnCurrentTable(localTable, remaining, debug, false)
        .filter((option) => placementWithinRegionBounds(option.candidate, option.variant.width, option.variant.height, repairRegion.region));

      if (legalPlacements.length === 0) {
        success = false;
        break;
      }

      const hasFrontRowPlacement = legalPlacements.some((option) => option.candidate.y === 0);
      const scoredPlacements = legalPlacements.map((option) =>
        scoreLegalPlacement(localTable, option, remaining, hasFrontRowPlacement)
      );
      scoredPlacements.sort((a, b) => compareCandidateScores(a.score, b.score));
      const bestPlacement = scoredPlacements[0];

      localTable.paintings.push(bestPlacement.placement);
      localTable.freeRegions = bestPlacement.freeRegions;
      remaining = remaining.filter((painting) => painting.id !== bestPlacement.painting.id);
    }

    if (!success || remaining.length > 0) {
      continue;
    }

    pruneTrailingEmptyTables(localTables, minDimensions);
    const localResult: SearchResult = {
      tables: localTables,
      placements: buildPlacementsFromTables(localTables),
    };

    const compacted = compactSearchResult(localResult, minDimensions);
    if (!bestLocal || compareSearchResults(compacted, bestLocal) < 0) {
      bestLocal = compacted;
    }
  }

  return bestLocal;
}

function runRegionalImprovement(
  initialResult: SearchResult,
  minDimensions: MinDimensions,
  debug: DebugCounters,
  fitPaintings: NormalizedPainting[]
): SearchResult {
  let current = compactSearchResult(cloneSearchResult(initialResult), minDimensions);
  let best = cloneSearchResult(current);
  const deadlineMs = TIME_BUDGETS_ENABLED ? nowMs() + REGIONAL_IMPROVE_MAX_MS : Number.POSITIVE_INFINITY;

  let stallCount = 0;
  let iteration = 0;
  let regions = findRepairRegions(current, fitPaintings);

  while (iteration < REGIONAL_IMPROVE_MAX_ITERATIONS && nowMs() < deadlineMs && stallCount < REGIONAL_IMPROVE_STALL_LIMIT) {
    const depthAwareSwapCandidate = applyDepthAwareRightFenceSwapRepair(current, minDimensions);
    if (depthAwareSwapCandidate) {
      const currentDepth = scoreCompleteLayout(current, fitPaintings).maximumOccupiedDepth;
      const swappedDepth = scoreCompleteLayout(depthAwareSwapCandidate, fitPaintings).maximumOccupiedDepth;

      if (
        depthAwareSwapCandidate.tables.length === current.tables.length &&
        depthAwareSwapCandidate.placements.length === current.placements.length &&
        swappedDepth + 1e-6 < currentDepth
      ) {
        current = compactSearchResult(depthAwareSwapCandidate, minDimensions);
        if (compareSearchResults(current, best) < 0) {
          best = cloneSearchResult(current);
        }
        regions = findRepairRegions(current, fitPaintings);
        stallCount = 0;
        iteration += 1;
        continue;
      }
    }

    if (regions.length === 0) {
      break;
    }

    const region = regions[iteration % regions.length];
    const candidate = repackRegion(current, region, minDimensions, debug, deadlineMs);
    if (!candidate) {
      iteration += 1;
      stallCount += 1;
      continue;
    }

    const bestComparison = compareSearchResults(candidate, best);
    const currentComparison = compareSearchResults(candidate, current);

    if (bestComparison < 0) {
      best = cloneSearchResult(candidate);
      current = cloneSearchResult(candidate);
      regions = findRepairRegions(current, fitPaintings);
      stallCount = 0;
      iteration += 1;
      continue;
    }

    if (currentComparison < 0) {
      current = cloneSearchResult(candidate);
      regions = findRepairRegions(current, fitPaintings);
      stallCount = 0;
      iteration += 1;
      continue;
    }

    iteration += 1;
    stallCount += 1;
  }

  return best;
}

function buildCandidateLayout(
  initialOrder: NormalizedPainting[],
  minDimensions: MinDimensions,
  debug: DebugCounters
) {
  const initialState = createInitialSearchState(initialOrder, minDimensions);
  return solveSearchState(initialState, minDimensions, debug);
}

function selectBestLayout(candidates: SearchResult[]) {
  return candidates.reduce<SearchResult | null>((best, current) => {
    if (!best) {
      return cloneSearchResult(current);
    }

    return compareSearchResults(current, best) < 0 ? cloneSearchResult(current) : best;
  }, null);
}

function getLegalExtraSamplePositionCount(table: TableState) {
  const placementsWithoutExtras = table.paintings.filter((placement) => !isExtraSamplePlacement(placement));
  const keys = new Set<string>();

  for (const x of build200MmFenceAnchorsX(SAMPLE_WIDTH_INCHES)) {
    if (isPlacementValid({ x, y: 0 }, SAMPLE_WIDTH_INCHES, SAMPLE_HEIGHT_INCHES, placementsWithoutExtras)) {
      keys.add(`${x}:0`);
    }
  }

  for (const y of build200MmFenceAnchorsY(SAMPLE_HEIGHT_INCHES)) {
    if (isPlacementValid({ x: 0, y }, SAMPLE_WIDTH_INCHES, SAMPLE_HEIGHT_INCHES, placementsWithoutExtras)) {
      keys.add(`0:${y}`);
    }
  }

  return keys.size;
}

function toSearchResultWithFreeRegions(layout: LayoutResult, fitPaintings: NormalizedPainting[]): SearchResult {
  const minDimensions = normalizedPaintingsMinDimensions(fitPaintings);
  const tables: TableState[] = layout.tables.map((table) => ({
    tableNumber: table.tableNumber,
    paintings: table.paintings.map(clonePainting),
    freeRegions: initializeFreeRegions(table.paintings, minDimensions),
  }));

  return {
    tables,
    placements: buildPlacementsFromTables(tables),
  };
}

function runOptimizationPipeline(order: Painting[]) {
  const runId = ++optimizerRunId;
  const startedAtMs = nowMs();
  activeCandidateTrace = [];

  const sortedPaintings = sortPaintings(order);
  const minDimensions = normalizedPaintingsMinDimensions(sortedPaintings);
  const debug: DebugCounters = {
    candidatesEvaluated: 0,
    freeRegionsCreated: 0,
    freeRegionsMerged: 0,
  };
  const candidateResults: SearchResult[] = [];

  if (DEBUG) {
    console.log('normalize and sort', sortedPaintings.map((item) => item.referenceNumber));
  }

  const initialOrders = generateInitialOrders(sortedPaintings);
  for (const initialOrder of initialOrders) {
    const restartResult = buildCandidateLayout(initialOrder, minDimensions, debug);
    if (!restartResult) {
      continue;
    }

    candidateResults.push(restartResult);
  }

  const bestResult = selectBestLayout(candidateResults);
  if (!bestResult) {
    throw new Error('Unable to place remaining painting(s): no legal layout found.');
  }

  const improvedResult = runRegionalImprovement(bestResult, minDimensions, debug, sortedPaintings);
  const elapsedMs = nowMs() - startedAtMs;
  const finalScore = scoreCompleteLayout(improvedResult, sortedPaintings);

  lastOptimizerDebugRunData = {
    runId,
    elapsedMs,
    candidatesEvaluated: debug.candidatesEvaluated,
    freeRegionsCreated: debug.freeRegionsCreated,
    freeRegionsMerged: debug.freeRegionsMerged,
    finalScore,
    candidateTrace: [...activeCandidateTrace],
  };

  if (PERF_TIMING_ENABLED) {
    console.log('optimizer runtime', {
      runId,
      paintings: order.length,
      tables: improvedResult.tables.length,
      elapsedMs: Number(elapsedMs.toFixed(2)),
      candidatesEvaluated: debug.candidatesEvaluated,
      maxBackY: Number(finalScore.printTravel.maxBackY.toFixed(3)),
      areaWeightedY: Number(finalScore.printTravel.areaWeightedY.toFixed(3)),
      estimatedYTransitions: Number(finalScore.printTravel.estimatedYTransitions.toFixed(3)),
      estimatedXTravel: Number(finalScore.printTravel.estimatedXTravel.toFixed(3)),
      printTravelCost: Number(finalScore.printTravel.totalCost.toFixed(3)),
    });
  }

  return {
    sortedPaintings,
    minDimensions,
    debug,
    paintingOptimizedResult: improvedResult,
  };
}

export function generateLayoutWithoutExtraSamples(order: Painting[]): LayoutResult {
  const pipeline = runOptimizationPipeline(order);
  return finalizeLayout(
    pipeline.paintingOptimizedResult.tables,
    pipeline.paintingOptimizedResult.placements,
    order.length
  );
}

export function getVerificationGapReports(layout: LayoutResult, referenceOrder: Painting[]): VerificationGapTableReport[] {
  const fitPaintings = normalizePaintings(referenceOrder);
  const searchResult = toSearchResultWithFreeRegions(layout, fitPaintings);

  return searchResult.tables.map((table) => {
    const gapRegions = analyzeFreeRegions(table, fitPaintings);
    return {
      tableNumber: table.tableNumber,
      gapRegions,
      gapScore: scoreGapQuality(gapRegions),
      legalExtraSamplePositions: getLegalExtraSamplePositionCount(table),
    };
  });
}

export function getVerificationCompleteScore(layout: LayoutResult, referenceOrder: Painting[]): CompleteLayoutScore {
  const fitPaintings = normalizePaintings(referenceOrder);
  const searchResult = toSearchResultWithFreeRegions(layout, fitPaintings);
  return scoreCompleteLayout(searchResult, fitPaintings);
}

export function compareVerificationLayouts(layoutA: LayoutResult, layoutB: LayoutResult, referenceOrder: Painting[]): number {
  const fitPaintings = normalizePaintings(referenceOrder);
  const searchA = toSearchResultWithFreeRegions(layoutA, fitPaintings);
  const searchB = toSearchResultWithFreeRegions(layoutB, fitPaintings);
  const scoreA = scoreCompleteLayout(searchA, fitPaintings);
  const scoreB = scoreCompleteLayout(searchB, fitPaintings);
  return compareCompleteLayoutScore(scoreA, scoreB);
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
      `Placed ${orderLength} painting(s) across ${tables.length} table(s).`,
    ],
  };
}

export function generateLayout(order: Painting[], _previousLayout?: LayoutResult | null): LayoutResult {
  const pipeline = runOptimizationPipeline(order);
  const finalizedResult = applyExtraSampleFill(pipeline.paintingOptimizedResult, pipeline.minDimensions);

  if (DEBUG) {
    const totalFreeArea = getTotalFreeArea(finalizedResult.tables);
    const totalArea = finalizedResult.tables.length * TABLE_WIDTH_INCHES * TABLE_HEIGHT_INCHES;
    console.log('optimizer debug', {
      tablesUsed: finalizedResult.tables.length,
      candidatesEvaluated: pipeline.debug.candidatesEvaluated,
      freeRegionsCreated: pipeline.debug.freeRegionsCreated,
      freeRegionsMerged: pipeline.debug.freeRegionsMerged,
      wastePercent: ((totalFreeArea / totalArea) * 100).toFixed(2),
    });
  }

  return finalizeLayout(finalizedResult.tables, finalizedResult.placements, order.length);
}
