import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import type { LayoutResult, PlacedPainting, TableLayout } from '../optimizer/types';
import { MM_PER_INCH, TABLE_HEIGHT_INCHES, TABLE_HEIGHT_MM, TABLE_WIDTH_INCHES, TABLE_WIDTH_MM } from '../constants/tableDimensions';
import { getMutedHexColor, getMutedRgb01, getReadableTextColor } from './colorTreatment';

const POINTS_PER_MM = 72 / 25.4;
const PAGE_MARGIN_MM = 12;
const PAGE_MIN_WIDTH_MM = 420;
const PAGE_MIN_HEIGHT_MM = 297;
const PAGE_LANDSCAPE_BUFFER_MM = 40;

const SECTION_GAP_MM = 8;
const DIAGRAM_TO_COORDINATES_GAP_MM = 12;
const RULER_LABEL_CLEARANCE_MM = 6;
const CELL_PADDING_MM = 5;
const GRID_GAP_MM = 10;

const DIAGRAM_WIDTH_ONE_TABLE_MM = 120;
const DIAGRAM_WIDTH_MULTI_TABLE_MM = 96;
const RIGHT_RULER_ZONE_MM = 12;
const BOTTOM_RULER_TICK_MM = 3;

const TABLE_TITLE_PT = 12;
const COORD_SECTION_TITLE_PT = 16.5;
const COORD_HEADER_PT = 10.5;
const COORD_ROW_PT = 9.5;
const DIAGRAM_LABEL_PT = 7;
const RULER_LABEL_PT = 5.7;
const SUMMARY_TITLE_PT = 10.5;
const SUMMARY_ROW_PT = 9.5;
const META_PT = 10;
const FOOTER_PT = 8;

const COL_NAME_CENTER = 0;
const COL_W_CENTER = 68;
const COL_H_CENTER = 93;
const COL_ORIENT_CENTER = 125;
const COL_HORI_CENTER = 154;
const COL_VERT_CENTER = 179;
const COORD_TABLE_WIDTH_MM = 200;
const COORD_HEADERS = ['Name', 'W', 'H', 'Orient', 'HORI', 'VERT'];
const COORDINATE_TITLE_TO_HEADER_GAP_MM = 10;
const COORDINATE_HEADER_TO_DIVIDER_GAP_MM = 3;
const COORDINATE_DIVIDER_TO_FIRST_ROW_GAP_MM = 4;
const COORDINATE_ROW_HEIGHT_MM = 8;
const COORD_COLUMN_CENTERS_MM = [COL_NAME_CENTER, COL_W_CENTER, COL_H_CENTER, COL_ORIENT_CENTER, COL_HORI_CENTER, COL_VERT_CENTER];
const COORD_COLUMN_WIDTHS_MM = [58, 20, 30, 34, 23, 21];

interface PdfExportParams {
  layout: LayoutResult;
  totalPaintings: number;
  totalArea: number;
  wasteArea: number;
  wastePercentage: number;
  generatedDate: string;
}

interface TablePlan {
  table: TableLayout;
  entries: PlacedPainting[];
  coordHeightMm: number;
}

export interface PdfCoordinateRow {
  tableNumber: number;
  placementId: string;
  referenceNumber: string;
  name: string;
  width: string;
  height: string;
  orientation: string;
  hori: string;
  vert: string;
}

type Orientation = PlacedPainting['orientation'] | 'VERT' | 'HORI';

function toPoints(mm: number) {
  return mm * POINTS_PER_MM;
}

function pointsToMm(points: number) {
  return points / POINTS_PER_MM;
}

function inchesToMm(value: number) {
  return value * MM_PER_INCH;
}

function formatMm(valueInches: number) {
  return Math.round(inchesToMm(valueInches)).toString();
}

function getOrientationLabel(orientation: Orientation): string {
  switch (orientation) {
    case 'VERTICAL':
    case 'VERT':
      return 'VERT';
    case 'HORIZONTAL':
    case 'HORI':
      return 'HORI';
    default:
      return String(orientation);
  }
}

