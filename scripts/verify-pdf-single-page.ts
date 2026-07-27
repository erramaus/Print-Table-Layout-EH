import { PDFDocument } from 'pdf-lib';
import { createLayoutPdf } from '../src/utils/pdfExport';
import { generateLayout } from '../src/optimizer/layoutEngine';
import type { Painting } from '../src/optimizer/types';

function makePainting(index: number, width: number, height: number, orientation: 'VERT' | 'HORI'): Painting {
  return {
    id: `pdf-${index}`,
    referenceNumber: `#${String(index).padStart(2, '0')}`,
    name: `P${index}`,
    width,
    height,
    orientation,
    color: '#336699',
  };
}

function buildStats(order: Painting[], tableCount: number) {
  const totalArea = order.reduce((sum, painting) => sum + painting.width * painting.height, 0);
  return {
    totalPaintings: order.length,
    totalArea,
    wasteArea: 0,
    wastePercentage: 0,
    generatedDate: new Date().toISOString(),
    tableCount,
  };
}

async function verifyFixture(name: string, order: Painting[]) {
  const layout = generateLayout(order);
  const stats = buildStats(order, layout.tables.length);

  const bytes = await createLayoutPdf({
    layout,
    totalPaintings: stats.totalPaintings,
    totalArea: stats.totalArea,
    wasteArea: stats.wasteArea,
    wastePercentage: stats.wastePercentage,
    generatedDate: stats.generatedDate,
  });

  const pdf = await PDFDocument.load(bytes);
  const pageCount = pdf.getPageCount();

  if (pageCount !== 1) {
    throw new Error(`${name} expected one page, got ${pageCount}`);
  }

  console.log(`PASS ${name} single-page (${layout.tables.length} table(s))`);
}

async function main() {
  await verifyFixture('single-table', [makePainting(1, 30, 20, 'VERT')]);

  await verifyFixture('multi-table', [
    makePainting(1, 58, 46, 'VERT'),
    makePainting(2, 56, 44, 'HORI'),
    makePainting(3, 54, 42, 'VERT'),
  ]);

  console.log('PDF single-page verification passed');
}

main().catch((error) => {
  console.error('PDF single-page verification failed');
  console.error(error);
  process.exit(1);
});
