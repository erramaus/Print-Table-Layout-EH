import type { PlacedPainting } from '../optimizer/types';

interface PrintTableProps {
  width?: number;
  height?: number;
  placements: PlacedPainting[];
  selectedPlacementId: string | null;
  onSelectPlacement: (id: string | null) => void;
}

function PrintTable({ width = 98, height = 80, placements, selectedPlacementId, onSelectPlacement }: PrintTableProps) {
  const svgWidth = 900;
  const svgHeight = 560;
  const tableFrameWidth = 620;
  const tableFrameHeight = 420;
  const scaleX = tableFrameWidth / width;
  const scaleY = tableFrameHeight / height;
  const scale = Math.min(scaleX, scaleY);
  const mmPerInch = 25.4;

  const tableWidth = width * scale;
  const tableHeight = height * scale;
  const offsetX = (svgWidth - tableWidth) / 2;
  const offsetY = (svgHeight - tableHeight) / 2 + 16;

  const originX = offsetX + tableWidth;
  const originY = offsetY + tableHeight;
  const scaleTickLength = 8;
  const scaleColor = '#94a3b8';

  const xScaleMarks = Math.floor((width * mmPerInch) / 50);
  const yScaleMarks = Math.floor((height * mmPerInch) / 50);

  return (
    <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} role="img" aria-label="Print table layout" className="print-table-svg">
      <rect x={offsetX} y={offsetY} width={tableWidth} height={tableHeight} fill="#faf5ff" stroke="#6b21a8" strokeWidth="3" />


      {[...Array(xScaleMarks + 1)].map((_, idx) => {
        const mmValue = idx * 50;
        const xPosition = offsetX + tableWidth - (mmValue / mmPerInch) * scale;
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
        const yPosition = offsetY + tableHeight - (mmValue / mmPerInch) * scale;
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

      {placements.map((placement) => {
        const rectX = offsetX + tableWidth - (placement.x + placement.width) * scale;
        const rectY = offsetY + tableHeight - (placement.y + placement.height) * scale;
        const rectWidth = placement.width * scale;
        const rectHeight = placement.height * scale;
        const isSelected = selectedPlacementId === placement.id;
        const showFullLabel = rectWidth > 130 && rectHeight > 90;
        const showNameAndRef = rectWidth > 90 && rectHeight > 60;

        return (
          <g key={placement.id} onClick={() => onSelectPlacement(placement.id)} style={{ cursor: 'pointer' }}>
            <rect
              x={rectX}
              y={rectY}
              width={rectWidth}
              height={rectHeight}
              fill={placement.color}
              stroke={isSelected ? '#0f172a' : '#1e293b'}
              strokeWidth={isSelected ? 3 : 2}
              rx="0"
              ry="0"
            />
            {placement.referenceNumber === 'SAMPLE' ? (
              <g
                transform={`translate(${rectX + rectWidth / 2} ${rectY + rectHeight / 2}) rotate(90)`}
                aria-label="Sample piece label"
              >
                <text
                  x="0"
                  y="0"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={Math.min(rectWidth / 4.2, rectHeight / 3, 12)}
                  fill="#111827"
                  fontWeight="700"
                >
                  <tspan x="0" dy="-0.35em">SAMPLE</tspan>
                  <tspan x="0" dy="1.35em">6 × 8</tspan>
                </text>
              </g>
            ) : (
              <text x={rectX + rectWidth / 2} y={rectY + rectHeight / 2 - 6} textAnchor="middle" fontSize="18" fill="#ffffff" fontWeight="700">
                {placement.referenceNumber}
              </text>
            )}
            {showFullLabel && placement.referenceNumber !== 'SAMPLE' && (
              <>
                {placement.name ? (
                  <text x={rectX + rectWidth / 2} y={rectY + rectHeight / 2 + 14} textAnchor="middle" fontSize="12" fill="#ffffff">
                    {placement.name}
                  </text>
                ) : null}
                <text x={rectX + rectWidth / 2} y={rectY + rectHeight / 2 + 30} textAnchor="middle" fontSize="12" fill="#ffffff">
                  {placement.width} × {placement.height}
                </text>
              </>
            )}
            {showNameAndRef && !showFullLabel && placement.referenceNumber !== 'SAMPLE' ? (
              <>
                {placement.name ? (
                  <text x={rectX + rectWidth / 2} y={rectY + rectHeight / 2 - 2} textAnchor="middle" fontSize="12" fill="#ffffff">
                    {placement.name}
                  </text>
                ) : null}
                <text x={rectX + rectWidth / 2} y={rectY + rectHeight / 2 + 18} textAnchor="middle" fontSize="12" fill="#ffffff">
                  {placement.referenceNumber}
                </text>
              </>
            ) : null}
            {!showFullLabel && !showNameAndRef && placement.referenceNumber !== 'SAMPLE' ? (
              <text x={rectX + rectWidth / 2} y={rectY + rectHeight / 2 + 4} textAnchor="middle" fontSize="12" fill="#ffffff">
                {placement.referenceNumber}
              </text>
            ) : null}
          </g>
        );
      })}

    </svg>
  );
}

export default PrintTable;