function toPdfCoordinateRow(tableNumber: number, entry: PlacedPainting): PdfCoordinateRow {
  const name = entry.sampleType === 'required' ? 'SAMPLE' : (entry.name?.trim() || entry.referenceNumber);
  return {
    tableNumber,
    placementId: entry.id,
    referenceNumber: entry.referenceNumber,
    name,
    width: `${entry.width}`,
    height: `${entry.height}`,
    orientation: getOrientationLabel(entry.orientation),
    hori: formatMm(entry.x),
    vert: formatMm(entry.y),
  };
}

export function getPdfCoordinateRowsForLayout(layout: LayoutResult): PdfCoordinateRow[] {
  const rows: PdfCoordinateRow[] = [];
  for (const table of layout.tables) {
    const entries = getVisibleEntries(table);
    for (const entry of entries) {
      rows.push(toPdfCoordinateRow(table.tableNumber, entry));
    }
  }
  return rows;
}

function mmTopToPdfY(pageHeightMm: number, topMm: number) {
  return toPoints(pageHeightMm - topMm);
}

function drawRectFromTop(
  page: PDFPage,
  pageHeightMm: number,
  xMm: number,
  topMm: number,
  widthMm: number,
  heightMm: number,
  options: {
    color?: ReturnType<typeof rgb>;
    borderColor?: ReturnType<typeof rgb>;
    borderWidth?: number;
  }
) {
  page.drawRectangle({
    x: toPoints(xMm),
    y: toPoints(pageHeightMm - topMm - heightMm),
    width: toPoints(widthMm),
    height: toPoints(heightMm),
    color: options.color,
    borderColor: options.borderColor,
    borderWidth: options.borderWidth,
  });
}

function drawTextFromTop(
  page: PDFPage,
  pageHeightMm: number,
  text: string,
  xMm: number,
  topMm: number,
  sizePt: number,
  font: PDFFont,
  color: ReturnType<typeof rgb>
) {
  page.drawText(text, {
    x: toPoints(xMm),
    y: mmTopToPdfY(pageHeightMm, topMm) - sizePt,
    size: sizePt,
    font,
    color,
  });
}

function drawCoordinateText(
  page: PDFPage,
  pageHeightMm: number,
  text: string,
  xMm: number,
  topMm: number,
  sizePt: number,
  font: PDFFont,
  color: ReturnType<typeof rgb>,
  alignment: 'left' | 'center'
) {
  const textWidthMm = pointsToMm(font.widthOfTextAtSize(text, sizePt));
  const textX = alignment === 'center' ? xMm - textWidthMm / 2 : xMm;
  drawTextFromTop(page, pageHeightMm, text, textX, topMm, sizePt, font, color);
}

function trimToWidth(font: PDFFont, text: string, fontSizePt: number, maxWidthMm: number) {
  const maxWidthPt = toPoints(maxWidthMm);
  if (font.widthOfTextAtSize(text, fontSizePt) <= maxWidthPt) {
    return text;
  }

  const ellipsis = '...';
  let end = text.length;
  while (end > 0) {
    const candidate = `${text.slice(0, end)}${ellipsis}`;
    if (font.widthOfTextAtSize(candidate, fontSizePt) <= maxWidthPt) {
      return candidate;
    }
    end -= 1;
  }

  return ellipsis;
}

function getVisibleEntries(table: TableLayout) {
  const visible = table.paintings.filter((painting) => painting.sampleType !== 'extra');
  const required = visible.filter((painting) => painting.sampleType === 'required');
  const regular = visible
    .filter((painting) => painting.sampleType !== 'required')
    .sort((a, b) => {
      if (a.y !== b.y) {
        return a.y - b.y;
      }
      if (a.x !== b.x) {
        return a.x - b.x;
      }
      return a.referenceNumber.localeCompare(b.referenceNumber);
    });
  return [...required, ...regular];
}

