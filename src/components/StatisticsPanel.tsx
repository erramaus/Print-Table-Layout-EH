interface StatisticsPanelProps {
  totalPaintings: number;
  totalArea: number;
  tablesUsed: number;
  wasteArea: number;
  wastePercentage: number;
  extraSamplePieces: number;
}

function StatisticsPanel({
  totalPaintings,
  totalArea,
  tablesUsed,
  wasteArea,
  wastePercentage,
  extraSamplePieces,
}: StatisticsPanelProps) {
  return (
    <section className="stats-card">
      <h3>Statistics</h3>
      <div className="stats-list stats-list-compact">
        <div className="stat-row stat-row-strong">
          <span>Total Paintings</span>
          <strong>{totalPaintings}</strong>
        </div>
        <div className="stat-row">
          <span>Total Area</span>
          <strong>{totalArea.toFixed(1)} sq in</strong>
        </div>
        <div className="stat-row">
          <span>Tables Used</span>
          <strong>{tablesUsed}</strong>
        </div>
        <div className="stat-row">
          <span>Waste Area</span>
          <strong>{wasteArea.toFixed(1)} sq in</strong>
        </div>
        <div className="stat-row">
          <span>Waste Percentage</span>
          <strong>{wastePercentage.toFixed(1)}%</strong>
        </div>
        <div className="stat-row">
          <span>Extra Sample Pieces</span>
          <strong>{extraSamplePieces}</strong>
        </div>
      </div>
    </section>
  );
}

export default StatisticsPanel;
