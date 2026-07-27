import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { LayoutResult, PlacedPainting } from '../optimizer/types';

const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const MARGIN = 40;
const TABLE_INCH_WIDTH = 98;
const TABLE_INCH_HEIGHT = 80;
const MM_PER_INCH = 25.4;
const TABLE_DRAW_WIDTH = 520;
const TABLE_DRAW_HEIGHT = (TABLE_DRAW_WIDTH / TABLE_INCH_WIDTH) * TABLE_INCH_HEIGHT;
const RULER_THICKNESS = 10;
const RULER_LABEL_GAP = 6;
const FOOTER_Y_OFFSET = 20;

interface PdfExportParams {
  layout: LayoutResult;
  totalPaintings: number;
  totalArea: number;
  wasteArea: number;
  wastePercentage: number;
  generatedDate: string;
}

function inchesToMm(value: number) {
  return value * MM_PER_INCH;
}

function formatMm(value: number) {
  return Math.round(value).toString();
}

function drawTableOutline(page: any, x: number, y: number, width: number, height: number) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    borderColor: rgb(0, 0, 0),
    borderWidth: 1.5,
    color: rgb(1, 1, 1),
  });
}

function drawBottomRuler(page: any, x: number, y: number, width: number) {
  const totalMm = inchesToMm(TABLE_INCH_WIDTH);
  page.drawLine({
    start: { x, y },
    end: { x: x + width, y },
    color: rgb(0.2, 0.2, 0.2),
    thickness: 1,
  });

  for (let mm = 0; mm <= totalMm; mm += 50) {
    const px = x + (mm / totalMm) * width;
    const isMajor = mm % 100 === 0;
    const tickHeight = isMajor ? 10 : 6;
    page.drawLine({
      start: { x: px, y },
      end: { x: px, y: y - tickHeight },
      color: rgb(0.2, 0.2, 0.2),
      thickness: 1,
    });
    if (isMajor) {
      page.drawText(formatMm(mm), {
        x: px - 8,
        y: y - tickHeight - 12,
        size: 9,
        font: page.getFont(),
        color: rgb(0.2, 0.2, 0.2),
      });
    }
  }
}

function drawRightRuler(page: any, x: number, y: number, height: number) {
  const totalMm = inchesToMm(TABLE_INCH_HEIGHT);
  page.drawLine({
    start: { x, y },
    end: { x, y: y + height },
    color: rgb(0.2, 0.2, 0.2),
    thickness: 1,
  });

  for (let mm = 0; mm <= totalMm; mm += 50) {
    const py = y + (mm / totalMm) * height;
    const isMajor = mm % 100 === 0;
    const tickWidth = isMajor ? 10 : 6;
    page.drawLine({
      start: { x, y: py },
      end: { x: x + tickWidth, y: py },
      color: rgb(0.2, 0.2, 0.2),
      thickness: 1,
    });
    if (isMajor) {
      page.drawText(formatMm(mm), {
        x: x + tickWidth + 2,
        y: py - 4,
        size: 9,
        font: page.getFont(),
        color: rgb(0.2, 0.2, 0.2),
      });
    }
  }
}

