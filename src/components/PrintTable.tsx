import type { PlacedPainting } from '../optimizer/types';
import { MM_PER_INCH, TABLE_HEIGHT_INCHES, TABLE_HEIGHT_MM, TABLE_WIDTH_INCHES, TABLE_WIDTH_MM } from '../constants/tableDimensions';
import type { OptimizerDebugOverlayData } from '../optimizer/layoutEngine';
import { getMutedHexColor, getReadableTextColor } from '../utils/colorTreatment';

interface PrintTableProps {
  width?: number;
  height?: number;
  placements: PlacedPainting[];
  selectedPlacementId: string | null;
  onSelectPlacement: (id: string | null) => void;
  onEditPainting: (id: string) => void;
  debugOverlay: OptimizerDebugOverlayData | null;
}

function PrintTable({
  width = TABLE_WIDTH_INCHES,
  height = TABLE_HEIGHT_INCHES,
  placements,
  selectedPlacementId,
  onSelectPlacement,
  onEditPainting,
  debugOverlay,
}: PrintTableProps) {
  const svgWidth = 900;
  const svgHeight = 560;
  const tableFrameWidth = 620;
  const tableFrameHeight = 420;
  const scaleX = tableFrameWidth / width;
  const scaleY = tableFrameHeight / height;
  const scale = Math.min(scaleX, scaleY);
  const tableWidth = width * scale;
  const tableHeight = height * scale;
  const offsetX = (svgWidth - tableWidth) / 2;
  const offsetY = (svgHeight - tableHeight) / 2 + 16;

  const originX = offsetX + tableWidth;
  const originY = offsetY + tableHeight;
  const scaleTickLength = 8;
  const scaleColor = '#94a3b8';

  const xScaleMarks = Math.floor(TABLE_WIDTH_MM / 50);
  const yScaleMarks = Math.floor(TABLE_HEIGHT_MM / 50);
  const visiblePlacements = placements.filter((placement) => placement.sampleType !== 'extra');

  return (
    <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} role="img" aria-label="Print table layout" className="print-table-svg">
      <rect x={offsetX} y={offsetY} width={tableWidth} height={tableHeight} fill="#faf5ff" stroke="#6b21a8" strokeWidth="3" />


      {[...Array(xScaleMarks + 1)].map((_, idx) => {
        const mmValue = idx * 50;
        const xPosition = offsetX + tableWidth - (mmValue / TABLE_WIDTH_MM) * tableWidth;
        const isLabel = mmValue % 100 === 0;

        return (
          <g key={`x-tick-${idx}`}>
            <line
              x1={xPosition}
              y1={offsetY + tableHeight}
              x2={xPosition}
              y2={offsetY + tableHeight + scaleTickLength}
              stroke={scaleColor}
              strokeWidth="1.5"
            />
            {isLabel && (
              <text
                x={xPosition}
                y={offsetY + tableHeight + scaleTickLength + 20}
                textAnchor="middle"
                fontSize="11"
                fill={scaleColor}
                transform={`rotate(-90 ${xPosition} ${offsetY + tableHeight + scaleTickLength + 20})`}
              >
                {mmValue}
              </text>
            )}
          </g>
        );
      })}

      {[...Array(yScaleMarks + 1)].map((_, idx) => {
        const mmValue = idx * 50;
        const yPosition = offsetY + tableHeight - (mmValue / TABLE_HEIGHT_MM) * tableHeight;
        const isLabel = mmValue % 100 === 0;

        return (
          <g key={`y-tick-${idx}`}>
            <line
              x1={offsetX + tableWidth}
              y1={yPosition}
              x2={offsetX + tableWidth + scaleTickLength}
              y2={yPosition}
              stroke={scaleColor}
              strokeWidth="1.5"
            />
            {isLabel && (
              <text
                x={offsetX + tableWidth + scaleTickLength + 6}
                y={yPosition + 4}
                textAnchor="start"
                fontSize="12"
                fill={scaleColor}
              >
                {mmValue}
              </text>
            )}
          </g>
        );
      })}

      {visiblePlacements.map((placement) => {
        const isRequiredSample = placement.sampleType === 'required';
        const isExtraSample = placement.sampleType === 'extra';
        const isAnySample = isRequiredSample || isExtraSample;
        const mutedFillColor = getMutedHexColor(placement.color, 0.5);
        const labelColor = getReadableTextColor(mutedFillColor);
        const displayWidth = placement.width * scale;
        const displayHeight = placement.height * scale;
        const rectX = offsetX + tableWidth - (placement.x + placement.width) * scale;
        const rectY = offsetY + tableHeight - (placement.y + placement.height) * scale;
        const rectWidth = displayWidth;
        const rectHeight = displayHeight;
        const isSelected = selectedPlacementId === placement.id;
        const showFullLabel = displayWidth > 130 && displayHeight > 90;
        const showNameAndRef = displayWidth > 90 && displayHeight > 60;

        return (
          <g
            key={placement.id}
            onClick={() => {
              onSelectPlacement(placement.id);
              onEditPainting(placement.id);
            }}
            style={{ cursor: 'pointer' }}
          >
            <rect
              x={rectX}
              y={rectY}
              width={rectWidth}
              height={rectHeight}
              fill={mutedFillColor}
              stroke={isRequiredSample ? '#0f172a' : isSelected ? '#0f172a' : '#1e293b'}
              strokeWidth={isSelected ? 3 : 2}
              rx="0"
              ry="0"
            />
            {isAnySample ? (
              <g
                transform={`translate(${rectX + rectWidth / 2} ${rectY + rectHeight / 2}) rotate(90)`}
                aria-label={isRequiredSample ? 'Required sample piece label fixed and locked' : 'Extra sample piece label'}
              >
                <text
                  x="0"
                  y="0"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={Math.min(rectWidth / 4.4, rectHeight / 3.4, 12)}
                  fill={labelColor}
                  fontWeight="700"
                >
                  <tspan x="0" dy={isRequiredSample ? '-1.05em' : '-0.35em'}>SAMPLE</tspan>
                  {isRequiredSample ? <tspan x="0" dy="1.15em">🔒 FIXED</tspan> : null}
                  <tspan x="0" dy="1.25em">6 × 8</tspan>
                </text>
              </g>
            ) : (
              <text x={rectX + rectWidth / 2} y={rectY + rectHeight / 2 - 6} textAnchor="middle" fontSize="18" fill={labelColor} fontWeight="700">
                {placement.referenceNumber}
              </text>
            )}
            {!isAnySample ? (
              <text x={rectX + rectWidth / 2} y={rectY + rectHeight - 10} textAnchor="middle" fontSize="11" fill={labelColor} fontWeight="600">
                {placement.orientation === 'VERTICAL' ? 'VERT' : 'HORI'}
              </text>
            ) : null}
            {showFullLabel && !isAnySample && (
              <>
                {placement.name ? (
                  <text x={rectX + rectWidth / 2} y={rectY + rectHeight / 2 + 14} textAnchor="middle" fontSize="12" fill={labelColor}>
                    {placement.name}
                  </text>
                ) : null}
                <text x={rectX + rectWidth / 2} y={rectY + rectHeight / 2 + 30} textAnchor="middle" fontSize="12" fill={labelColor}>
                  {placement.width} × {placement.height}
                </text>
              </>
            )}
            {showNameAndRef && !showFullLabel && !isAnySample ? (
              <>
                {placement.name ? (
                  <text x={rectX + rectWidth / 2} y={rectY + rectHeight / 2 - 2} textAnchor="middle" fontSize="12" fill={labelColor}>
                    {placement.name}
                  </text>
                ) : null}
                <text x={rectX + rectWidth / 2} y={rectY + rectHeight / 2 + 18} textAnchor="middle" fontSize="12" fill={labelColor}>
                  {placement.referenceNumber}
                </text>
              </>
            ) : null}
            {!showFullLabel && !showNameAndRef && !isAnySample ? (
              <text x={rectX + rectWidth / 2} y={rectY + rectHeight / 2 + 4} textAnchor="middle" fontSize="12" fill={labelColor}>
                {placement.referenceNumber}
              </text>
            ) : null}
          </g>
        );
      })}

      {debugOverlay ? (
        <g aria-label="Optimizer debug overlay">
          {(() => {
            const latestTrace =
              debugOverlay.candidateTrace.length > 0
                ? debugOverlay.candidateTrace[debugOverlay.candidateTrace.length - 1]
                : null;

            return (
              <g>
                <rect x={offsetX} y={offsetY - 48} width={Math.min(620, tableWidth)} height="56" fill="rgba(15, 23, 42, 0.82)" rx="4" ry="4" />
                <text x={offsetX + 8} y={offsetY - 32} fontSize="10" fill="#e2e8f0">
                  table {debugOverlay.tableNumber}: {debugOverlay.tableWidthMm}mm × {debugOverlay.tableHeightMm}mm | gap={debugOverlay.finalScore.gapQuality.netGapScore.toFixed(2)} | travel={debugOverlay.finalScore.printTravel.totalCost.toFixed(2)}
                </text>
                <text x={offsetX + 8} y={offsetY - 18} fontSize="10" fill="#e2e8f0">
                  maxBackY={debugOverlay.finalScore.printTravel.maxBackY.toFixed(2)} | weightedY={debugOverlay.finalScore.printTravel.areaWeightedY.toFixed(2)} | yBands={debugOverlay.finalScore.printTravel.estimatedYTransitions.toFixed(2)} | xTravel={debugOverlay.finalScore.printTravel.estimatedXTravel.toFixed(2)}
                </text>
                <text x={offsetX + 8} y={offsetY - 6} fontSize="10" fill="#e2e8f0">
                  candidate trace={debugOverlay.candidateTrace.length} | latest penalty={latestTrace ? latestTrace.totalPenalty : 'n/a'} | tables={debugOverlay.finalScore.tableCount}
                </text>
              </g>
            );
          })()}

          {visiblePlacements.map((placement) => {
            const clearanceMm = 25.4;
            const clearanceInches = clearanceMm / MM_PER_INCH;
            const x = Math.max(0, placement.x - clearanceInches);
            const y = Math.max(0, placement.y - clearanceInches);
            const widthInches = Math.min(TABLE_WIDTH_INCHES - x, placement.width + clearanceInches * 2);
            const heightInches = Math.min(TABLE_HEIGHT_INCHES - y, placement.height + clearanceInches * 2);
            const rectX = offsetX + tableWidth - (x + widthInches) * scale;
            const rectY = offsetY + tableHeight - (y + heightInches) * scale;

            return (
              <rect
                key={`clearance-${placement.id}`}
                x={rectX}
                y={rectY}
                width={widthInches * scale}
                height={heightInches * scale}
                fill="none"
                stroke="#0ea5e9"
                strokeDasharray="4 3"
                strokeWidth="1"
                pointerEvents="none"
              />
            );
          })}

          {debugOverlay.freeRegions.map((region, index) => {
            const rectX = offsetX + region.x * scale;
            const rectY = offsetY + tableHeight - (region.y + region.height) * scale;
            return (
              <g key={`free-region-${index}`}>
                <rect
                  x={rectX}
                  y={rectY}
                  width={region.width * scale}
                  height={region.height * scale}
                  fill="rgba(16, 185, 129, 0.08)"
                  stroke="#10b981"
                  strokeWidth="1"
                  pointerEvents="none"
                />
                <text x={rectX + 3} y={rectY + 12} fontSize="9" fill="#065f46" pointerEvents="none">
                  {region.classification}
                </text>
              </g>
            );
          })}

          {visiblePlacements
            .filter((placement) => placement.sampleType)
            .map((placement) => {
              const rectX = offsetX + tableWidth - (placement.x + placement.width) * scale;
              const rectY = offsetY + tableHeight - (placement.y + placement.height) * scale;
              return (
                <text key={`sample-kind-${placement.id}`} x={rectX + 4} y={rectY + 12} fontSize="9" fill="#0f172a" pointerEvents="none">
                  {placement.sampleType}
                </text>
              );
            })}
        </g>
      ) : null}

    </svg>
  );
}

export default PrintTable;
