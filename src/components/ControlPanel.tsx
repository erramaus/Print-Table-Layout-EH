import type { RefObject } from 'react';
import type { Painting } from '../types';
import CurrentOrder from './CurrentOrder';
import PaintingEntry from './PaintingEntry';

interface ControlPanelProps {
  name: string;
  width: string;
  height: string;
  orientation: 'VERTICAL' | 'HORIZONTAL' | null;
  order: Painting[];
  onNameChange: (value: string) => void;
  onWidthChange: (value: string) => void;
  onHeightChange: (value: string) => void;
  onOrientationChange: (value: 'VERTICAL' | 'HORIZONTAL') => void;
  onAddPainting: () => void;
  onPrintLayout: () => Promise<void>;
  onClearOrder: () => void;
  onDeletePainting: (id: string) => void;
  nameInputRef: RefObject<HTMLInputElement>;
}

function ControlPanel({
  name,
  width,
  height,
  orientation,
  order,
  onNameChange,
  onWidthChange,
  onHeightChange,
  onOrientationChange,
  onAddPainting,
  onPrintLayout,
  onClearOrder,
  onDeletePainting,
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
        nameInputRef={nameInputRef}
      />

      <button className="generate-button full-width-button" onClick={onPrintLayout}>
        Print Layout PDF
      </button>

      <CurrentOrder order={order} onDelete={onDeletePainting} />

      <button className="clear-button full-width-button" onClick={onClearOrder}>
        Clear Order
      </button>
    </section>
  );
}

export default ControlPanel;
