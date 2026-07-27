import type { RefObject } from 'react';

interface PaintingEntryProps {
  name: string;
  width: string;
  height: string;
  orientation: 'VERTICAL' | 'HORIZONTAL' | null;
  onNameChange: (value: string) => void;
  onWidthChange: (value: string) => void;
  onHeightChange: (value: string) => void;
  onOrientationChange: (value: 'VERTICAL' | 'HORIZONTAL') => void;
  onAdd: () => void;
  nameInputRef: RefObject<HTMLInputElement>;
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
  nameInputRef,
}: PaintingEntryProps) {
  return (
    <div className="panel-section panel-section-tight">
      <div className="field-row">
        <div>
          <input
            id="name"
            ref={nameInputRef}
            type="text"
            placeholder="Name"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
          />
        </div>
      </div>
      <div className="field-row field-row-two">
        <div>
          <input
            id="width"
            type="number"
            placeholder="Width"
            value={width}
            onChange={(event) => onWidthChange(event.target.value)}
          />
        </div>
        <div>
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
          aria-pressed={orientation === 'VERTICAL'}
        >
          VERT
        </button>
        <button
          type="button"
          className={`toggle-button ${orientation === 'HORIZONTAL' ? 'active' : ''}`}
          onClick={() => onOrientationChange('HORIZONTAL')}
          aria-pressed={orientation === 'HORIZONTAL'}
        >
          HORI
        </button>
      </div>
      <button
        className="primary-button full-width-button"
        onClick={onAdd}
        disabled={!width || !height || orientation === null}
      >
        Add Painting
      </button>
    </div>
  );
}

export default PaintingEntry;
