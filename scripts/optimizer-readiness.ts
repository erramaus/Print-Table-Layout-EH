import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateLayout } from '../src/optimizer/layoutEngine';
import type { LayoutResult, Painting, PlacedPainting } from '../src/optimizer/types';
import { MM_PER_INCH, TABLE_HEIGHT_MM, TABLE_WIDTH_MM } from '../src/constants/tableDimensions';

interface Fixture {
  name: string;
  order: Painting[];
}

interface FixtureReport {
  fixture: string;
  inputPaintings: Painting[];
  tablesUsed: number;
  paintingCoordinates: Array<{
    id: string;
    referenceNumber: string;
    tableNumber: number;
    xMm: number;
    yMm: number;
    widthMm: number;
    heightMm: number;
    orientation: 'VERTICAL' | 'HORIZONTAL';
  }>;
  extraSampleCount: number;
  normalizedLayoutHash: string;
  debugSvg: string;
}

interface RuntimeReport {
  paintingCount: number;
  elapsedMs: number;
  tablesUsed: number;
}

function makePainting(index: number, width: number, height: number, orientation: 'VERT' | 'HORI'): Painting {
  return {
    id: `fixture-${index}`,
    referenceNumber: `#${String(index).padStart(2, '0')}`,
    name: `P${index}`,
    width,
    height,
    orientation,
    color: '#336699',
  };
}

function mm(valueInches: number) {
  return valueInches * MM_PER_INCH;
}

function normalizeLayoutForHash(layout: LayoutResult) {
  const normalizedTables = [...layout.tables]
    .sort((a, b) => a.tableNumber - b.tableNumber)
    .map((table) => ({
      tableNumber: table.tableNumber,
      items: [...table.paintings]
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
          sampleType: p.sampleType ?? null,
        })),
    }));

  return JSON.stringify(normalizedTables);
}

function hashLayout(layout: LayoutResult) {
  return createHash('sha256').update(normalizeLayoutForHash(layout)).digest('hex');
}

function makeDebugSvg(layout: LayoutResult) {
  const tablePadding = 36;
  const scale = 0.16;
  const tableWidthPx = TABLE_WIDTH_MM * scale;
  const tableHeightPx = TABLE_HEIGHT_MM * scale;
  const totalWidth = layout.tables.length * (tableWidthPx + tablePadding) + tablePadding;
  const totalHeight = tableHeightPx + tablePadding * 2;

  const tableSvgs = layout.tables
    .map((table, tableIndex) => {
      const ox = tablePadding + tableIndex * (tableWidthPx + tablePadding);
      const oy = tablePadding;

      const visiblePaintings = table.paintings.filter((placement) => placement.sampleType !== 'extra');
      const paintingBlocks = visiblePaintings
        .map((placement) => {
          const x = ox + (TABLE_WIDTH_MM - (mm(placement.x) + mm(placement.width))) * scale;
          const y = oy + (TABLE_HEIGHT_MM - (mm(placement.y) + mm(placement.height))) * scale;
          const w = mm(placement.width) * scale;
          const h = mm(placement.height) * scale;
          const fill =
            placement.sampleType === 'required'
              ? '#c4b5fd'
              : placement.sampleType === 'extra'
                ? '#ddd6fe'
                : '#93c5fd';
          const label =
            placement.sampleType === 'required'
              ? 'SAMPLE FIXED'
              : placement.sampleType === 'extra'
                ? 'SAMPLE'
                : placement.referenceNumber;

          return [
            `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" stroke="#1f2937" stroke-width="1" />`,
            `<text x="${(x + 2).toFixed(1)}" y="${(y + 11).toFixed(1)}" font-size="9" fill="#111827">${label}</text>`,
          ].join('');
        })
        .join('');

      return [
        `<g>`,
        `<rect x="${ox}" y="${oy}" width="${tableWidthPx.toFixed(1)}" height="${tableHeightPx.toFixed(1)}" fill="#f8fafc" stroke="#334155" stroke-width="2" />`,
        `<text x="${ox}" y="${(oy - 8).toFixed(1)}" font-size="12" fill="#0f172a">Table ${table.tableNumber}</text>`,
        paintingBlocks,
        `</g>`,
      ].join('');
    })
    .join('');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(totalWidth)}" height="${Math.ceil(totalHeight)}" viewBox="0 0 ${Math.ceil(totalWidth)} ${Math.ceil(totalHeight)}">`,
    `<rect x="0" y="0" width="100%" height="100%" fill="#ffffff" />`,
    tableSvgs,
    `</svg>`,
  ].join('');
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function makeRandomOrder(count: number, seed: number): Painting[] {
  const rand = seededRandom(seed);
  const order: Painting[] = [];

  for (let i = 0; i < count; i += 1) {
    // Performance probe set: near-max dimensions keep branching bounded and make 10/25/50/100 sweeps practical.
    const width = 66 + Math.floor(rand() * 4);
    const height = 54 + Math.floor(rand() * 4);
    const orientation: 'VERT' | 'HORI' = rand() > 0.5 ? 'VERT' : 'HORI';
    order.push({
      id: `perf-${count}-${i + 1}`,
      referenceNumber: `#${String(i + 1).padStart(3, '0')}`,
      name: `Perf ${i + 1}`,
      width,
      height,
      orientation,
      color: '#64748b',
    });
  }

  return order;
}

