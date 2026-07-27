/// <reference types="node" />

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import {
  calculatePrintTravelCost,
  compareVerificationLayouts,
  generateLayout,
  generateLayoutWithoutExtraSamples,
  getVerificationCompleteScore,
  getVerificationGapReports,
  isPlacementValid,
  normalizePainting,
  toRectEdges,
  type GapRegionAnalysis,
  type PrintTravelWeights,
} from '../src/optimizer/layoutEngine';
import type { LayoutResult, Painting, PlacedPainting } from '../src/optimizer/types';
import { getPdfCoordinateRowsForLayout } from '../src/utils/pdfExport';
import {
  MM_PER_INCH,
  SAMPLE_HEIGHT_INCHES,
  SAMPLE_WIDTH_INCHES,
  SPACING_INCHES,
  TABLE_HEIGHT_INCHES,
  TABLE_HEIGHT_MM,
  TABLE_WIDTH_INCHES,
  TABLE_WIDTH_MM,
} from '../src/constants/tableDimensions';

const EPSILON_MM = 0.01;
const MIN_SPACING_MM = SPACING_INCHES * MM_PER_INCH;

const MIN_USABLE_GAP_WIDTH_MM = 120;
const MIN_USABLE_GAP_HEIGHT_MM = 120;
const MAX_ENCLOSED_POCKETS = 3;
const MAX_UNUSABLE_STRIP_AREA_RATIO = 0.25;
const MAX_FRAGMENTED_FREE_REGIONS = 40;
const FIXTURE_TIMEOUT_MS = 180_000;

interface Fixture {
  name: string;
  order: Painting[];
  expectedMaxTables?: number;
  expectedMinTables?: number;
  expectLegalExtraSamples?: 'some' | 'none' | 'any';
}

interface Failure {
  fixture: string;
  rule: string;
  detail: string;
}

interface CliOptions {
  quiet: boolean;
  fixture: string | null;
}

type RunMode = 'full-suite' | 'fixture-filtered';

interface CheckRunResult {
  name: string;
  passed: boolean;
  failureCount: number;
  durationMs: number;
}

interface FixtureRunResult {
  fixture: string;
  passed: boolean;
  skipped: boolean;
  durationMs: number;
  checks: CheckRunResult[];
  failures: Failure[];
}