function drawPaintingBlock(page: any, painting: PlacedPainting, x: number, y: number, scale: number, font: any) {
  const rectX = x + painting.x * scale;
  const rectY = y + painting.y * scale;
  const rectWidth = painting.width * scale;
  const rectHeight = painting.height * scale;

  page.drawRectangle({
    x: rectX,
    y: rectY,
    width: rectWidth,
    height: rectHeight,
    color: rgb(0.94, 0.94, 0.94),
    borderColor: rgb(0, 0, 0),
    borderWidth: 1,
  });

  if (painting.referenceNumber === 'SAMPLE') {
    page.drawRectangle({
      x: rectX,
      y: rectY,
      width: rectWidth,
      height: rectHeight,
      color: rgb(0.55, 0.29, 0.89),
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
  } else {
    try {
      const color = rgb(
        parseInt(painting.color.slice(1, 3), 16) / 255,
        parseInt(painting.color.slice(3, 5), 16) / 255,
        parseInt(painting.color.slice(5, 7), 16) / 255
      );
      page.drawRectangle({
        x: rectX,
        y: rectY,
        width: rectWidth,
        height: rectHeight,
        color,
        borderColor: rgb(0, 0, 0),
        borderWidth: 1,
      });
    } catch {
      page.drawRectangle({
        x: rectX,
        y: rectY,
        width: rectWidth,
        height: rectHeight,
        color: rgb(0.75, 0.75, 0.75),
        borderColor: rgb(0, 0, 0),
        borderWidth: 1,
      });
    }
  }

  const label = painting.referenceNumber;
  const textSize = Math.min(12, rectWidth / (label.length * 0.5));
  page.drawText(label, {
    x: rectX + 4,
    y: rectY + rectHeight - textSize - 4,
    size: textSize,
    font,
    color: rgb(0, 0, 0),
  });
}

function drawFooter(page: any, generatedDate: string, pageNumber: number, totalPages: number, font: any, fontBold: any) {
  const footerY = MARGIN - FOOTER_Y_OFFSET;
  const footerText = `Print Table Optimizer · Generated date/time: ${generatedDate}`;
  page.drawText(footerText, {
    x: MARGIN,
    y: footerY,
    size: 9,
    font,
    color: rgb(0.2, 0.2, 0.2),
  });
  page.drawText(`Page ${pageNumber} of ${totalPages}`, {
    x: PAGE_WIDTH - MARGIN - 120,
    y: footerY,
    size: 9,
    font: fontBold,
    color: rgb(0.2, 0.2, 0.2),
  });
}

function drawCoordinateTable(page: any, table: LayoutResult['tables'][number], x: number, y: number, maxWidth: number, font: any, fontBold: any) {
  const columns = [80, 150, 80, 80, 80, 80];
  const headers = ['Reference', 'Name', 'Size', 'Orientation', 'X (mm)', 'Y (mm)'];
  const rowHeight = 18;

  headers.forEach((header, index) => {
    page.drawText(header, {
      x: x + columns.slice(0, index).reduce((sum, width) => sum + width, 0),
      y,
      size: 10,
      font: fontBold,
      color: rgb(0.07, 0.07, 0.07),
    });
  });

  page.drawLine({
    start: { x, y: y - 2 },
    end: { x: x + maxWidth, y: y - 2 },
    color: rgb(0.2, 0.2, 0.2),
    thickness: 0.8,
  });

  table.paintings.forEach((painting, rowIndex) => {
    const rowY = y - (rowIndex + 1) * rowHeight;
    const values = [
      painting.referenceNumber,
      painting.name ?? painting.referenceNumber,
      `${painting.width} × ${painting.height}`,
      painting.orientation,
      formatMm(inchesToMm(painting.x)),
      formatMm(inchesToMm(painting.y)),
    ];

    values.forEach((value, colIndex) => {
      page.drawText(value, {
        x: x + columns.slice(0, colIndex).reduce((sum, width) => sum + width, 0),
        y: rowY,
        size: 9,
        font,
        color: rgb(0.07, 0.07, 0.07),
      });
    });
  });
}

export async function createLayoutPdf({
  layout,
  totalPaintings,
  totalArea,
  wasteArea,
  wastePercentage,
  generatedDate,
}: PdfExportParams): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const summaryPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  summaryPage.drawText('Print Table Optimizer', {
    x: MARGIN,
    y: PAGE_HEIGHT - MARGIN - 24,
    size: 28,
    font: helveticaBold,
    color: rgb(0.07, 0.07, 0.07),
  });

  summaryPage.drawText(`Generated Date/Time: ${generatedDate}`, {
    x: MARGIN,
    y: PAGE_HEIGHT - MARGIN - 60,
    size: 12,
    font: helvetica,
    color: rgb(0.07, 0.07, 0.07),
  });

  summaryPage.drawText('Job Summary', {
    x: MARGIN,
    y: PAGE_HEIGHT - MARGIN - 90,
    size: 18,
    font: helveticaBold,
    color: rgb(0.07, 0.07, 0.07),
  });

  const summaryItems = [
    `• Total Paintings: ${totalPaintings}`,
    `• Tables Used: ${layout.tables.length}`,
    `• Total Area: ${totalArea.toFixed(2)} in²`,
    `• Waste Area: ${wasteArea.toFixed(2)} in²`,
    `• Waste Percentage: ${wastePercentage.toFixed(2)}%`,
  ];

  summaryItems.forEach((item, index) => {
    summaryPage.drawText(item, {
      x: MARGIN,
      y: PAGE_HEIGHT - MARGIN - 120 - index * 20,
      size: 12,
      font: helvetica,
      color: rgb(0.07, 0.07, 0.07),
    });
  });

  const totalPages = layout.tables.length + 1;

  layout.tables.forEach((table, index) => {
    const pageNumber = index + 2;
    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

    page.drawText(`Table ${table.tableNumber}`, {
      x: MARGIN,
      y: PAGE_HEIGHT - MARGIN - 24,
      size: 24,
      font: helveticaBold,
      color: rgb(0.07, 0.07, 0.07),
    });

    const tableX = MARGIN;
    const tableY = PAGE_HEIGHT - MARGIN - 60 - TABLE_DRAW_HEIGHT;
    drawTableOutline(page, tableX, tableY, TABLE_DRAW_WIDTH, TABLE_DRAW_HEIGHT);

    const scale = TABLE_DRAW_WIDTH / TABLE_INCH_WIDTH;
    table.paintings.forEach((painting) => {
      drawPaintingBlock(page, painting, tableX, tableY, scale, helveticaBold);
    });

    const rulerBottomY = tableY - RULER_LABEL_GAP;
    drawBottomRuler(page, tableX, rulerBottomY, TABLE_DRAW_WIDTH);
    drawRightRuler(page, tableX + TABLE_DRAW_WIDTH + RULER_LABEL_GAP, tableY, TABLE_DRAW_HEIGHT);

    const coordinateTableY = rulerBottomY - 40;
    const coordinateTableX = MARGIN;
    const coordinateTableWidth = PAGE_WIDTH - MARGIN * 2;
    drawCoordinateTable(page, table, coordinateTableX, coordinateTableY, coordinateTableWidth, helvetica, helveticaBold);

    drawFooter(page, generatedDate, pageNumber, totalPages, helvetica, helveticaBold);
  });

  return pdfDoc.save();
}
