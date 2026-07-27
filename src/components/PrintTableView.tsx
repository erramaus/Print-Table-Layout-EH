import type { PlacedPainting } from '../optimizer/types';
import PrintTable from './PrintTable';
import type { OptimizerDebugOverlayData } from '../optimizer/layoutEngine';

interface TableSummary {
  tableNumber: number;
  paintings: PlacedPainting[];
}

interface PrintTableViewProps {
  tables: TableSummary[];
  activeTableNumber: number;
  placements: PlacedPainting[];
  debugOverlay: OptimizerDebugOverlayData | null;
  selectedPlacementId: string | null;
  onSelectPlacement: (id: string | null) => void;
  onSelectTable: (tableNumber: number) => void;
  onEditPainting: (id: string) => void;
}

function PrintTableView({
  tables,
  activeTableNumber,
  placements,
  debugOverlay,
  selectedPlacementId,
  onSelectPlacement,
  onSelectTable,
  onEditPainting,
}: PrintTableViewProps) {
  const visiblePlacements = placements.filter((placement) => placement.sampleType !== 'extra');

  return (
    <section className="panel panel-right">
      <div className="canvas-card canvas-card-expanded">
        <div className="table-tabs">
          {tables.map((table) => {
            const isActive = table.tableNumber === activeTableNumber;
            return (
              <button
                key={table.tableNumber}
                type="button"
                className={`table-tab ${isActive ? 'is-active' : ''}`}
                onClick={() => onSelectTable(table.tableNumber)}
              >
                Table {table.tableNumber}
              </button>
            );
          })}
        </div>
        <div className="table-canvas">
          <PrintTable
            placements={visiblePlacements}
            debugOverlay={debugOverlay}
            selectedPlacementId={selectedPlacementId}
            onSelectPlacement={onSelectPlacement}
            onEditPainting={onEditPainting}
          />
        </div>
      </div>
    </section>
  );
}

export default PrintTableView;