function makeRequiredSample(tableNumber: number): PlacedPainting {
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

function makePlacedPainting(
  source: Painting,
  tableNumber: number,
  x: number,
  y: number,
  orientation: 'VERTICAL' | 'HORIZONTAL'
): PlacedPainting {
  const normalized = normalizePainting(source);
  return {
    id: source.id,
    referenceNumber: source.referenceNumber,
    name: source.name,
    width: normalized.normalizedWidth,
    height: normalized.normalizedHeight,
    orientation,
    rotated: orientation === 'HORIZONTAL',
    tableNumber,
    x,
    y,
    color: source.color,
  };
}

function buildSyntheticLayout(paintings: PlacedPainting[]): LayoutResult {
  const tableNumber = paintings[0]?.tableNumber ?? 1;
  const sample = makeRequiredSample(tableNumber);
  const tablePaintings = [sample, ...paintings];
  return {
    tables: [
      {
        tableNumber,
        paintings: tablePaintings,
      },
    ],
    placements: tablePaintings,
    messages: [],
  };
}

function makePainting(index: number, width: number, height: number, orientation: 'VERT' | 'HORI', name?: string): Painting {
  const id = `fixture-${index}`;
  const referenceNumber = `#${String(index).padStart(2, '0')}`;
  return {
    id,
    referenceNumber,
    name: name ?? `P${index}`,
    width,
    height,
    orientation,
    color: '#336699',
  };
}

function mm(valueInches: number) {
  return valueInches * MM_PER_INCH;
}

function approxEqual(a: number, b: number, epsilon = EPSILON_MM) {
  return Math.abs(a - b) <= epsilon;
}

function toRectMm(p: PlacedPainting) {
  const edges = toRectEdges(p.x, p.y, p.width, p.height);
  return {
    left: mm(edges.left),
    right: mm(edges.right),
    bottom: mm(edges.bottom),
    top: mm(edges.top),
    width: mm(p.width),
    height: mm(p.height),
    x: mm(p.x),
    y: mm(p.y),
  };
}

function projectionOverlap(a0: number, a1: number, b0: number, b1: number) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function axisSeparation(a0: number, a1: number, b0: number, b1: number) {
  if (a1 <= b0) {
    return b0 - a1;
  }
  if (b1 <= a0) {
    return a0 - b1;
  }
  return 0;
}

function pairLabel(a: PlacedPainting, b: PlacedPainting) {
  return `${a.referenceNumber}/${b.referenceNumber}`;
}

function normalizeLayoutForHash(layout: LayoutResult) {
  const normalizedTables = [...layout.tables]
    .sort((a, b) => a.tableNumber - b.tableNumber)
    .map((table) => {
      const items = [...table.paintings]
        .sort((a, b) => {
          const keyA = `${a.referenceNumber}|${a.id}|${a.orientation}`;
          const keyB = `${b.referenceNumber}|${b.id}|${b.orientation}`;
          if (keyA !== keyB) {
            return keyA.localeCompare(keyB);
          }
          if (a.x !== b.x) {
            return a.x - b.x;
          }
          return a.y - b.y;
        })
        .map((p) => ({
          referenceNumber: p.referenceNumber,
          orientation: p.orientation,
          width: Number(p.width.toFixed(5)),
          height: Number(p.height.toFixed(5)),
          x: Number(mm(p.x).toFixed(3)),
          y: Number(mm(p.y).toFixed(3)),
          tableNumber: p.tableNumber,
        }));

      return {
        tableNumber: table.tableNumber,
        items,
      };
    });

  return JSON.stringify(normalizedTables);
}

function hashLayout(layout: LayoutResult) {
  const normalized = normalizeLayoutForHash(layout);
  return createHash('sha256').update(normalized).digest('hex');
}

function collectPaintings(layout: LayoutResult) {
  return layout.placements.filter((p) => p.sampleType !== 'required' && p.sampleType !== 'extra');
}

function collectRequiredSamples(layout: LayoutResult) {
  return layout.placements.filter((p) => p.sampleType === 'required');
}

function collectExtraSamples(layout: LayoutResult) {
  return layout.placements.filter((p) => p.sampleType === 'extra');
}

function validateTableDimensionsConstant(failures: Failure[]) {
  if (!approxEqual(TABLE_WIDTH_MM, 2500, 1e-9) || !approxEqual(TABLE_HEIGHT_MM, 2030, 1e-9)) {
    failures.push({
      fixture: 'global',
      rule: 'table-dimensions-constant',
      detail: `expected table dimensions 2500x2030mm, got ${TABLE_WIDTH_MM}x${TABLE_HEIGHT_MM}mm`,
    });
  }
}

function validateSampleSemantics(layout: LayoutResult, fixtureName: string, failures: Failure[]) {
  for (const table of layout.tables) {
    const required = table.paintings.filter((painting) => painting.sampleType === 'required');
    const extras = table.paintings.filter((painting) => painting.sampleType === 'extra');
    const cornerDuplicates = extras.filter((extra) => approxEqual(mm(extra.x), 0) && approxEqual(mm(extra.y), 0));

    if (required.length !== 1) {
      failures.push({
        fixture: fixtureName,
        rule: 'required-sample-count',
        detail: `table ${table.tableNumber} expected exactly one required sample, got ${required.length}`,
      });
    }

    if (required.some((sample) => sample.referenceNumber !== 'SAMPLE')) {
      failures.push({
        fixture: fixtureName,
        rule: 'required-sample-label',
        detail: `table ${table.tableNumber} required sample must use reference SAMPLE`,
      });
    }

    if (extras.some((sample) => sample.referenceNumber !== 'SAMPLE+')) {
      failures.push({
        fixture: fixtureName,
        rule: 'extra-sample-label',
        detail: `table ${table.tableNumber} extra sample must use reference SAMPLE+`,
      });
    }

    if (cornerDuplicates.length > 0) {
      failures.push({
        fixture: fixtureName,
        rule: 'extra-sample-corner-duplicate',
        detail: `table ${table.tableNumber} has ${cornerDuplicates.length} extra sample(s) at fixed sample corner`,
      });
    }

    const paintings = table.paintings.filter((painting) => !painting.sampleType);
    if (paintings.length + required.length + extras.length !== table.paintings.length) {
      failures.push({
        fixture: fixtureName,
        rule: 'sample-type-mapping',
        detail: `table ${table.tableNumber} contains ambiguous sample typing`,
      });
    }
  }
}

function validateSpacing(layout: LayoutResult, failures: Failure[], fixtureName: string) {
  const paintings = collectPaintings(layout);
  const requiredSamples = collectRequiredSamples(layout);

  for (let i = 0; i < paintings.length; i += 1) {
    for (let j = i + 1; j < paintings.length; j += 1) {
      const a = paintings[i];
      const b = paintings[j];
      if (a.tableNumber !== b.tableNumber) {
        continue;
      }

      const ra = toRectMm(a);
      const rb = toRectMm(b);
      const xOverlap = projectionOverlap(ra.left, ra.right, rb.left, rb.right);
      const yOverlap = projectionOverlap(ra.bottom, ra.top, rb.bottom, rb.top);

      if (xOverlap > EPSILON_MM && yOverlap > EPSILON_MM) {
        failures.push({
          fixture: fixtureName,
          rule: 'spacing-overlap',
          detail: `table ${a.tableNumber} ${pairLabel(a, b)} overlap mm x=${xOverlap.toFixed(3)} y=${yOverlap.toFixed(3)}`,
        });
        continue;
      }

      if (yOverlap > EPSILON_MM) {
        const xSep = axisSeparation(ra.left, ra.right, rb.left, rb.right);
        if (xSep + EPSILON_MM < MIN_SPACING_MM) {
          failures.push({
            fixture: fixtureName,
            rule: 'spacing-horizontal-clearance',
            detail: `table ${a.tableNumber} ${pairLabel(a, b)} expected >=${MIN_SPACING_MM.toFixed(3)}mm got ${xSep.toFixed(3)}mm`,
          });
        }
      }

      if (xOverlap > EPSILON_MM) {
        const ySep = axisSeparation(ra.bottom, ra.top, rb.bottom, rb.top);
        if (ySep + EPSILON_MM < MIN_SPACING_MM) {
          failures.push({
            fixture: fixtureName,
            rule: 'spacing-vertical-clearance',
            detail: `table ${a.tableNumber} ${pairLabel(a, b)} expected >=${MIN_SPACING_MM.toFixed(3)}mm got ${ySep.toFixed(3)}mm`,
          });
        }
      }
    }
  }

  for (const painting of paintings) {
    for (const sample of requiredSamples) {
      if (painting.tableNumber !== sample.tableNumber) {
        continue;
      }

      const rp = toRectMm(painting);
      const rs = toRectMm(sample);
      const xOverlap = projectionOverlap(rp.left, rp.right, rs.left, rs.right);
      const yOverlap = projectionOverlap(rp.bottom, rp.top, rs.bottom, rs.top);

      if (xOverlap > EPSILON_MM && yOverlap > EPSILON_MM) {
        failures.push({
          fixture: fixtureName,
          rule: 'sample-overlap',
          detail: `table ${painting.tableNumber} ${painting.referenceNumber}/SAMPLE overlap`,
        });
        continue;
      }

      if (yOverlap > EPSILON_MM) {
        const xSep = axisSeparation(rp.left, rp.right, rs.left, rs.right);
        if (xSep + EPSILON_MM < MIN_SPACING_MM) {
          failures.push({
            fixture: fixtureName,
            rule: 'sample-horizontal-clearance',
            detail: `table ${painting.tableNumber} ${painting.referenceNumber}/SAMPLE expected >=${MIN_SPACING_MM.toFixed(3)}mm got ${xSep.toFixed(3)}mm`,
          });
        }
      }

      if (xOverlap > EPSILON_MM) {
        const ySep = axisSeparation(rp.bottom, rp.top, rs.bottom, rs.top);
        if (ySep + EPSILON_MM < MIN_SPACING_MM) {
          failures.push({
            fixture: fixtureName,
            rule: 'sample-vertical-clearance',
            detail: `table ${painting.tableNumber} ${painting.referenceNumber}/SAMPLE expected >=${MIN_SPACING_MM.toFixed(3)}mm got ${ySep.toFixed(3)}mm`,
          });
        }
      }
    }
  }
}

function validateBounds(layout: LayoutResult, failures: Failure[], fixtureName: string) {
  const requiredSamplesByTable = new Map<number, PlacedPainting[]>();

  for (const placement of layout.placements) {
    const xMm = mm(placement.x);
    const yMm = mm(placement.y);
    const widthMm = mm(placement.width);
    const heightMm = mm(placement.height);

    if (xMm < -EPSILON_MM || xMm > TABLE_WIDTH_MM + EPSILON_MM) {
      failures.push({
        fixture: fixtureName,
        rule: 'bounds-x',
        detail: `${placement.referenceNumber} table ${placement.tableNumber} x expected [0,${TABLE_WIDTH_MM}] got ${xMm.toFixed(3)}`,
      });
    }

    if (yMm < -EPSILON_MM || yMm > TABLE_HEIGHT_MM + EPSILON_MM) {
      failures.push({
        fixture: fixtureName,
        rule: 'bounds-y',
        detail: `${placement.referenceNumber} table ${placement.tableNumber} y expected [0,${TABLE_HEIGHT_MM}] got ${yMm.toFixed(3)}`,
      });
    }

    if (xMm + widthMm > TABLE_WIDTH_MM + EPSILON_MM) {
      failures.push({
        fixture: fixtureName,
        rule: 'bounds-width',
        detail: `${placement.referenceNumber} table ${placement.tableNumber} x+width expected <=${TABLE_WIDTH_MM} got ${(xMm + widthMm).toFixed(3)}`,
      });
    }

    if (yMm + heightMm > TABLE_HEIGHT_MM + EPSILON_MM) {
      failures.push({
        fixture: fixtureName,
        rule: 'bounds-height',
        detail: `${placement.referenceNumber} table ${placement.tableNumber} y+height expected <=${TABLE_HEIGHT_MM} got ${(yMm + heightMm).toFixed(3)}`,
      });
    }

    if (placement.sampleType === 'required') {
      const bucket = requiredSamplesByTable.get(placement.tableNumber) ?? [];
      bucket.push(placement);
      requiredSamplesByTable.set(placement.tableNumber, bucket);

      if (!approxEqual(xMm, 0) || !approxEqual(yMm, 0)) {
        failures.push({
          fixture: fixtureName,
          rule: 'sample-origin',
          detail: `SAMPLE table ${placement.tableNumber} expected (0,0) got (${xMm.toFixed(3)},${yMm.toFixed(3)})`,
        });
      }

      if (placement.orientation !== 'VERTICAL') {
        failures.push({
          fixture: fixtureName,
          rule: 'sample-orientation',
          detail: `SAMPLE table ${placement.tableNumber} expected VERTICAL got ${placement.orientation}`,
        });
      }

      if (!approxEqual(placement.width, SAMPLE_WIDTH_INCHES) || !approxEqual(placement.height, SAMPLE_HEIGHT_INCHES)) {
        failures.push({
          fixture: fixtureName,
          rule: 'sample-dimensions',
          detail: `SAMPLE table ${placement.tableNumber} expected ${SAMPLE_WIDTH_INCHES}x${SAMPLE_HEIGHT_INCHES}in got ${placement.width}x${placement.height}in`,
        });
      }
    }
  }

  for (const table of layout.tables) {
    const samples = requiredSamplesByTable.get(table.tableNumber) ?? [];
    if (samples.length !== 1) {
      failures.push({
        fixture: fixtureName,
        rule: 'sample-per-table',
        detail: `table ${table.tableNumber} expected 1 required SAMPLE got ${samples.length}`,
      });
    }
  }
}

function validatePdfCoordinateParity(layout: LayoutResult, failures: Failure[], fixtureName: string) {
  const rows = getPdfCoordinateRowsForLayout(layout);
  const rowById = new Map<string, ReturnType<typeof getPdfCoordinateRowsForLayout>[number]>();
  for (const row of rows) {
    rowById.set(`${row.tableNumber}:${row.placementId}`, row);
  }

  for (const placement of layout.placements) {
    if (placement.sampleType === 'extra') {
      continue;
    }

    const key = `${placement.tableNumber}:${placement.id}`;
    const row = rowById.get(key);
    if (!row) {
      failures.push({
        fixture: fixtureName,
        rule: 'pdf-coordinate-missing-row',
        detail: `missing PDF coordinate row for ${placement.referenceNumber} table ${placement.tableNumber}`,
      });
      continue;
    }

    const expectedHori = Math.round(mm(placement.x)).toString();
    const expectedVert = Math.round(mm(placement.y)).toString();
    if (row.hori !== expectedHori || row.vert !== expectedVert) {
      failures.push({
        fixture: fixtureName,
        rule: 'pdf-coordinate-mismatch',
        detail: `${placement.referenceNumber} table ${placement.tableNumber} expected HORI/VERT ${expectedHori}/${expectedVert} got ${row.hori}/${row.vert}`,
      });
    }
  }
}

function validateOrientation(layout: LayoutResult, fixture: Fixture, failures: Failure[]) {
  const expectedById = new Map(fixture.order.map((p) => [p.id, p]));

  for (const painting of collectPaintings(layout)) {
    const expected = expectedById.get(painting.id);
    if (!expected) {
      failures.push({
        fixture: fixture.name,
        rule: 'orientation-unknown-id',
        detail: `placement ${painting.referenceNumber} id ${painting.id} not found in fixture`,
      });
      continue;
    }

    if (expected.orientation === 'VERT' && painting.orientation !== 'VERTICAL') {
      failures.push({
        fixture: fixture.name,
        rule: 'orientation-vert',
        detail: `${painting.referenceNumber} expected VERTICAL got ${painting.orientation}`,
      });
    }

    if (expected.orientation === 'HORI' && painting.orientation !== 'HORIZONTAL') {
      failures.push({
        fixture: fixture.name,
        rule: 'orientation-hori',
        detail: `${painting.referenceNumber} expected HORIZONTAL got ${painting.orientation}`,
      });
    }

    const expectedNormalized = normalizePainting(expected);
    if (!approxEqual(painting.width, expectedNormalized.normalizedWidth, 1e-6) || !approxEqual(painting.height, expectedNormalized.normalizedHeight, 1e-6)) {
      failures.push({
        fixture: fixture.name,
        rule: 'orientation-dimensions',
        detail: `${painting.referenceNumber} expected ${expectedNormalized.normalizedWidth}x${expectedNormalized.normalizedHeight} got ${painting.width}x${painting.height}`,
      });
    }
  }
}

function validateDeterminism(fixture: Fixture, failures: Failure[]) {
  const hashes = new Set<string>();
  const values: string[] = [];
  const runGc = (globalThis as { gc?: () => void }).gc;

  for (let i = 0; i < 3; i += 1) {
    const layout = generateLayout(fixture.order);
    const hash = hashLayout(layout);
    hashes.add(hash);
    values.push(hash);
    if (typeof runGc === 'function') {
      runGc();
    }
  }

  if (hashes.size !== 1) {
    failures.push({
      fixture: fixture.name,
      rule: 'determinism',
      detail: `expected one stable hash, received ${values.join(', ')}`,
    });
  }
}

function validateTableCount(layout: LayoutResult, fixture: Fixture, failures: Failure[]) {
  const tableCount = layout.tables.length;
  if (fixture.expectedMaxTables !== undefined && tableCount > fixture.expectedMaxTables) {
    failures.push({
      fixture: fixture.name,
      rule: 'table-count-max',
      detail: `expected <= ${fixture.expectedMaxTables} tables, got ${tableCount}`,
    });
  }

  if (fixture.expectedMinTables !== undefined && tableCount < fixture.expectedMinTables) {
    failures.push({
      fixture: fixture.name,
      rule: 'table-count-min',
      detail: `expected >= ${fixture.expectedMinTables} tables, got ${tableCount}`,
    });
  }
}

function countClassification(gaps: GapRegionAnalysis[], classification: string) {
  return gaps.filter((gap) => gap.classification === classification).length;
}

function validateGapQuality(paintingsOnlyLayout: LayoutResult, fixture: Fixture, failures: Failure[]) {
  const reports = getVerificationGapReports(paintingsOnlyLayout, fixture.order);
  const totalTables = reports.length;
  const totalAreaMm = TABLE_WIDTH_MM * TABLE_HEIGHT_MM * Math.max(1, totalTables);

  let enclosedPockets = 0;
  let narrowStripAreaMm = 0;
  let fragmentedRegions = 0;
  let largestUsableRectangleMm = 0;
  let fittingRegionCount = 0;
  let legalExtraPositions = 0;

  for (const report of reports) {
    enclosedPockets += countClassification(report.gapRegions, 'ENCLOSED_POCKET');
    fragmentedRegions += report.gapScore.fragmentation;
    legalExtraPositions += report.legalExtraSamplePositions;

    for (const gap of report.gapRegions) {
      const widthMm = mm(gap.width);
      const heightMm = mm(gap.height);
      if (gap.classification === 'NARROW_STRIP') {
        narrowStripAreaMm += mm(gap.area);
      }

      if (gap.remainingFitCount > 0) {
        fittingRegionCount += 1;
      }

      if (widthMm >= MIN_USABLE_GAP_WIDTH_MM && heightMm >= MIN_USABLE_GAP_HEIGHT_MM) {
        largestUsableRectangleMm = Math.max(largestUsableRectangleMm, mm(gap.area));
      }
    }
  }

  const stripAreaRatio = totalAreaMm > 0 ? narrowStripAreaMm / totalAreaMm : 0;

  if (enclosedPockets > MAX_ENCLOSED_POCKETS) {
    failures.push({
      fixture: fixture.name,
      rule: 'gap-enclosed-pockets',
      detail: `expected <= ${MAX_ENCLOSED_POCKETS}, got ${enclosedPockets}`,
    });
  }

  if (stripAreaRatio > MAX_UNUSABLE_STRIP_AREA_RATIO) {
    failures.push({
      fixture: fixture.name,
      rule: 'gap-strip-area-ratio',
      detail: `expected <= ${MAX_UNUSABLE_STRIP_AREA_RATIO.toFixed(3)}, got ${stripAreaRatio.toFixed(3)}`,
    });
  }

  if (fragmentedRegions > MAX_FRAGMENTED_FREE_REGIONS) {
    failures.push({
      fixture: fixture.name,
      rule: 'gap-fragmentation',
      detail: `expected <= ${MAX_FRAGMENTED_FREE_REGIONS}, got ${fragmentedRegions}`,
    });
  }

  if (fixture.expectLegalExtraSamples === 'some' && legalExtraPositions <= 0) {
    failures.push({
      fixture: fixture.name,
      rule: 'gap-legal-extra-samples',
      detail: 'expected at least one legal extra sample position, got 0',
    });
  }

  if (fixture.expectLegalExtraSamples === 'none' && legalExtraPositions !== 0) {
    failures.push({
      fixture: fixture.name,
      rule: 'gap-legal-extra-samples',
      detail: `expected no legal extra sample positions, got ${legalExtraPositions}`,
    });
  }

  const completeScore = getVerificationCompleteScore(paintingsOnlyLayout, fixture.order);
  if (completeScore.gapQuality.largestUsableRectangle < 0 || largestUsableRectangleMm < 0 || fittingRegionCount < 0) {
    failures.push({
      fixture: fixture.name,
      rule: 'gap-analysis-invalid',
      detail: 'gap analysis produced invalid aggregate values',
    });
  }
}

function validateExtraSamples(finalLayout: LayoutResult, paintingsOnlyLayout: LayoutResult, fixture: Fixture, failures: Failure[]) {
  const beforePaintings = collectPaintings(paintingsOnlyLayout)
    .map((p) => `${p.id}|${p.tableNumber}|${p.x.toFixed(6)}|${p.y.toFixed(6)}|${p.width.toFixed(6)}|${p.height.toFixed(6)}|${p.orientation}`)
    .sort();
  const afterPaintings = collectPaintings(finalLayout)
    .map((p) => `${p.id}|${p.tableNumber}|${p.x.toFixed(6)}|${p.y.toFixed(6)}|${p.width.toFixed(6)}|${p.height.toFixed(6)}|${p.orientation}`)
    .sort();

  if (beforePaintings.join('\n') !== afterPaintings.join('\n')) {
    failures.push({
      fixture: fixture.name,
      rule: 'extra-sample-painting-move',
      detail: 'paintings changed between painting-only and final-with-extra-sample layout',
    });
  }

  const extras = collectExtraSamples(finalLayout);

  for (const extra of extras) {
    const xMm = mm(extra.x);
    const yMm = mm(extra.y);
    const onFront = approxEqual(yMm, 0);
    const onRight = approxEqual(xMm, 0);

    if (!onFront && !onRight) {
      failures.push({
        fixture: fixture.name,
        rule: 'extra-sample-fence',
        detail: `${extra.id} table ${extra.tableNumber} expected front or right fence, got x=${xMm.toFixed(3)} y=${yMm.toFixed(3)}`,
      });
    }

    if (onFront) {
      const k = xMm / 200;
      if (Math.abs(k - Math.round(k)) > 0.05) {
        failures.push({
          fixture: fixture.name,
          rule: 'extra-sample-200mm-front',
          detail: `${extra.id} table ${extra.tableNumber} front position ${xMm.toFixed(3)}mm is not on 200mm grid`,
        });
      }
    }

    if (onRight) {
      const k = yMm / 200;
      if (Math.abs(k - Math.round(k)) > 0.05) {
        failures.push({
          fixture: fixture.name,
          rule: 'extra-sample-200mm-right',
          detail: `${extra.id} table ${extra.tableNumber} right position ${yMm.toFixed(3)}mm is not on 200mm grid`,
        });
      }
    }

    const sameTablePlacements = finalLayout.tables
      .find((t) => t.tableNumber === extra.tableNumber)
      ?.paintings.filter((p) => p.id !== extra.id) ?? [];

    if (!isPlacementValid({ x: extra.x, y: extra.y }, extra.width, extra.height, sameTablePlacements)) {
      failures.push({
        fixture: fixture.name,
        rule: 'extra-sample-spacing',
        detail: `${extra.id} table ${extra.tableNumber} violates spacing/collision constraints`,
      });
    }
  }

  if (collectPaintings(finalLayout).length !== fixture.order.length) {
    failures.push({
      fixture: fixture.name,
      rule: 'extra-sample-painting-count',
      detail: `expected painting count ${fixture.order.length}, got ${collectPaintings(finalLayout).length}`,
    });
  }
}

function validatePrintTravelPreference(failures: Failure[]) {
  const travelOrder: Painting[] = [
    makePainting(101, 20, 10, 'VERT', 'Travel A'),
    makePainting(102, 20, 10, 'VERT', 'Travel B'),
    makePainting(103, 16, 10, 'VERT', 'Travel C'),
  ];

  const deepLayout = buildSyntheticLayout([
    makePlacedPainting(travelOrder[0], 1, 0, 9, 'VERTICAL'),
    makePlacedPainting(travelOrder[1], 1, 0, 20, 'VERTICAL'),
    makePlacedPainting(travelOrder[2], 1, 0, 31, 'VERTICAL'),
  ]);

  const wideLayout = buildSyntheticLayout([
    makePlacedPainting(travelOrder[0], 1, 0, 9, 'VERTICAL'),
    makePlacedPainting(travelOrder[1], 1, 21, 9, 'VERTICAL'),
    makePlacedPainting(travelOrder[2], 1, 42, 9, 'VERTICAL'),
  ]);

  validateSpacing(deepLayout, failures, 'travel-deep-layout');
  validateBounds(deepLayout, failures, 'travel-deep-layout');
  validateSpacing(wideLayout, failures, 'travel-wide-layout');
  validateBounds(wideLayout, failures, 'travel-wide-layout');

  const comparison = compareVerificationLayouts(deepLayout, wideLayout, travelOrder);
  if (comparison <= 0) {
    const deepScore = getVerificationCompleteScore(deepLayout, travelOrder);
    const wideScore = getVerificationCompleteScore(wideLayout, travelOrder);
    failures.push({
      fixture: 'travel-layout-preference',
      rule: 'travel-prefer-wide-shallow',
      detail: `expected wide/shallow to win. deepCost=${deepScore.printTravel.totalCost.toFixed(3)} wideCost=${wideScore.printTravel.totalCost.toFixed(3)}`,
    });
  }

  const deepTravelDefault = calculatePrintTravelCost(deepLayout.placements);
  const wideTravelDefault = calculatePrintTravelCost(wideLayout.placements);
  if (wideTravelDefault.totalCost >= deepTravelDefault.totalCost) {
    failures.push({
      fixture: 'travel-layout-preference',
      rule: 'travel-default-weighting',
      detail: `expected default travel cost to prefer wide/shallow. deep=${deepTravelDefault.totalCost.toFixed(3)} wide=${wideTravelDefault.totalCost.toFixed(3)}`,
    });
  }

  const xHeavyWeights: PrintTravelWeights = {
    yTravelWeight: 1,
    xTravelWeight: 7,
    yDepthWeight: 1,
    yCenterWeight: 1,
    yTransitionWeight: 1,
  };
  const deepTravelXHeavy = calculatePrintTravelCost(deepLayout.placements, xHeavyWeights);
  const wideTravelXHeavy = calculatePrintTravelCost(wideLayout.placements, xHeavyWeights);
  if (deepTravelXHeavy.totalCost >= wideTravelXHeavy.totalCost) {
    failures.push({
      fixture: 'travel-layout-preference',
      rule: 'travel-weight-sensitivity',
      detail: `expected x-heavy weights to alter winner toward narrower layout. deep=${deepTravelXHeavy.totalCost.toFixed(3)} wide=${wideTravelXHeavy.totalCost.toFixed(3)}`,
    });
  }

  const generated = generateLayout(travelOrder);
  if (generated.tables.length > 1) {
    failures.push({
      fixture: 'travel-layout-preference',
      rule: 'travel-no-extra-table',
      detail: `expected one-table layout; got ${generated.tables.length}`,
    });
  }
}

function isAboveSampleOnRightFence(sample: PlacedPainting, placement: PlacedPainting) {
  return placement.x === 0 && placement.y >= sample.y + sample.height + SPACING_INCHES - 1e-6;
}

function validateDepthAwareRightFenceStacking(layout: LayoutResult, fixture: Fixture, failures: Failure[]) {
  if (fixture.name !== 'depth-aware-right-fence') {
    return;
  }

  const table = layout.tables.find((candidate) => {
    const movable = candidate.paintings.filter((painting) => painting.sampleType !== 'required' && painting.sampleType !== 'extra');
    return movable.length >= 3;
  });

  if (!table) {
    failures.push({
      fixture: fixture.name,
      rule: 'depth-right-fence-missing-table',
      detail: 'expected a table containing the depth-aware fixture placements',
    });
    return;
  }

  const sample = table.paintings.find((painting) => painting.sampleType === 'required');
  if (!sample) {
    failures.push({
      fixture: fixture.name,
      rule: 'depth-right-fence-missing-sample',
      detail: 'required SAMPLE missing from fixture table',
    });
    return;
  }

  const movable = table.paintings.filter((painting) => painting.sampleType !== 'required' && painting.sampleType !== 'extra');
  const tall = movable.find((painting) => approxEqual(painting.width, 28, 1e-6) && approxEqual(painting.height, 56, 1e-6));
  const short = movable.find((painting) => approxEqual(painting.width, 28, 1e-6) && approxEqual(painting.height, 47, 1e-6));

  if (!tall || !short) {
    failures.push({
      fixture: fixture.name,
      rule: 'depth-right-fence-missing-paintings',
      detail: 'expected both 28x56 and 28x47 placements in fixture table',
    });
    return;
  }

  const tallAbove = isAboveSampleOnRightFence(sample, tall);
  const shortAbove = isAboveSampleOnRightFence(sample, short);
  const tallFront = approxEqual(tall.y, 0, 1e-6);
  const shortFront = approxEqual(short.y, 0, 1e-6);

  if (!tallFront || !shortAbove) {
    failures.push({
      fixture: fixture.name,
      rule: 'depth-right-fence-order',
      detail: `expected 28x56 on front fence and 28x47 above SAMPLE; got tall(y=${tall.y.toFixed(3)},x=${tall.x.toFixed(3)}) short(y=${short.y.toFixed(3)},x=${short.x.toFixed(3)})`,
    });
  }

  if (tallAbove && shortFront) {
    const others = table.paintings.filter((painting) => painting.id !== tall.id && painting.id !== short.id);
    const shortCanOccupyTallSlot = isPlacementValid({ x: tall.x, y: tall.y }, short.width, short.height, others);

    if (shortCanOccupyTallSlot) {
      failures.push({
        fixture: fixture.name,
        rule: 'depth-right-fence-legal-swap',
        detail: '28x56 is above SAMPLE while 28x47 can legally occupy that right-fence slot',
      });
    }
  }

  const currentMaxOccupiedY = movable.reduce((maxY, painting) => Math.max(maxY, painting.y + painting.height), 0);
  const others = table.paintings.filter((painting) => painting.id !== tall.id && painting.id !== short.id);
  const swappedTall = { ...tall, x: short.x, y: short.y };
  const swappedShort = { ...short, x: tall.x, y: tall.y };
  const swappedLegalForTall = isPlacementValid({ x: swappedTall.x, y: swappedTall.y }, swappedTall.width, swappedTall.height, others);
  const swappedLegalForShort = isPlacementValid(
    { x: swappedShort.x, y: swappedShort.y },
    swappedShort.width,
    swappedShort.height,
    [...others, swappedTall]
  );

  if (swappedLegalForTall && swappedLegalForShort) {
    const swappedMaxOccupiedY = movable.reduce((maxY, painting) => {
      if (painting.id === tall.id) {
        return Math.max(maxY, swappedTall.y + swappedTall.height);
      }
      if (painting.id === short.id) {
        return Math.max(maxY, swappedShort.y + swappedShort.height);
      }
      return Math.max(maxY, painting.y + painting.height);
    }, 0);

    if (currentMaxOccupiedY + 1e-6 >= swappedMaxOccupiedY) {
      failures.push({
        fixture: fixture.name,
        rule: 'depth-right-fence-max-depth',
        detail: `expected current arrangement to be shallower than opposite swap; current=${currentMaxOccupiedY.toFixed(3)} swapped=${swappedMaxOccupiedY.toFixed(3)}`,
      });
    }
  }
}

async function truncateReportFiles(reportPath: string, jsonPath: string) {
  await writeFile(reportPath, '', 'utf8');
  await writeFile(jsonPath, '', 'utf8');
}

function formatHandleDiagnostics() {
  const getActiveHandles = (process as NodeJS.Process & { _getActiveHandles?: () => unknown[] })._getActiveHandles;
  const getActiveRequests = (process as NodeJS.Process & { _getActiveRequests?: () => unknown[] })._getActiveRequests;
  const handles = typeof getActiveHandles === 'function' ? getActiveHandles() : [];
  const requests = typeof getActiveRequests === 'function' ? getActiveRequests() : [];

  return {
    handles: handles.map((handle) => {
      const typedHandle = handle as { constructor?: { name?: string }; toString?: () => string };
      return typedHandle.constructor?.name ?? typedHandle.toString?.() ?? 'UnknownHandle';
    }),
    requests: requests.map((request) => {
      const typedRequest = request as { constructor?: { name?: string }; toString?: () => string };
      return typedRequest.constructor?.name ?? typedRequest.toString?.() ?? 'UnknownRequest';
    }),
  };
}

function scheduleTerminationDiagnostics(runLabel: string) {
  const watchdog = setTimeout(() => {
    const diagnostics = formatHandleDiagnostics();
    if (diagnostics.handles.length === 0 && diagnostics.requests.length === 0) {
      return;
    }

    process.stderr.write(`Active handle diagnostics after ${runLabel}\n`);
    process.stderr.write(`Handles: ${diagnostics.handles.join(', ') || 'none'}\n`);
    process.stderr.write(`Requests: ${diagnostics.requests.join(', ') || 'none'}\n`);
  }, 1000);

  watchdog.unref();
}

async function readJsonReport(jsonPath: string) {
  const content = await readFile(jsonPath, 'utf8');
  return JSON.parse(content) as {
    result: 'PASS' | 'FAIL';
    passed: number;
    failed: number;
    skipped: number;
    durationMs: number;
    fixtureFilter: string | null;
    fixturesRun: number;
    fixturesSkipped: number;
    fixtures: Array<{
      name: string;
      result: 'PASS' | 'FAIL';
      durationMs: number;
      checks: CheckRunResult[];
      failureCount: number;
    }>;
    failures: Array<{
      fixture: string;
      rule: string;
      expected: string;
      actual: string;
      detail: string;
    }>;
    exitStatus: number;
    generatedAt: string;
    reportPath: string;
    jsonPath: string;
    runMode?: RunMode;
  };
}

async function runFixtureInChildProcess(fixtureName: string, timeoutMs: number) {
  const reportPath = 'optimizer-verification-report.txt';
  const jsonPath = 'optimizer-verification-report.json';
  const child = spawn(process.execPath, ['./node_modules/tsx/dist/cli.mjs', 'scripts/verify-optimizer.ts', '--quiet', '--fixture', fixtureName], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      OPTIMIZER_DETERMINISTIC: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString('utf8');
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });

  const closeInfo = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      resolve({ code, signal });
    });
  });

  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    child.kill();
    const forceHandle = setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }, 1000);
    forceHandle.unref();
  }, timeoutMs);
  timeoutHandle.unref();

  const closeResult = await closeInfo;
  clearTimeout(timeoutHandle);

  let report: Awaited<ReturnType<typeof readJsonReport>> | null = null;
  if (!timedOut) {
    try {
      report = await readJsonReport(jsonPath);
    } catch {
      report = null;
    }
  }

  return {
    timedOut,
    code: closeResult.code,
    signal: closeResult.signal,
    stdout,
    stderr,
    report,
    reportPath,
    jsonPath,
  };
}