function getCoordinateHeightMm(rowCount: number) {
  const sectionTitleMm = 6.5;
  const headerMm = 5.2;
  const rowMm = COORDINATE_ROW_HEIGHT_MM;
  const topPaddingMm = 2;
  const bottomPaddingMm = 2;
  return (
    topPaddingMm +
    sectionTitleMm +
    COORDINATE_TITLE_TO_HEADER_GAP_MM +
    headerMm +
    COORDINATE_HEADER_TO_DIVIDER_GAP_MM +
    COORDINATE_DIVIDER_TO_FIRST_ROW_GAP_MM +
    Math.max(1, rowCount) * rowMm +
    bottomPaddingMm
  );
}

function pickGridColumns(tableCount: number) {
  if (tableCount <= 1) {
    return 1;
  }
  if (tableCount === 2) {
    return 2;
  }
  if (tableCount <= 4) {
    return 2;
  }
  return Math.ceil(Math.sqrt(tableCount));
}

function drawBottomXRuler(
  page: PDFPage,
  pageHeightMm: number,
  diagramLeftMm: number,
  diagramTopMm: number,
  diagramWidthMm: number,
  diagramHeightMm: number,
  font: PDFFont
) {
  const color = rgb(0.22, 0.22, 0.22);
  const baselineTop = diagramTopMm + diagramHeightMm;

  page.drawLine({
    start: { x: toPoints(diagramLeftMm), y: toPoints(pageHeightMm - baselineTop) },
    end: { x: toPoints(diagramLeftMm + diagramWidthMm), y: toPoints(pageHeightMm - baselineTop) },
    color,
    thickness: 0.8,
  });

  for (let mm = 0; mm <= TABLE_WIDTH_MM; mm += 50) {
    const tickX = diagramLeftMm + diagramWidthMm - (mm / TABLE_WIDTH_MM) * diagramWidthMm;
    const isMajor = mm % 100 === 0;
    const tickLength = isMajor ? BOTTOM_RULER_TICK_MM : 2;

    page.drawLine({
      start: { x: toPoints(tickX), y: toPoints(pageHeightMm - baselineTop) },
      end: { x: toPoints(tickX), y: toPoints(pageHeightMm - (baselineTop + tickLength)) },
      color,
      thickness: 0.8,
    });

    if (isMajor) {
      const label = String(mm);
      drawTextFromTop(page, pageHeightMm, label, tickX - 2.4, baselineTop + tickLength + 1.2, RULER_LABEL_PT, font, color);
    }
  }

  return baselineTop + BOTTOM_RULER_TICK_MM + RULER_LABEL_CLEARANCE_MM + pointsToMm(RULER_LABEL_PT);
}

function drawRightYRuler(
  page: PDFPage,
  pageHeightMm: number,
  diagramLeftMm: number,
  diagramTopMm: number,
  diagramWidthMm: number,
  diagramHeightMm: number,
  font: PDFFont
) {
  const color = rgb(0.22, 0.22, 0.22);
  const rulerX = diagramLeftMm + diagramWidthMm;

  page.drawLine({
    start: { x: toPoints(rulerX), y: toPoints(pageHeightMm - diagramTopMm) },
    end: { x: toPoints(rulerX), y: toPoints(pageHeightMm - (diagramTopMm + diagramHeightMm)) },
    color,
    thickness: 0.8,
  });

  for (let mm = 0; mm <= TABLE_HEIGHT_MM; mm += 50) {
    const tickY = diagramTopMm + diagramHeightMm - (mm / TABLE_HEIGHT_MM) * diagramHeightMm;
    const isMajor = mm % 100 === 0;
    const tickWidth = isMajor ? 3 : 2;

    page.drawLine({
      start: { x: toPoints(rulerX), y: toPoints(pageHeightMm - tickY) },
      end: { x: toPoints(rulerX + tickWidth), y: toPoints(pageHeightMm - tickY) },
      color,
      thickness: 0.8,
    });

    if (isMajor) {
      drawTextFromTop(page, pageHeightMm, String(mm), rulerX + tickWidth + 0.8, tickY - 1.2, RULER_LABEL_PT, font, color);
    }
  }
}

