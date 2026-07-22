import type { LayoutResult, Painting, PlacedPainting } from './types';

const TABLE_WIDTH_INCHES = 96;
const TABLE_HEIGHT_INCHES = 80;
const SAMPLE_WIDTH_INCHES = 6;
const SAMPLE_HEIGHT_INCHES = 8;
const SPACING_INCHES = 1;

function getDrawDimensions(painting: Painting) {
  if (painting.orientation === 'HORIZONTAL') {
    return {
      width: painting.height,
      height: painting.width,
    };
  }

  return {
    width: painting.width,
    height: painting.height,
  };
}

export function generateLayout(order: Painting[]): LayoutResult {
  const samplePainting: PlacedPainting = {
    id: '-1',
    referenceNumber: 'SAMPLE',
    name: 'SAMPLE',
    width: SAMPLE_WIDTH_INCHES,
    height: SAMPLE_HEIGHT_INCHES,
    orientation: 'VERTICAL',
    rotated: false,
    tableNumber: 1,
    x: 0,
    y: 0,
    color: '#8b5cf6',
  };

  const tables: LayoutResult['tables'] = [
    {
      tableNumber: 1,
      paintings: [samplePainting],
    },
  ];

  const placements: PlacedPainting[] = [samplePainting];
  let currentTableNumber = 1;
  let currentRowY = 0;
  let currentRowHeight = 0;
  let currentX = SAMPLE_WIDTH_INCHES + SPACING_INCHES;

  function startNewTable() {
    currentTableNumber += 1;
    currentRowY = 0;
    currentRowHeight = 0;
    currentX = 0;
    tables.push({
      tableNumber: currentTableNumber,
      paintings: [],
    });
  }

  order.forEach((painting) => {
    const { width, height } = getDrawDimensions(painting);
    const rowStartX = currentTableNumber === 1 && currentRowY === 0 ? SAMPLE_WIDTH_INCHES + SPACING_INCHES : 0;

    if (currentX + width > TABLE_WIDTH_INCHES) {
      const nextRowY = currentRowY + currentRowHeight + SPACING_INCHES;
      const canContinueSameTable = nextRowY + height <= TABLE_HEIGHT_INCHES;

      if (canContinueSameTable) {
        currentRowY = nextRowY;
        currentRowHeight = 0;
        currentX = 0;
      } else {
        startNewTable();
      }
    }

    const placement: PlacedPainting = {
      id: painting.id,
      referenceNumber: painting.referenceNumber,
      name: painting.name,
      width,
      height,
      orientation: painting.orientation,
      rotated: false,
      tableNumber: currentTableNumber,
      x: currentX === 0 ? rowStartX : currentX,
      y: currentRowY,
      color: painting.color,
    };

    placements.push(placement);
    tables[tables.length - 1].paintings.push(placement);

    currentX = placement.x + width + SPACING_INCHES;
    currentRowHeight = Math.max(currentRowHeight, height);
  });

  return {
    tables,
    placements,
    messages: [
      'Reserved the sample rectangle in the front-right corner.',
      `Placed ${order.length} painting(s) across ${tables.length} table(s).`,
    ],
  };
}
