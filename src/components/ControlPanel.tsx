import type { RefObject } from 'react';
import type { Painting } from '../types';
import CurrentOrder from './CurrentOrder';
import PaintingEntry from './PaintingEntry';

interface ControlPanelProps {
  name: string;
  width: string;
  height: string;
  orientation: 'VERT' | 'HORI' | null;
  isEditing: boolean;
  order: Painting[];
  onNameChange: (value: string) => void;
  onWidthChange: (value: string) => void;
  onHeightChange: (value: string) => void;
  onOrientationChange: (value: 'VERT' | 'HORI') => void;
  onAddPainting: () => void;
  onCancelEdit: () => void;
  onPrintLayout: () => Promise<void>;
  isGeneratingPdf: boolean;
  pdfErrorMessage: string | null;
  onClearOrder: () => void;
  onDeletePainting: (id: string) => void;
  onEditPainting: (id: string) => void;
  nameInputRef: RefObject<HTMLInputElement>;
}

function ControlPanel({
  name,
  width,
  height,
  orientation,
  isEditing,
  order,
  onNameChange,
  onWidthChange,
  onHeightChange,
  onOrientationChange,
  onAddPainting,
  onCancelEdit,
  onPrintLayout,
  isGeneratingPdf,
  pdfErrorMessage,
  onClearOrder,
  onDeletePainting,
  onEditPainting,
  nameInputRef,
}: ControlPanelProps) {
  return (
    <section className="panel panel-left">
      <PaintingEntry
        name={name}
        width={width}
        height={height}
        orientation={orientation}
        onNameChange={onNameChange}
        onWidthChange={onWidthChange}
        onHeightChange={onHeightChange}
        onOrientationChange={onOrientationChange}
        onAdd={onAddPainting}
        onCancelEdit={onCancelEdit}
        isEditing={isEditing}
        nameInputRef={nameInputRef}
      />

      <button
        className="generate-button full-width-button"
        type="button"
        onClick={onPrintLayout}
        disabled={isGeneratingPdf}
      >
        {isGeneratingPdf ? 'Generating layout...' : 'Print Layout PDF'}
      </button>
      {pdfErrorMessage ? <p className="pdf-error-message">{pdfErrorMessage}</p> : null}

      <CurrentOrder order={order} onDelete={onDeletePainting} onEditPainting={onEditPainting} />

      <button className="clear-button full-width-button" type="button" onClick={onClearOrder}>
        Clear Order
      </button>
    </section>
  );
}

export default ControlPanel;