function buildTimeoutFailure(fixtureName: string, timeoutMs: number): Failure {
  return {
    fixture: fixtureName,
    rule: 'fixture-timeout',
    detail: `fixture ${fixtureName} timed out after ${timeoutMs}ms`,
  };
}

function parseCliOptions(argv: string[]): CliOptions {
  let quiet = false;
  let fixture: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--quiet') {
      quiet = true;
      continue;
    }

    if (arg === '--fixture') {
      fixture = argv[i + 1] ?? null;
      i += 1;
    }
  }

  return { quiet, fixture };
}

function parseExpectedActual(detail: string) {
  const match = detail.match(/expected\s+(.+?)\s+got\s+(.+)/i);
  if (match) {
    return {
      expected: match[1].trim(),
      actual: match[2].trim(),
    };
  }

  return {
    expected: 'see rule details in report',
    actual: detail,
  };
}

function runCheck(name: string, failures: Failure[], execute: () => void): CheckRunResult {
  const before = failures.length;
  const startedAt = Date.now();
  execute();
  return {
    name,
    passed: failures.length === before,
    failureCount: failures.length - before,
    durationMs: Date.now() - startedAt,
  };
}

function runFixtureSuite(fixture: Fixture, failures: Failure[]): FixtureRunResult {
  const beforeFixture = failures.length;
  const startedAt = Date.now();
  const checks: CheckRunResult[] = [];

  const finalLayout = generateLayout(fixture.order);
  const paintingsOnlyLayout = generateLayoutWithoutExtraSamples(fixture.order);

  checks.push(runCheck('spacing', failures, () => validateSpacing(finalLayout, failures, fixture.name)));
  checks.push(runCheck('bounds', failures, () => validateBounds(finalLayout, failures, fixture.name)));
  checks.push(runCheck('orientation', failures, () => validateOrientation(finalLayout, fixture, failures)));
  checks.push(runCheck('table-count', failures, () => validateTableCount(finalLayout, fixture, failures)));
  checks.push(runCheck('gap-analysis', failures, () => validateGapQuality(paintingsOnlyLayout, fixture, failures)));
  checks.push(runCheck('extra-samples', failures, () => validateExtraSamples(finalLayout, paintingsOnlyLayout, fixture, failures)));
  checks.push(runCheck('pdf-coordinate-parity', failures, () => validatePdfCoordinateParity(finalLayout, failures, fixture.name)));
  checks.push(runCheck('sample-semantics', failures, () => validateSampleSemantics(finalLayout, fixture.name, failures)));
  checks.push(runCheck('depth-aware-right-fence', failures, () => validateDepthAwareRightFenceStacking(finalLayout, fixture, failures)));

  const fixtureFailures = failures.slice(beforeFixture).filter((failure) => failure.fixture === fixture.name);
  return {
    fixture: fixture.name,
    passed: fixtureFailures.length === 0,
    skipped: false,
    durationMs: Date.now() - startedAt,
    checks,
    failures: fixtureFailures,
  };
}

