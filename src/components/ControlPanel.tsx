import type { Painting } from '../types';
import CurrentOrder from './CurrentOrder';
import PaintingEntry from './PaintingEntry';

interface ControlPanelProps {
  name: string;
  width: string;
  height: string;
  orientation: 'VERTICAL' | 'HORIZONTAL';
  order: Painting[];
  onNameChange: (value: string) => void;
  onWidthChange: (value: string) => void;
  onHeightChange: (value: string) => void;
  onOrientationChange: (value: 'VERTICAL' | 'HORIZONTAL') => void;
  onAddPainting: () => void;
  onOptimize: () => void;
  onClearOrder: () => void;
  onDeletePainting: (id: string) => void;
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
  onOptimize,
  onClearOrder,
  onDeletePainting,
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
      />

      <CurrentOrder order={order} onDelete={onDeletePainting} />

      <div className="action-buttons">
        <button className="primary-button" onClick={onOptimize}>
          Generate Layout
        </button>
        <button className="clear-button" onClick={onClearOrder}>
          Clear Order
        </button>
      </div>
    </section>
  );
}

export default ControlPanel;
