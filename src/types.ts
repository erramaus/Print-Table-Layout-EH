export interface Painting {
  id: string;
  referenceNumber: string;
  name?: string;
  width: number;
  height: number;
  orientation: 'VERTICAL' | 'HORIZONTAL';
  color: string;
}