function buildTextReport(params: {
  runMode: RunMode;
  options: CliOptions;
  fixtureResults: FixtureRunResult[];
  failures: Failure[];
  totalChecksPassed: number;
  totalChecksFailed: number;
  totalChecksSkipped: number;
  durationMs: number;
  selectedFixtureCount: number;
  skippedFixtureCount: number;
  result: 'PASS' | 'FAIL';
  reportPath: string;
  jsonPath: string;
}) {
  const lines: string[] = [];
  const now = new Date();

  lines.push('Optimizer verification report');
  lines.push(`Timestamp: ${now.toISOString()}`);
  lines.push(`RunMode: ${params.runMode}`);
  lines.push(`Mode: ${params.options.quiet ? 'quiet' : 'normal'}`);
  lines.push(`Fixture filter: ${params.options.fixture ?? 'all'}`);
  lines.push('');
  lines.push('Fixture execution');

  for (const fixtureResult of params.fixtureResults) {
    lines.push(`Fixture: ${fixtureResult.fixture}`);
    lines.push(`Result: ${fixtureResult.passed ? 'PASS' : 'FAIL'}`);
    lines.push(`RuntimeMs: ${fixtureResult.durationMs}`);
    for (const check of fixtureResult.checks) {
      lines.push(`Check ${check.name}: ${check.passed ? 'PASS' : 'FAIL'} (failures=${check.failureCount}, runtimeMs=${check.durationMs})`);
    }
    lines.push('');
  }

  if (params.failures.length > 0) {
    lines.push('Failure details');
    for (const failure of params.failures) {
      const parsed = parseExpectedActual(failure.detail);
      lines.push(`Fixture: ${failure.fixture}`);
      lines.push(`Rule: ${failure.rule}`);
      lines.push(`Expected: ${parsed.expected}`);
      lines.push(`Actual: ${parsed.actual}`);
      lines.push('');
    }
  }

  lines.push('Optimizer verification');
  lines.push(`Passed: ${params.totalChecksPassed}`);
  lines.push(`Failed: ${params.totalChecksFailed}`);
  lines.push(`Skipped: ${params.totalChecksSkipped}`);
  lines.push(`FixturesRun: ${params.selectedFixtureCount}`);
  lines.push(`FixturesSkipped: ${params.skippedFixtureCount}`);
  lines.push(`DurationMs: ${params.durationMs}`);
  lines.push(`Result: ${params.result}`);
  lines.push(`ExitStatus: ${params.result === 'PASS' ? 0 : 1}`);
  lines.push(`TextReport: ${params.reportPath}`);
  lines.push(`JsonReport: ${params.jsonPath}`);

  return `${lines.join('\n')}\n`;
}

