import type { PlacedPainting } from '../optimizer/types';
import PrintTable from './PrintTable';

interface TableSummary {
  tableNumber: number;
  paintings: PlacedPainting[];
}

interface PrintTableViewProps {
  tables: TableSummary[];
  activeTableNumber: number;
  placements: PlacedPainting[];
  selectedPlacementId: string | null;
  onSelectPlacement: (id: string | null) => void;
  onSelectTable: (tableNumber: number) => void;
}

function PrintTableView({
  tables,
  activeTableNumber,
  placements,
  selectedPlacementId,
  onSelectPlacement,
  onSelectTable,
}: PrintTableViewProps) {
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
            placements={placements}
            selectedPlacementId={selectedPlacementId}
            onSelectPlacement={onSelectPlacement}
          />
        </div>
      </div>
    </section>
  );
}

export default PrintTableView;