function drawDiagramEntry(
  page: PDFPage,
  pageHeightMm: number,
  entry: PlacedPainting,
  diagramLeftMm: number,
  diagramTopMm: number,
  diagramWidthMm: number,
  diagramHeightMm: number,
  font: PDFFont
) {
  const renderX =
    diagramLeftMm +
    diagramWidthMm - ((entry.x + entry.width) / TABLE_WIDTH_INCHES) * diagramWidthMm;
  const renderY =
    diagramTopMm +
    diagramHeightMm - ((entry.y + entry.height) / TABLE_HEIGHT_INCHES) * diagramHeightMm;
  const renderWidth = (entry.width / TABLE_WIDTH_INCHES) * diagramWidthMm;
  const renderHeight = (entry.height / TABLE_HEIGHT_INCHES) * diagramHeightMm;

  const isSample = entry.sampleType === 'required';
  const mutedHexColor = getMutedHexColor(entry.color, 0.5);
  const mutedRgb = getMutedRgb01(entry.color, 0.5);
  const textColorHex = getReadableTextColor(mutedHexColor);
  const textColor = textColorHex === '#ffffff' ? rgb(1, 1, 1) : rgb(0.07, 0.07, 0.07);
  let fillColor = rgb(mutedRgb.r, mutedRgb.g, mutedRgb.b);

  if (isSample && entry.color.trim() === '') {
    fillColor = rgb(0.74, 0.74, 0.74);
  }

  drawRectFromTop(page, pageHeightMm, renderX, renderY, renderWidth, renderHeight, {
    color: fillColor,
    borderColor: rgb(0.05, 0.05, 0.05),
    borderWidth: 0.55,
  });

  const label = isSample ? 'SAMPLE' : (entry.name?.trim() || entry.referenceNumber);
  const labelSize = Math.max(6, Math.min(DIAGRAM_LABEL_PT, pointsToMm(toPoints(renderHeight) * 0.26)));
  drawTextFromTop(page, pageHeightMm, trimToWidth(font, label, labelSize, Math.max(3, renderWidth - 1.4)), renderX + 0.8, renderY + 1, labelSize, font, textColor);

  const canShowDims = renderWidth >= 12 && renderHeight >= 8;
  if (!isSample && canShowDims) {
    const dims = `${entry.width}x${entry.height}`;
    drawTextFromTop(page, pageHeightMm, dims, renderX + 0.8, renderY + 4.8, 6, font, textColor);
  }
}

