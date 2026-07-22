interface PaintingEntryProps {
  name: string;
  width: string;
  height: string;
  orientation: 'VERTICAL' | 'HORIZONTAL';
  onNameChange: (value: string) => void;
  onWidthChange: (value: string) => void;
  onHeightChange: (value: string) => void;
  onOrientationChange: (value: 'VERTICAL' | 'HORIZONTAL') => void;
  onAdd: () => void;
}

function PaintingEntry({
  name,
  width,
  height,
  orientation,
  onNameChange,
  onWidthChange,
  onHeightChange,
  onOrientationChange,
  onAdd,
}: PaintingEntryProps) {
  return (
    <div className="panel-section panel-section-tight">
      <h2>Add Painting</h2>
      <div className="field-row">
        <div>
          <label htmlFor="name">Name</label>
          <input
            id="name"
            type="text"
            placeholder="Blue Heron"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
          />
        </div>
      </div>
      <div className="field-row field-row-two">
        <div>
          <label htmlFor="width">W (in)</label>
          <input
            id="width"
            type="number"
            placeholder="Width"
            value={width}
            onChange={(event) => onWidthChange(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="height">H (in)</label>
          <input
            id="height"
            type="number"
            placeholder="Height"
            value={height}
            onChange={(event) => onHeightChange(event.target.value)}
          />
        </div>
      </div>
      <div className="orientation-toggle">
        <button
          type="button"
          className={`toggle-button ${orientation === 'VERTICAL' ? 'active' : ''}`}
          onClick={() => onOrientationChange('VERTICAL')}
        >
          VERT
        </button>
        <button
          type="button"
          className={`toggle-button ${orientation === 'HORIZONTAL' ? 'active' : ''}`}
          onClick={() => onOrientationChange('HORIZONTAL')}
        >
          HORI
        </button>
      </div>
      <button className="primary-button full-width-button" onClick={onAdd}>
        Add Painting
      </button>
    </div>
  );
}

export default PaintingEntry;
