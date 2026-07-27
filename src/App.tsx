import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import ControlPanel from './components/ControlPanel';
import CoordinatesPanel from './components/CoordinatesPanel';
import MessagesPanel from './components/MessagesPanel';
import PrintTableView from './components/PrintTableView';
import StatisticsPanel from './components/StatisticsPanel';
import {
  generateLayout as generateLayoutFromOrder,
  getOptimizerDebugOverlay,
  isOptimizerDebugOverlayEnabled,
} from './optimizer/layoutEngine';
import { TABLE_HEIGHT_INCHES, TABLE_WIDTH_INCHES } from './constants/tableDimensions';
import type { LayoutResult } from './optimizer/types';
import { createLayoutPdf } from './utils/pdfExport';
import type { Painting } from './types';

interface AppSnapshot {
  order: Painting[];
  selectedPlacementId: string | null;
  selectedTableNumber: number;
  editingPaintingId: string | null;
  name: string;
  width: string;
  height: string;
  orientation: 'VERT' | 'HORI' | null;
}

interface DeleteConfirmation {
  id: string;
  referenceNumber: string;
}

function App() {
  const runtimeEnv = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env;
  const isDev = Boolean(runtimeEnv?.DEV);
  const [name, setName] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [orientation, setOrientation] = useState<'VERT' | 'HORI' | null>(null);
  const [order, setOrder] = useState<Painting[]>([]);
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const [editingPaintingId, setEditingPaintingId] = useState<string | null>(null);
  const [selectedTableNumber, setSelectedTableNumber] = useState(1);
  const [history, setHistory] = useState<AppSnapshot[]>([]);
  const [future, setFuture] = useState<AppSnapshot[]>([]);
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const previousLayoutRef = useRef<LayoutResult | null>(null);
  const nextReferenceValueRef = useRef<number>(0);
  const [messages, setMessages] = useState<string[]>([
    'Mandatory test print reserved at (0, 0).',
    'Version 1 interface ready for manual layout review.',
  ]);
  const [pdfStatus, setPdfStatus] = useState<'idle' | 'generating' | 'success' | 'error'>('idle');
  const [pdfErrorMessage, setPdfErrorMessage] = useState<string | null>(null);

  const logPdfFlow = (stage: string, detail?: unknown) => {
    if (!isDev) {
      return;
    }

    if (detail === undefined) {
      console.log(`[pdf] ${stage}`);
      return;
    }

    console.log(`[pdf] ${stage}`, detail);
  };

  const clearEntryForm = () => {
    setName('');
    setWidth('');
    setHeight('');
    setOrientation(null);
    setEditingPaintingId(null);
  };

  const captureSnapshot = (): AppSnapshot => ({
    order,
    selectedPlacementId,
    selectedTableNumber,
    editingPaintingId,
    name,
    width,
    height,
    orientation,
  });

  const restoreSnapshot = (snapshot: AppSnapshot) => {
    setOrder(snapshot.order);
    setSelectedPlacementId(snapshot.selectedPlacementId);
    setSelectedTableNumber(snapshot.selectedTableNumber);
    setEditingPaintingId(snapshot.editingPaintingId);
    setName(snapshot.name);
    setWidth(snapshot.width);
    setHeight(snapshot.height);
    setOrientation(snapshot.orientation);
  };

  const commitHistory = () => {
    setHistory((prev) => [...prev.slice(-49), captureSnapshot()]);
    setFuture([]);
  };

  const beginEditPainting = (paintingId: string) => {
    const painting = order.find((item) => item.id === paintingId);

    if (!painting) {
      return;
    }

    setName(painting.name ?? '');
    setWidth(String(painting.width));
    setHeight(String(painting.height));
    setOrientation(painting.orientation);
    setEditingPaintingId(painting.id);
  };

  const addPainting = () => {
    const parsedWidth = Number(width);
    const parsedHeight = Number(height);

    if (orientation === null) {
      setMessages((prev) => [
        ...prev,
        'Please select an orientation.',
      ]);
      return;
    }

    if (!Number.isFinite(parsedWidth) || parsedWidth <= 0 || !Number.isFinite(parsedHeight) || parsedHeight <= 0) {
      setMessages((prev) => [
        ...prev,
        'Please enter positive width and height values.',
      ]);
      return;
    }

    if (editingPaintingId) {
      commitHistory();
      const editingPainting = order.find((item) => item.id === editingPaintingId);
      setOrder((prev) =>
        prev.map((item) =>
          item.id === editingPaintingId
            ? {
                ...item,
                name: name.trim() || undefined,
                width: parsedWidth,
                height: parsedHeight,
                orientation,
              }
            : item
        )
      );

      clearEntryForm();
      nameInputRef.current?.focus();
      setMessages((prev) => [
        ...prev,
        `Updated ${editingPainting?.referenceNumber ?? 'painting'}.`,
      ]);
      return;
    }

    const matchingPainting = order.find((item) => item.width === parsedWidth && item.height === parsedHeight);
    const color = matchingPainting?.color ?? `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`;

    const currentMaxReference = order.reduce((max, item) => {
      const match = item.referenceNumber.match(/^#(\d+)$/);
      if (!match) {
        return max;
      }
      return Math.max(max, Number(match[1]));
    }, nextReferenceValueRef.current);

    const nextReferenceValue = currentMaxReference + 1;
    nextReferenceValueRef.current = nextReferenceValue;
    const nextReferenceNumber = `#${String(nextReferenceValue).padStart(2, '0')}`;

    commitHistory();

    setOrder((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        referenceNumber: nextReferenceNumber,
        name: name.trim() || undefined,
        width: parsedWidth,
        height: parsedHeight,
        orientation,
        color,
      },
    ]);

    clearEntryForm();
    nameInputRef.current?.focus();
    setMessages((prev) => [
      ...prev,
      `Added ${nextReferenceNumber} at ${parsedWidth}" × ${parsedHeight}".`,
    ]);
  };

  const cancelEdit = () => {
    clearEntryForm();
    nameInputRef.current?.focus();
  };

  const requestDeletePainting = (id: string) => {
    const painting = order.find((item) => item.id === id);
    if (!painting) {
      return;
    }

    setDeleteConfirmation({ id: painting.id, referenceNumber: painting.referenceNumber });
  };

  const removePaintingById = (id: string) => {
    const painting = order.find((item) => item.id === id);
    if (!painting) {
      return;
    }

    commitHistory();
    setOrder((prev) => prev.filter((item) => item.id !== id));
    if (editingPaintingId === id) {
      clearEntryForm();
    }
    if (selectedPlacementId === id) {
      setSelectedPlacementId(null);
    }
    setMessages((prev) => [
      ...prev,
      `Removed ${painting.referenceNumber} from the current order.`,
    ]);
  };

  const confirmDeletePainting = () => {
    if (!deleteConfirmation) {
      return;
    }

    removePaintingById(deleteConfirmation.id);
    setDeleteConfirmation(null);
  };

  const cancelDeletePainting = () => {
    setDeleteConfirmation(null);
  };

  const undo = () => {
    setHistory((prev) => {
      if (prev.length === 0) {
        return prev;
      }

      const previousSnapshot = prev[prev.length - 1];
      setFuture((futurePrev) => [captureSnapshot(), ...futurePrev].slice(0, 50));
      restoreSnapshot(previousSnapshot);
      return prev.slice(0, -1);
    });
  };

  const redo = () => {
    setFuture((prev) => {
      if (prev.length === 0) {
        return prev;
      }

      const nextSnapshot = prev[0];
      setHistory((historyPrev) => [...historyPrev.slice(-49), captureSnapshot()]);
      restoreSnapshot(nextSnapshot);
      return prev.slice(1);
    });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isCtrlOrMeta = event.ctrlKey || event.metaKey;
      if (!isCtrlOrMeta) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [history, future, order, selectedPlacementId, selectedTableNumber, editingPaintingId, name, width, height, orientation]);

  const printLayout = async () => {
    logPdfFlow('button clicked');

    if (pdfStatus === 'generating') {
      setMessages((prev) => [...prev, 'PDF generation is already in progress.']);
      return;
    }

    if (order.length === 0 || !layout.tables.length) {
      setMessages((prev) => [...prev, 'No layout is available to print.']);
      return;
    }

    setPdfStatus('generating');
    setPdfErrorMessage(null);
    logPdfFlow('PDF generation started');

    try {
      logPdfFlow('layout data received', {
        tables: layout.tables.length,
        placements: layout.placements.length,
        totalPaintings: order.length,
      });

      const generatedDate = new Date().toLocaleString();
      const pdfBytes = await createLayoutPdf({
        layout,
        totalPaintings: order.length,
        totalArea,
        wasteArea,
        wastePercentage,
        generatedDate,
      });

      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
      logPdfFlow('PDF blob created', { bytes: blob.size, mime: blob.type });

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `print-layout-${generatedDate.replace(/[:\/ ,]+/g, '_')}.pdf`;
      link.click();
      logPdfFlow('download triggered', { fileName: link.download });
      URL.revokeObjectURL(url);

      setPdfStatus('success');
      setMessages((prev) => [...prev, `PDF generated successfully (${layout.tables.length} table(s)).`]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown PDF generation error.';
      setPdfStatus('error');
      setPdfErrorMessage(message);
      setMessages((prev) => [...prev, `Failed to generate PDF: ${message}`]);
      logPdfFlow('PDF generation failed', error);
      if (isDev) {
        console.error('[pdf] generation failed', error);
      }
    }
  };

  const deletePainting = (id: string) => {
    removePaintingById(id);
  };

  const clearOrder = () => {
    setOrder([]);
    setMessages((prev) => [
      ...prev,
      'Cleared the current order.',
    ]);
  };

  const layout = useMemo(() => generateLayoutFromOrder(order, previousLayoutRef.current), [order]);
  const debugOverlayEnabled = isOptimizerDebugOverlayEnabled();

  const visibleLayout = useMemo(
    () => ({
      ...layout,
      tables: layout.tables.map((table) => ({
        ...table,
        paintings: table.paintings.filter((painting) => painting.sampleType !== 'extra'),
      })),
      placements: layout.placements.filter((placement) => placement.sampleType !== 'extra'),
    }),
    [layout]
  );

  useEffect(() => {
    previousLayoutRef.current = layout;
  }, [layout]);

  const activeTable = useMemo(() => {
    return visibleLayout.tables.find((table) => table.tableNumber === selectedTableNumber) ?? visibleLayout.tables[0];
  }, [visibleLayout, selectedTableNumber]);

  const debugOverlay = useMemo(() => {
    if (!debugOverlayEnabled || !activeTable) {
      return null;
    }

    return getOptimizerDebugOverlay(visibleLayout, order, activeTable.tableNumber);
  }, [activeTable, debugOverlayEnabled, order, visibleLayout]);

  const coordinates = useMemo(() => {
    const toMillimeters = (inches: number) => Math.round(inches * 25.4);

    return activeTable.paintings
      .filter((item) => item.sampleType !== 'extra')
      .map((item) => ({
        id: item.id,
        referenceNumber: item.sampleType === 'required' ? 'SAMPLE' : item.referenceNumber,
        name: item.sampleType === 'required' ? 'SAMPLE LOCK FIXED' : item.name ?? item.referenceNumber,
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
  const wasteArea = useMemo(() => {
    const totalTableArea = tablesUsed * TABLE_WIDTH_INCHES * TABLE_HEIGHT_INCHES;
    return Math.max(0, totalTableArea - totalArea);
  }, [tablesUsed, totalArea]);

  const wastePercentage = useMemo(() => {
    const totalTableArea = tablesUsed * TABLE_WIDTH_INCHES * TABLE_HEIGHT_INCHES;
    if (totalTableArea <= 0) {
      return 0;
    }
    return (wasteArea / totalTableArea) * 100;
  }, [tablesUsed, wasteArea]);
  const extraSamplePieces = layout.tables.reduce(
    (sum, table) => sum + table.paintings.filter((painting) => painting.sampleType === 'extra').length,
    0
  );

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
          isEditing={editingPaintingId !== null}
          order={order}
          onNameChange={setName}
          onWidthChange={setWidth}
          onHeightChange={setHeight}
          onOrientationChange={setOrientation}
          onAddPainting={addPainting}
          onCancelEdit={cancelEdit}
          nameInputRef={nameInputRef}
          onPrintLayout={printLayout}
          isGeneratingPdf={pdfStatus === 'generating'}
          pdfErrorMessage={pdfErrorMessage}
          onClearOrder={clearOrder}
          onDeletePainting={deletePainting}
          onEditPainting={beginEditPainting}
        />

        <div className="content-stack">
          <PrintTableView
            tables={visibleLayout.tables}
            activeTableNumber={selectedTableNumber}
            placements={activeTable.paintings}
            debugOverlay={debugOverlay}
            selectedPlacementId={selectedPlacementId}
            onSelectPlacement={(id) => {
              setSelectedPlacementId(id);
              if (id) {
                beginEditPainting(id);
              }
            }}
            onSelectTable={(tableNumber) => {
              setSelectedTableNumber(tableNumber);
              setSelectedPlacementId(null);
            }}
            onEditPainting={(id) => {
              setSelectedPlacementId(id);
              beginEditPainting(id);
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

      {deleteConfirmation ? (
        <div className="delete-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title">
          <div className="delete-confirm-modal">
            <h3 id="delete-confirm-title">Delete painting {deleteConfirmation.referenceNumber}?</h3>
            <div className="delete-confirm-actions">
              <button className="delete-button" type="button" onClick={confirmDeletePainting}>
                Delete
              </button>
              <button className="clear-button" type="button" onClick={cancelDeletePainting}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