function drawCoordinateSection(
  page: PDFPage,
  pageHeightMm: number,
  tableNumber: number,
  entries: PlacedPainting[],
  xMm: number,
  topMm: number,
  widthMm: number,
  normalFont: PDFFont,
  boldFont: PDFFont
) {
  const divider = rgb(0.82, 0.82, 0.82);

  drawTextFromTop(page, pageHeightMm, `TABLE ${tableNumber} COORDINATES`, xMm, topMm, COORD_SECTION_TITLE_PT, boldFont, rgb(0.08, 0.08, 0.08));

  const headerTop = topMm + COORDINATE_TITLE_TO_HEADER_GAP_MM;
  COORD_HEADERS.forEach((header, index) => {
    const columnCenter = COORD_COLUMN_CENTERS_MM[index];
    const alignment = index === 0 ? 'left' : 'center';
    drawCoordinateText(page, pageHeightMm, header, xMm + columnCenter, headerTop, COORD_HEADER_PT, boldFont, rgb(0.1, 0.1, 0.1), alignment);
  });

  const headerRuleTop = headerTop + 5.2;

  page.drawLine({
    start: { x: toPoints(xMm), y: toPoints(pageHeightMm - headerRuleTop) },
    end: { x: toPoints(xMm + Math.min(widthMm, COORD_TABLE_WIDTH_MM)), y: toPoints(pageHeightMm - headerRuleTop) },
    color: rgb(0.35, 0.35, 0.35),
    thickness: 0.8,
  });

  const rowStartTop = headerRuleTop + COORDINATE_DIVIDER_TO_FIRST_ROW_GAP_MM;
  const rowHeight = COORDINATE_ROW_HEIGHT_MM;
  const rowRightEdgeMm = Math.min(widthMm, COORD_TABLE_WIDTH_MM);

  entries.forEach((entry, index) => {
    const rowTop = rowStartTop + index * rowHeight;
    const row = toPdfCoordinateRow(tableNumber, entry);
    const values = [
      row.name,
      row.width,
      row.height,
      row.orientation,
      row.hori,
      row.vert,
    ];

    values.forEach((value, colIndex) => {
      const columnCenter = COORD_COLUMN_CENTERS_MM[colIndex];
      const cellWidth = COORD_COLUMN_WIDTHS_MM[colIndex];
      const clipped = trimToWidth(normalFont, value, COORD_ROW_PT, cellWidth - 1.2);
      const alignment = colIndex === 0 ? 'left' : 'center';
      drawCoordinateText(page, pageHeightMm, clipped, xMm + columnCenter, rowTop, COORD_ROW_PT, normalFont, rgb(0.08, 0.08, 0.08), alignment);
    });

    page.drawLine({
      start: { x: toPoints(xMm), y: toPoints(pageHeightMm - (rowTop + rowHeight - 1.6)) },
      end: { x: toPoints(xMm + rowRightEdgeMm), y: toPoints(pageHeightMm - (rowTop + rowHeight - 1.6)) },
      color: divider,
      thickness: 0.5,
    });
  });
}

function computeSummary(layout: LayoutResult, totalPaintingsFromOrder: number, totalAreaFromOrder: number) {
  const paintedEntries = layout.placements.filter((placement) => placement.sampleType !== 'required' && placement.sampleType !== 'extra');
  const computedArea = paintedEntries.reduce((sum, placement) => sum + placement.width * placement.height, 0);
  const totalPaintingArea = totalAreaFromOrder > 0 ? totalAreaFromOrder : computedArea;

  const totalTableArea = layout.tables.length * TABLE_WIDTH_INCHES * TABLE_HEIGHT_INCHES;
  const wasteArea = Math.max(0, totalTableArea - totalPaintingArea);
  const wastePercentage = totalTableArea > 0 ? (wasteArea / totalTableArea) * 100 : 0;
  const extraSamples = layout.placements.filter((placement) => placement.sampleType === 'extra').length;

  return {
    totalPaintings: totalPaintingsFromOrder,
    totalPaintingArea,
    wasteArea,
    wastePercentage,
    extraSamples,
  };
}

