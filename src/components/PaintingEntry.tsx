import type { RefObject } from 'react';

interface PaintingEntryProps {
  name: string;
  width: string;
  height: string;
  orientation: 'VERT' | 'HORI' | null;
  isEditing: boolean;
  onNameChange: (value: string) => void;
  onWidthChange: (value: string) => void;
  onHeightChange: (value: string) => void;
  onOrientationChange: (value: 'VERT' | 'HORI') => void;
  onAdd: () => void;
  onCancelEdit: () => void;
  nameInputRef: RefObject<HTMLInputElement>;
}

function PaintingEntry({
  name,
  width,
  height,
  orientation,
  isEditing,
  onNameChange,
  onWidthChange,
  onHeightChange,
  onOrientationChange,
  onAdd,
  onCancelEdit,
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
          className={`toggle-button ${orientation === 'VERT' ? 'active' : ''}`}
          onClick={() => onOrientationChange('VERT')}
          aria-pressed={orientation === 'VERT'}
        >
          VERT
        </button>
        <button
          type="button"
          className={`toggle-button ${orientation === 'HORI' ? 'active' : ''}`}
          onClick={() => onOrientationChange('HORI')}
          aria-pressed={orientation === 'HORI'}
        >
          HORI
        </button>
      </div>
      <button
        className="primary-button full-width-button"
        type="button"
        onClick={onAdd}
        disabled={!width || !height || orientation === null}
      >
        {isEditing ? 'Save Changes' : 'Add Painting'}
      </button>
      {isEditing ? (
        <button className="clear-button full-width-button" type="button" onClick={onCancelEdit}>
          Cancel Edit
        </button>
      ) : null}
    </div>
  );
}

export default PaintingEntry;