function toCoordinate(p: PlacedPainting) {
  return {
    id: p.id,
    referenceNumber: p.sampleType === 'required' ? 'SAMPLE' : p.referenceNumber,
    tableNumber: p.tableNumber,
    xMm: Number(mm(p.x).toFixed(3)),
    yMm: Number(mm(p.y).toFixed(3)),
    widthMm: Number(mm(p.width).toFixed(3)),
    heightMm: Number(mm(p.height).toFixed(3)),
    orientation: p.orientation,
  };
}

const fixtures: Fixture[] = [
  {
    name: 'one-painting',
    order: [makePainting(1, 30, 20, 'VERT')],
  },
  {
    name: 'two-identical-paintings',
    order: [makePainting(1, 24, 18, 'VERT'), makePainting(2, 24, 18, 'VERT')],
  },
  {
    name: 'mixed-large-small',
    order: [makePainting(1, 48, 36, 'VERT'), makePainting(2, 40, 28, 'HORI'), makePainting(3, 16, 12, 'HORI')],
  },
  {
    name: 'front-fence-fill',
    order: [makePainting(1, 42, 12, 'VERT'), makePainting(2, 38, 12, 'VERT'), makePainting(3, 34, 12, 'VERT')],
  },
  {
    name: 'right-fence-fill',
    order: [makePainting(1, 12, 44, 'VERT'), makePainting(2, 12, 40, 'VERT'), makePainting(3, 12, 36, 'VERT')],
  },
  {
    name: 'extra-sample-positions-available',
    order: [makePainting(1, 30, 20, 'VERT'), makePainting(2, 22, 14, 'HORI')],
  },
  {
    name: 'no-extra-sample-positions-available',
    order: [makePainting(1, 62, 50, 'VERT'), makePainting(2, 58, 44, 'HORI'), makePainting(3, 48, 40, 'VERT')],
  },
  {
    name: 'known-one-table-job',
    order: [makePainting(1, 36, 24, 'VERT'), makePainting(2, 30, 24, 'VERT'), makePainting(3, 20, 14, 'VERT')],
  },
  {
    name: 'true-multi-table-job',
    order: [makePainting(1, 58, 46, 'VERT'), makePainting(2, 56, 44, 'HORI'), makePainting(3, 54, 42, 'VERT')],
  },
  {
    name: 'floating-painting-regression',
    order: [makePainting(1, 38, 26, 'VERT'), makePainting(2, 32, 24, 'HORI'), makePainting(3, 16, 12, 'HORI')],
  },
];

function runFixtureSet(outDir: string) {
  const fixtureReports: FixtureReport[] = [];

  for (const fixture of fixtures) {
    const layout = generateLayout(fixture.order);
    const extraSampleCount = layout.placements.filter((placement) => placement.sampleType === 'extra').length;
    const paintingCoordinates = layout.placements
      .filter((placement) => placement.sampleType !== 'extra')
      .map(toCoordinate);

    const svgFile = `${fixture.name}.svg`;
    writeFileSync(join(outDir, svgFile), makeDebugSvg(layout), 'utf8');

    fixtureReports.push({
      fixture: fixture.name,
      inputPaintings: fixture.order,
      tablesUsed: layout.tables.length,
      paintingCoordinates,
      extraSampleCount,
      normalizedLayoutHash: hashLayout(layout),
      debugSvg: svgFile,
    });
  }

  return fixtureReports;
}

function runPerformanceSet(outDir: string) {
  const counts = [10, 25, 50, 100];
  const results: RuntimeReport[] = [];
  const isDevMode = process.env.NODE_ENV !== 'production';

  for (const count of counts) {
    const order = makeRandomOrder(count, count * 97 + 13);
    const t0 = Date.now();
    const layout = generateLayout(order);
    const elapsedMs = Date.now() - t0;

    results.push({
      paintingCount: count,
      elapsedMs: Number(elapsedMs.toFixed(2)),
      tablesUsed: layout.tables.length,
    });

    writeFileSync(
      join(outDir, 'runtime-progress.json'),
      `${JSON.stringify({ generatedAt: new Date().toISOString(), runtime: results }, null, 2)}\n`,
      'utf8'
    );

    if (isDevMode) {
      process.stdout.write(`PERF paintings=${count} elapsedMs=${elapsedMs.toFixed(2)} tables=${layout.tables.length}\n`);
    }
  }

  return results;
}

function main() {
  const outDir = join(process.cwd(), 'artifacts', 'optimizer-readiness');
  mkdirSync(outDir, { recursive: true });

  const fixtureReports = runFixtureSet(outDir);
  writeFileSync(
    join(outDir, 'fixtures-report.json'),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), fixtures: fixtureReports }, null, 2)}\n`,
    'utf8'
  );

  const runtimeReports = runPerformanceSet(outDir);

  const report = {
    generatedAt: new Date().toISOString(),
    fixtures: fixtureReports,
    runtime: runtimeReports,
  };

  writeFileSync(join(outDir, 'readiness-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`Saved readiness report to ${join(outDir, 'readiness-report.json')}\n`);
}

main();