const fixtures: Fixture[] = [
  {
    name: 'one-painting',
    order: [makePainting(1, 30, 20, 'VERT')],
    expectedMaxTables: 1,
    expectLegalExtraSamples: 'some',
  },
  {
    name: 'identical-size',
    order: [
      makePainting(1, 24, 18, 'VERT'),
      makePainting(2, 24, 18, 'VERT'),
      makePainting(3, 24, 18, 'VERT'),
    ],
    expectedMaxTables: 1,
  },
  {
    name: 'mixed-large-small',
    order: [
      makePainting(1, 48, 36, 'VERT'),
      makePainting(2, 42, 30, 'HORI'),
      makePainting(3, 18, 12, 'HORI'),
    ],
  },
  {
    name: 'around-required-sample',
    order: [
      makePainting(1, 12, 10, 'VERT'),
      makePainting(2, 12, 12, 'HORI'),
      makePainting(3, 10, 8, 'VERT'),
    ],
    expectedMaxTables: 1,
  },
  {
    name: 'known-one-table',
    order: [
      makePainting(1, 36, 24, 'VERT'),
      makePainting(2, 30, 24, 'VERT'),
      makePainting(3, 20, 14, 'VERT'),
    ],
    expectedMaxTables: 1,
  },
  {
    name: 'known-multi-table',
    order: [
      makePainting(1, 58, 46, 'VERT'),
      makePainting(2, 56, 44, 'HORI'),
      makePainting(3, 54, 42, 'VERT'),
    ],
    expectedMinTables: 2,
  },
  {
    name: 'depth-aware-right-fence',
    order: [
      makePainting(1, 40, 48, 'VERT'),
      makePainting(2, 28, 56, 'VERT'),
      makePainting(3, 28, 47, 'VERT'),
    ],
    expectedMaxTables: 1,
  },
  {
    name: 'extra-sample-possible',
    order: [
      makePainting(1, 30, 20, 'VERT'),
      makePainting(2, 24, 16, 'HORI'),
    ],
    expectLegalExtraSamples: 'some',
  },
  {
    name: 'extra-sample-none-expected',
    order: [
      makePainting(1, 62, 50, 'VERT'),
      makePainting(2, 58, 44, 'HORI'),
    ],
    expectLegalExtraSamples: 'some',
  },
  {
    name: 'floating-regression-case',
    order: [
      makePainting(1, 38, 26, 'VERT'),
      makePainting(2, 32, 24, 'HORI'),
      makePainting(3, 16, 12, 'HORI'),
    ],
  },
  {
    name: 'unnecessary-second-table-regression',
    order: [
      makePainting(1, 40, 30, 'VERT'),
      makePainting(2, 34, 26, 'HORI'),
      makePainting(3, 24, 18, 'VERT'),
    ],
    expectedMaxTables: 1,
  },
  {
    name: 'spacing-boundary-close',
    order: [
      makePainting(1, 12, 8, 'VERT'),
      makePainting(2, 12, 8, 'VERT'),
      makePainting(3, 10, 8, 'VERT'),
    ],
  },
];

