interface CoordinatesPanelProps {
  coordinates: Array<{
    id: string;
    referenceNumber: string;
    name: string;
    dimensions: string;
    orientation: 'VERTICAL' | 'HORIZONTAL';
    tableNumber: number;
    x: number;
    y: number;
  }>;
  selectedPlacementId: string | null;
  onSelectCoordinate: (id: string | null) => void;
}

function CoordinatesPanel({ coordinates, selectedPlacementId, onSelectCoordinate }: CoordinatesPanelProps) {
  const formatMillimeters = (value: number) => Math.round(value).toString();

  return (
    <section className="stats-card">
      <h3>Coordinates</h3>
      {coordinates.length === 0 ? (
        <p className="stats-empty">No coordinates to display yet.</p>
      ) : (
        <div className="coordinates-table">
          <div className="coordinates-header">
            <span>Ref</span>
            <span>Name</span>
            <span>Size</span>
            <span>Orientation</span>
            <span>Table</span>
            <span>X (mm)</span>
            <span>Y (mm)</span>
          </div>
          {coordinates.map((item) => {
            const isSelected = selectedPlacementId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`coordinate-row ${isSelected ? 'is-selected' : ''}`}
                onClick={() => onSelectCoordinate(item.id)}
              >
                <span>{item.referenceNumber}</span>
                <span>{item.name}</span>
                <span>{item.dimensions}</span>
                <span>{item.orientation}</span>
                <span>{item.tableNumber}</span>
                <span>{formatMillimeters(item.x)}</span>
                <span>{formatMillimeters(item.y)}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default CoordinatesPanel;
