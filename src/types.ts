export interface Painting {
  id: string;
  referenceNumber: string;
  name?: string;
  width: number;
  height: number;
  orientation: 'VERT' | 'HORI';
  color: string;
}