export async function createLayoutPdf({
  layout,
  totalPaintings,
  totalArea,
  generatedDate,
}: PdfExportParams): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const plans: TablePlan[] = layout.tables.map((table) => {
    const entries = getVisibleEntries(table);
    return {
      table,
      entries,
      coordHeightMm: getCoordinateHeightMm(entries.length),
    };
  });

  const tableCount = plans.length;
  const coordWidthMm = COORD_TABLE_WIDTH_MM;
  const diagramWidthMm = tableCount === 1 ? DIAGRAM_WIDTH_ONE_TABLE_MM : DIAGRAM_WIDTH_MULTI_TABLE_MM;
  const diagramHeightMm = (diagramWidthMm / TABLE_WIDTH_MM) * TABLE_HEIGHT_MM;
  const diagramWithRulersWidthMm = diagramWidthMm + RIGHT_RULER_ZONE_MM;
  const rulerBottomEnvelopeMm = BOTTOM_RULER_TICK_MM + RULER_LABEL_CLEARANCE_MM + pointsToMm(RULER_LABEL_PT);
  const diagramWithRulersHeightMm = diagramHeightMm + rulerBottomEnvelopeMm;

  const headerHeightMm = 22;
  const summaryHeightMm = 24;
  const footerHeightMm = 6;

  let contentWidthMm = 0;
  let contentHeightMm = 0;
  let pageWidthMm = PAGE_MIN_WIDTH_MM;
  let pageHeightMm = PAGE_MIN_HEIGHT_MM;

  if (tableCount <= 1) {
    const coordHeight = plans[0]?.coordHeightMm ?? getCoordinateHeightMm(1);
    const blockHeight = Math.max(diagramWithRulersHeightMm, coordHeight);
    contentWidthMm = diagramWithRulersWidthMm + DIAGRAM_TO_COORDINATES_GAP_MM + coordWidthMm;
    contentHeightMm = headerHeightMm + SECTION_GAP_MM + blockHeight + SECTION_GAP_MM + summaryHeightMm + SECTION_GAP_MM + footerHeightMm;

    pageWidthMm = Math.max(PAGE_MIN_WIDTH_MM, contentWidthMm + PAGE_MARGIN_MM * 2);
    pageHeightMm = Math.max(PAGE_MIN_HEIGHT_MM, contentHeightMm + PAGE_MARGIN_MM * 2);

    const nonMainHeightMm = headerHeightMm + summaryHeightMm + footerHeightMm + SECTION_GAP_MM * 3;
    const minUsableForRatio = diagramWithRulersHeightMm / 0.42;
    pageHeightMm = Math.max(pageHeightMm, nonMainHeightMm + minUsableForRatio + PAGE_MARGIN_MM * 2);

    const usableWidth = pageWidthMm - PAGE_MARGIN_MM * 2;
    if (diagramWithRulersWidthMm > usableWidth * 0.5) {
      pageWidthMm = Math.max(pageWidthMm, (diagramWithRulersWidthMm / 0.48) + PAGE_MARGIN_MM * 2);
    }
  } else {
    const columns = pickGridColumns(tableCount);
    const rows = Math.ceil(tableCount / columns);

    const perTableHeights = plans.map((plan) => {
      return CELL_PADDING_MM + 6 + diagramWithRulersHeightMm + DIAGRAM_TO_COORDINATES_GAP_MM + plan.coordHeightMm + CELL_PADDING_MM;
    });

    const rowHeights = Array.from({ length: rows }, () => 0);
    perTableHeights.forEach((height, index) => {
      const row = Math.floor(index / columns);
      rowHeights[row] = Math.max(rowHeights[row], height);
    });

    const cellWidthMm = Math.max(diagramWithRulersWidthMm, coordWidthMm) + CELL_PADDING_MM * 2;
    const gridWidthMm = columns * cellWidthMm + Math.max(0, columns - 1) * GRID_GAP_MM;
    const gridHeightMm = rowHeights.reduce((sum, value) => sum + value, 0) + Math.max(0, rows - 1) * GRID_GAP_MM;

    contentWidthMm = gridWidthMm;
    contentHeightMm = headerHeightMm + SECTION_GAP_MM + gridHeightMm + SECTION_GAP_MM + summaryHeightMm + SECTION_GAP_MM + footerHeightMm;

    pageWidthMm = Math.max(PAGE_MIN_WIDTH_MM, contentWidthMm + PAGE_MARGIN_MM * 2);
    pageHeightMm = Math.max(PAGE_MIN_HEIGHT_MM, contentHeightMm + PAGE_MARGIN_MM * 2);
  }

  if (pageHeightMm >= pageWidthMm) {
    pageWidthMm = pageHeightMm + PAGE_LANDSCAPE_BUFFER_MM;
  }

  const page = pdfDoc.insertPage(0, [toPoints(pageWidthMm), toPoints(pageHeightMm)]);
  const contentLeftMm = PAGE_MARGIN_MM + Math.max(0, (pageWidthMm - PAGE_MARGIN_MM * 2 - contentWidthMm) / 2);
  let yCursorMm = PAGE_MARGIN_MM;

  drawTextFromTop(page, pageHeightMm, 'Print Table Optimizer Layout Export', contentLeftMm, yCursorMm, 18, boldFont, rgb(0.08, 0.08, 0.08));
  drawTextFromTop(page, pageHeightMm, `Generated Date/Time: ${generatedDate}`, contentLeftMm, yCursorMm + 8, META_PT, regularFont, rgb(0.15, 0.15, 0.15));
  drawTextFromTop(page, pageHeightMm, `Tables: ${tableCount} · Paintings: ${totalPaintings}`, contentLeftMm, yCursorMm + 14, META_PT, regularFont, rgb(0.15, 0.15, 0.15));
  yCursorMm += headerHeightMm + SECTION_GAP_MM;

  if (tableCount <= 1) {
    const plan = plans[0];
    if (plan) {
      const blockTop = yCursorMm;
      const diagramLeft = contentLeftMm;
      const diagramTop = blockTop + 6;

      drawTextFromTop(page, pageHeightMm, `Table ${plan.table.tableNumber}`, diagramLeft, blockTop, TABLE_TITLE_PT, boldFont, rgb(0.07, 0.07, 0.07));
      drawRectFromTop(page, pageHeightMm, diagramLeft, diagramTop, diagramWidthMm, diagramHeightMm, {
        color: rgb(1, 1, 1),
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.8,
      });

      plan.entries.forEach((entry) => {
        drawDiagramEntry(page, pageHeightMm, entry, diagramLeft, diagramTop, diagramWidthMm, diagramHeightMm, boldFont);
      });

      const bottomExtent = drawBottomXRuler(page, pageHeightMm, diagramLeft, diagramTop, diagramWidthMm, diagramHeightMm, regularFont);
      drawRightYRuler(page, pageHeightMm, diagramLeft, diagramTop, diagramWidthMm, diagramHeightMm, regularFont);

      const coordLeft = diagramLeft + diagramWithRulersWidthMm + DIAGRAM_TO_COORDINATES_GAP_MM;
      const coordTop = blockTop + 2;
      drawCoordinateSection(page, pageHeightMm, plan.table.tableNumber, plan.entries, coordLeft, coordTop, COORD_TABLE_WIDTH_MM, regularFont, boldFont);

      const blockBottom = Math.max(bottomExtent, coordTop + plan.coordHeightMm);
      yCursorMm = blockBottom + SECTION_GAP_MM;
    }
  } else {
    const columns = pickGridColumns(tableCount);
    const rows = Math.ceil(tableCount / columns);
    const cellWidthMm = Math.max(diagramWithRulersWidthMm, coordWidthMm) + CELL_PADDING_MM * 2;

    const rowHeights = Array.from({ length: rows }, () => 0);
    plans.forEach((plan, index) => {
      const row = Math.floor(index / columns);
      const cellHeight = CELL_PADDING_MM + 6 + diagramWithRulersHeightMm + DIAGRAM_TO_COORDINATES_GAP_MM + plan.coordHeightMm + CELL_PADDING_MM;
      rowHeights[row] = Math.max(rowHeights[row], cellHeight);
    });

    const gridWidth = columns * cellWidthMm + Math.max(0, columns - 1) * GRID_GAP_MM;
    const gridLeft = contentLeftMm + Math.max(0, (contentWidthMm - gridWidth) / 2);

    plans.forEach((plan, index) => {
      const row = Math.floor(index / columns);
      const col = index % columns;
      const rowTop = yCursorMm + rowHeights.slice(0, row).reduce((sum, value) => sum + value, 0) + row * GRID_GAP_MM;
      const cellLeft = gridLeft + col * (cellWidthMm + GRID_GAP_MM);

      drawRectFromTop(page, pageHeightMm, cellLeft, rowTop, cellWidthMm, rowHeights[row], {
        color: rgb(0.996, 0.996, 0.996),
        borderColor: rgb(0.88, 0.88, 0.88),
        borderWidth: 0.6,
      });

      const diagramLeft = cellLeft + CELL_PADDING_MM;
      const diagramTop = rowTop + CELL_PADDING_MM + 5.8;
      drawTextFromTop(page, pageHeightMm, `Table ${plan.table.tableNumber}`, diagramLeft, rowTop + 0.8, TABLE_TITLE_PT, boldFont, rgb(0.07, 0.07, 0.07));

      drawRectFromTop(page, pageHeightMm, diagramLeft, diagramTop, diagramWidthMm, diagramHeightMm, {
        color: rgb(1, 1, 1),
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.8,
      });

      plan.entries.forEach((entry) => {
        drawDiagramEntry(page, pageHeightMm, entry, diagramLeft, diagramTop, diagramWidthMm, diagramHeightMm, boldFont);
      });

      const bottomExtent = drawBottomXRuler(page, pageHeightMm, diagramLeft, diagramTop, diagramWidthMm, diagramHeightMm, regularFont);
      drawRightYRuler(page, pageHeightMm, diagramLeft, diagramTop, diagramWidthMm, diagramHeightMm, regularFont);

      const coordTop = Math.max(bottomExtent + DIAGRAM_TO_COORDINATES_GAP_MM, diagramTop + diagramWithRulersHeightMm + DIAGRAM_TO_COORDINATES_GAP_MM);
      drawCoordinateSection(page, pageHeightMm, plan.table.tableNumber, plan.entries, diagramLeft, coordTop, coordWidthMm, regularFont, boldFont);
    });

    yCursorMm += rowHeights.reduce((sum, value) => sum + value, 0) + Math.max(0, rows - 1) * GRID_GAP_MM + SECTION_GAP_MM;
  }

  const summary = computeSummary(layout, totalPaintings, totalArea);
  drawRectFromTop(page, pageHeightMm, contentLeftMm, yCursorMm, contentWidthMm, summaryHeightMm, {
    color: rgb(0.986, 0.986, 0.986),
    borderColor: rgb(0.82, 0.82, 0.82),
    borderWidth: 0.7,
  });

  drawTextFromTop(page, pageHeightMm, 'Job Summary', contentLeftMm + 3, yCursorMm + 2.5, SUMMARY_TITLE_PT, boldFont, rgb(0.09, 0.09, 0.09));

  const summaryLines = [
    `Total Paintings: ${summary.totalPaintings}`,
    `Tables Used: ${tableCount}`,
    `Total Painting Area: ${summary.totalPaintingArea.toFixed(2)} in^2`,
    `Waste Area: ${summary.wasteArea.toFixed(2)} in^2`,
    `Waste Percentage: ${summary.wastePercentage.toFixed(2)}%`,
    `Extra Sample Pieces Available: ${summary.extraSamples}`,
  ];

  summaryLines.forEach((line, index) => {
    const column = index < 3 ? 0 : 1;
    const row = index % 3;
    const x = contentLeftMm + 3 + column * (contentWidthMm / 2);
    const y = yCursorMm + 8 + row * 5.1;
    drawTextFromTop(page, pageHeightMm, line, x, y, SUMMARY_ROW_PT, regularFont, rgb(0.1, 0.1, 0.1));
  });

  yCursorMm += summaryHeightMm + SECTION_GAP_MM;
  drawTextFromTop(
    page,
    pageHeightMm,
    'One-page export. Coordinates prioritized for production readability.',
    contentLeftMm,
    yCursorMm,
    FOOTER_PT,
    regularFont,
    rgb(0.24, 0.24, 0.24)
  );

  return pdfDoc.save();
}
