import { useMemo, useState } from 'react';
import './App.css';
import ControlPanel from './components/ControlPanel';
import CoordinatesPanel from './components/CoordinatesPanel';
import MessagesPanel from './components/MessagesPanel';
import PrintTableView from './components/PrintTableView';
import StatisticsPanel from './components/StatisticsPanel';
import { generateLayout as generateLayoutFromOrder } from './optimizer/layoutEngine';
import type { Painting } from './types';

function App() {
  const [name, setName] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [orientation, setOrientation] = useState<'VERTICAL' | 'HORIZONTAL'>('VERTICAL');
  const [order, setOrder] = useState<Painting[]>([]);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const [selectedTableNumber, setSelectedTableNumber] = useState(1);
  const [messages, setMessages] = useState<string[]>([
    'Mandatory test print reserved at (0, 0).',
    'Version 1 interface ready for manual layout review.',
  ]);

  const addPainting = () => {
    const parsedWidth = Number(width);
    const parsedHeight = Number(height);

    if (!Number.isFinite(parsedWidth) || parsedWidth <= 0 || !Number.isFinite(parsedHeight) || parsedHeight <= 0) {
      setMessages((prev) => [
        ...prev,
        'Please enter positive width and height values.',
      ]);
      return;
    }

    const matchingPainting = order.find((item) => item.width === parsedWidth && item.height === parsedHeight);
    const color = matchingPainting?.color ?? `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`;
    const nextReferenceNumber = `#${String(order.length + 1).padStart(2, '0')}`;

    setOrder((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${prev.length}`,
        referenceNumber: nextReferenceNumber,
        name: name.trim() || undefined,
        width: parsedWidth,
        height: parsedHeight,
        orientation,
        color,
      },
    ]);

    setName('');
    setWidth('');
    setHeight('');
    setOrientation('VERTICAL');
    setMessages((prev) => [
      ...prev,
      `Added ${nextReferenceNumber} at ${parsedWidth}" × ${parsedHeight}".`,
    ]);
  };

  const generateLayout = () => {
    const layoutResult = generateLayoutFromOrder(order);
    setSelectedTableNumber(1);
    setSelectedPlacementId(null);
    setLayoutVersion((prev) => prev + 1);
    setMessages((prev) => [
      ...prev,
      ...layoutResult.messages,
    ]);
  };

  const deletePainting = (id: string) => {
    setOrder((prev) => prev.filter((item) => item.id !== id));
    setMessages((prev) => [
      ...prev,
      'Removed a painting from the current order.',
    ]);
  };

  const clearOrder = () => {
    setOrder([]);
    setMessages((prev) => [
      ...prev,
      'Cleared the current order.',
    ]);
  };

  const layout = useMemo(() => generateLayoutFromOrder(order), [order, layoutVersion]);

  const activeTable = useMemo(() => {
    return layout.tables.find((table) => table.tableNumber === selectedTableNumber) ?? layout.tables[0];
  }, [layout, selectedTableNumber]);

  const coordinates = useMemo(() => {
    const toMillimeters = (inches: number) => Math.round(inches * 25.4);

    return activeTable.paintings
      .filter((item) => item.id !== '-1')
      .map((item) => ({
        id: item.id,
        referenceNumber: item.referenceNumber,
        name: item.name ?? item.referenceNumber,
        dimensions: `${item.width} × ${item.height}`,
        orientation: item.orientation,
        tableNumber: item.tableNumber,
        x: toMillimeters(item.x),
        y: toMillimeters(item.y),
      }));
  }, [activeTable]);

  const totalArea = useMemo(() => {
    return order.reduce((sum, item) => sum + item.width * item.height, 0);
  }, [order]);

  const tablesUsed = layout.tables.length;
  const wasteArea = 0;
  const wastePercentage = 0;
  const extraSamplePieces = 0;

  return (
    <div className="app-shell">
      <header className="app-header">
        <p className="app-label">Print Table Optimizer</p>
      </header>

      <main className="app-grid">
        <ControlPanel
          name={name}
          width={width}
          height={height}
          orientation={orientation}
          order={order}
          onNameChange={setName}
          onWidthChange={setWidth}
          onHeightChange={setHeight}
          onOrientationChange={setOrientation}
          onAddPainting={addPainting}
          onOptimize={generateLayout}
          onClearOrder={clearOrder}
          onDeletePainting={deletePainting}
        />

        <div className="content-stack">
          <PrintTableView
            tables={layout.tables}
            activeTableNumber={selectedTableNumber}
            placements={activeTable.paintings}
            selectedPlacementId={selectedPlacementId}
            onSelectPlacement={setSelectedPlacementId}
            onSelectTable={(tableNumber) => {
              setSelectedTableNumber(tableNumber);
              setSelectedPlacementId(null);
            }}
          />
          <div className="stats-panel">
            <CoordinatesPanel
              coordinates={coordinates}
              selectedPlacementId={selectedPlacementId}
              onSelectCoordinate={setSelectedPlacementId}
            />
            <StatisticsPanel
              totalPaintings={order.length}
              totalArea={totalArea}
              tablesUsed={tablesUsed}
              wasteArea={wasteArea}
              wastePercentage={wastePercentage}
              extraSamplePieces={extraSamplePieces}
            />
          </div>
          <MessagesPanel messages={messages} />
        </div>
      </main>
    </div>
  );
}

export default App;
