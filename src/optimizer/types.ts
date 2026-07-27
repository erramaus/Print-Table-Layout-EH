export interface Painting {
  id: string;
  referenceNumber: string;
  name?: string;
  width: number;
  height: number;
  orientation: 'VERT' | 'HORI';
  color: string;
}

export interface PlacedPainting {
  id: string;
  referenceNumber: string;
  name?: string;
  sampleType?: 'required' | 'extra';
  width: number;
  height: number;
  orientation: 'VERTICAL' | 'HORIZONTAL';
  rotated: boolean;
  tableNumber: number;
  x: number;
  y: number;
  color: string;
}

export interface TableLayout {
  tableNumber: number;
  paintings: PlacedPainting[];
}

export interface LayoutResult {
  tables: TableLayout[];
  placements: PlacedPainting[];
  messages: string[];
}