async function main() {
  const reportPath = 'optimizer-verification-report.txt';
  const jsonPath = 'optimizer-verification-report.json';
  const startedAt = Date.now();
  const options = parseCliOptions(process.argv.slice(2));
  await truncateReportFiles(reportPath, jsonPath);

  if (!options.fixture) {
    const fixtureResults: FixtureRunResult[] = [];
    const failures: Failure[] = [];
    let totalChecksPassed = 0;
    let totalChecksFailed = 0;
    let totalChecksSkipped = 0;

    for (const fixture of fixtures) {
      await truncateReportFiles(reportPath, jsonPath);
      const child = await runFixtureInChildProcess(fixture.name, FIXTURE_TIMEOUT_MS);

      if (child.timedOut) {
        const timeoutFailure = buildTimeoutFailure(fixture.name, FIXTURE_TIMEOUT_MS);
        failures.push(timeoutFailure);
        fixtureResults.push({
          fixture: fixture.name,
          passed: false,
          skipped: false,
          durationMs: FIXTURE_TIMEOUT_MS,
          checks: [
            {
              name: 'fixture-timeout',
              passed: false,
              failureCount: 1,
              durationMs: FIXTURE_TIMEOUT_MS,
            },
          ],
          failures: [timeoutFailure],
        });
        totalChecksFailed += 1;
        if (!options.quiet) {
          process.stdout.write(`FAIL ${fixture.name}\n`);
        }
        continue;
      }

      if (!child.report || child.report.fixtures.length === 0) {
        const detail = `fixture ${fixture.name} completed without a readable report (exitCode=${child.code ?? 'null'}, signal=${child.signal ?? 'null'})`;
        const failure: Failure = {
          fixture: fixture.name,
          rule: 'fixture-runner-crash',
          detail,
        };
        failures.push(failure);
        fixtureResults.push({
          fixture: fixture.name,
          passed: false,
          skipped: false,
          durationMs: 0,
          checks: [
            {
              name: 'fixture-runner-crash',
              passed: false,
              failureCount: 1,
              durationMs: 0,
            },
          ],
          failures: [failure],
        });
        totalChecksFailed += 1;
        if (!options.quiet) {
          process.stdout.write(`FAIL ${fixture.name}\n`);
        }
        continue;
      }

      const childFixture = child.report.fixtures[0];
      const childFailures = child.report.failures.map((failure) => ({
        fixture: failure.fixture,
        rule: failure.rule,
        detail: failure.detail,
      }));

      fixtureResults.push({
        fixture: childFixture.name,
        passed: childFixture.result === 'PASS',
        skipped: false,
        durationMs: childFixture.durationMs,
        checks: childFixture.checks,
        failures: childFailures,
      });

      failures.push(...childFailures);
      totalChecksPassed += child.report.passed;
      totalChecksFailed += child.report.failed;
      totalChecksSkipped += child.report.skipped;

      if (!options.quiet) {
        process.stdout.write(`${childFixture.result === 'PASS' ? 'PASS' : 'FAIL'} ${childFixture.name}\n`);
      }
    }

    const durationMs = Date.now() - startedAt;
    const result: 'PASS' | 'FAIL' = totalChecksFailed > 0 ? 'FAIL' : 'PASS';
    const report = buildTextReport({
      runMode: 'full-suite',
      options: { quiet: options.quiet, fixture: null },
      fixtureResults,
      failures,
      totalChecksPassed,
      totalChecksFailed,
      totalChecksSkipped,
      durationMs,
      selectedFixtureCount: fixtures.length,
      skippedFixtureCount: 0,
      result,
      reportPath,
      jsonPath,
    });

    const jsonReport = {
      result,
      runMode: 'full-suite' as RunMode,
      passed: totalChecksPassed,
      failed: totalChecksFailed,
      skipped: totalChecksSkipped,
      durationMs,
      fixtureFilter: null,
      fixturesRun: fixtures.length,
      fixturesSkipped: 0,
      fixtures: fixtureResults.map((fixtureResult) => ({
        name: fixtureResult.fixture,
        result: fixtureResult.passed ? 'PASS' : 'FAIL',
        durationMs: fixtureResult.durationMs,
        checks: fixtureResult.checks,
        failureCount: fixtureResult.failures.length,
      })),
      failures: failures.map((failure) => {
        const parsed = parseExpectedActual(failure.detail);
        return {
          fixture: failure.fixture,
          rule: failure.rule,
          expected: parsed.expected,
          actual: parsed.actual,
          detail: failure.detail,
        };
      }),
      exitStatus: result === 'PASS' ? 0 : 1,
      generatedAt: new Date().toISOString(),
      reportPath,
      jsonPath,
    };

    await writeFile(reportPath, report, 'utf8');
    await writeFile(jsonPath, `${JSON.stringify(jsonReport, null, 2)}\n`, 'utf8');

    process.stdout.write(`Optimizer verification: ${result}\n`);
    process.exitCode = totalChecksFailed > 0 ? 1 : 0;
    scheduleTerminationDiagnostics('full-suite verification');
    return;
  }

  const failures: Failure[] = [];
  const selectedFixtures = options.fixture
    ? fixtures.filter((fixture) => fixture.name.toLowerCase() === options.fixture?.toLowerCase())
    : fixtures;

  if (options.fixture && selectedFixtures.length === 0) {
    failures.push({
      fixture: options.fixture,
      rule: 'fixture-not-found',
      detail: `expected one matching fixture name, got none for '${options.fixture}'`,
    });
  }

  const fixtureResults: FixtureRunResult[] = [];
  const globalChecks: CheckRunResult[] = [];

  globalChecks.push(runCheck('table-dimensions-constant', failures, () => validateTableDimensionsConstant(failures)));

  for (const fixture of selectedFixtures) {
    const fixtureResult = runFixtureSuite(fixture, failures);
    fixtureResults.push(fixtureResult);
    if (!options.quiet) {
      process.stdout.write(`${fixtureResult.passed ? 'PASS' : 'FAIL'} ${fixtureResult.fixture}\n`);
      if (!fixtureResult.passed) {
        for (const failure of fixtureResult.failures) {
          const parsed = parseExpectedActual(failure.detail);
          process.stdout.write(
            `Failure fixture=${failure.fixture} rule=${failure.rule} expected=${parsed.expected} actual=${parsed.actual} report=${reportPath}\n`
          );
        }
      }
    }
  }

  const determinismFixture = fixtures.find((fixture) => fixture.name === 'one-painting') ?? selectedFixtures[0];
  if (determinismFixture) {
    globalChecks.push(runCheck('determinism', failures, () => validateDeterminism(determinismFixture, failures)));
  }

  if (!options.fixture) {
    globalChecks.push(runCheck('print-travel-preference', failures, () => validatePrintTravelPreference(failures)));
  }

  const totalCheckResults = [
    ...globalChecks,
    ...fixtureResults.flatMap((fixtureResult) => fixtureResult.checks),
  ];
  const totalChecksPassed = totalCheckResults.filter((check) => check.passed).length;
  const totalChecksFailed = totalCheckResults.filter((check) => !check.passed).length;
  const totalChecksSkipped = 0;
  const failedFixtureCount = fixtureResults.filter((fixtureResult) => !fixtureResult.passed).length;
  const passedFixtureCount = fixtureResults.filter((fixtureResult) => fixtureResult.passed).length;
  const skippedFixtureCount = fixtures.length - selectedFixtures.length;
  const result: 'PASS' | 'FAIL' = failures.length === 0 ? 'PASS' : 'FAIL';
  const durationMs = Date.now() - startedAt;

  const report = buildTextReport({
    runMode: 'fixture-filtered',
    options,
    fixtureResults,
    failures,
    totalChecksPassed,
    totalChecksFailed,
    totalChecksSkipped,
    durationMs,
    selectedFixtureCount: selectedFixtures.length,
    skippedFixtureCount,
    result,
    reportPath,
    jsonPath,
  });

  const jsonReport = {
    result,
    runMode: 'fixture-filtered' as RunMode,
    passed: totalChecksPassed,
    failed: totalChecksFailed,
    skipped: totalChecksSkipped,
    durationMs,
    fixtureFilter: options.fixture,
    fixturesRun: selectedFixtures.length,
    fixturesSkipped: skippedFixtureCount,
    fixtures: fixtureResults.map((fixtureResult) => ({
      name: fixtureResult.fixture,
      result: fixtureResult.passed ? 'PASS' : 'FAIL',
      durationMs: fixtureResult.durationMs,
      checks: fixtureResult.checks,
      failureCount: fixtureResult.failures.length,
    })),
    failures: failures.map((failure) => {
      const parsed = parseExpectedActual(failure.detail);
      return {
        fixture: failure.fixture,
        rule: failure.rule,
        expected: parsed.expected,
        actual: parsed.actual,
        detail: failure.detail,
      };
    }),
    exitStatus: result === 'PASS' ? 0 : 1,
    generatedAt: new Date().toISOString(),
    reportPath,
    jsonPath,
  };

  await writeFile(reportPath, report, 'utf8');
  await writeFile(jsonPath, `${JSON.stringify(jsonReport, null, 2)}\n`, 'utf8');

  if (options.quiet) {
    process.stdout.write(`Optimizer verification: ${result}\n`);
  } else {
    process.stdout.write(`Optimizer verification: ${passedFixtureCount} passed, ${failedFixtureCount} failed\n`);
  }

  process.exitCode = totalChecksFailed > 0 ? 1 : 0;
  scheduleTerminationDiagnostics('fixture-filtered verification');
}

main().catch(async (error) => {
  const reportPath = 'optimizer-verification-report.txt';
  const jsonPath = 'optimizer-verification-report.json';
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  const emergency = [
    'Optimizer verification report',
    `Timestamp: ${new Date().toISOString()}`,
    'Result: FAIL',
    'FailureType: runner-exception',
    `Detail: ${message}`,
    `TextReport: ${reportPath}`,
    `JsonReport: ${jsonPath}`,
  ].join('\n');
  await writeFile(reportPath, `${emergency}\n`, 'utf8');
  await writeFile(
    jsonPath,
    `${JSON.stringify({
      result: 'FAIL',
      passed: 0,
      failed: 1,
      skipped: 0,
      durationMs: 0,
      fixtures: [],
      failures: [{ fixture: 'runner', rule: 'exception', expected: 'no exception', actual: message }],
      generatedAt: new Date().toISOString(),
      reportPath,
      jsonPath,
    }, null, 2)}\n`,
    'utf8'
  );
  process.stdout.write('Optimizer verification: FAIL\n');
  process.stdout.write(`See ${reportPath}\n`);
  process.exitCode = 1;
});
