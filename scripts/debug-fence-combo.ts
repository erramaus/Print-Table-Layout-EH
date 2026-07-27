import { generateLayoutWithoutExtraSamples, isPlacementValid } from '../src/optimizer/layoutEngine';
import { MM_PER_INCH } from '../src/constants/tableDimensions';
import type { Painting, PlacedPainting } from '../src/optimizer/types';

const fixtures: Array<{ name: string; order: Painting[] }> = [
  {
    name: 'mixed-large-small',
    order: [
      { id: 'fixture-1', referenceNumber: '#01', name: 'P1', width: 48, height: 36, orientation: 'VERT', color: '#336699' },
      { id: 'fixture-2', referenceNumber: '#02', name: 'P2', width: 42, height: 30, orientation: 'HORI', color: '#336699' },
      { id: 'fixture-3', referenceNumber: '#03', name: 'P3', width: 18, height: 12, orientation: 'HORI', color: '#336699' },
    ],
  },
  {
    name: 'depth-aware-right-fence',
    order: [
      { id: 'fixture-1', referenceNumber: '#01', name: 'P1', width: 40, height: 48, orientation: 'VERT', color: '#336699' },
      { id: 'fixture-2', referenceNumber: '#02', name: 'P2', width: 28, height: 56, orientation: 'VERT', color: '#336699' },
      { id: 'fixture-3', referenceNumber: '#03', name: 'P3', width: 28, height: 47, orientation: 'VERT', color: '#336699' },
    ],
  },
];

const toMm = (value: number) => value * MM_PER_INCH;
const toInches = (value: number) => value / MM_PER_INCH;

function candidateSet(x: number) {
  const xMm = toMm(x);
  const base = Math.round(xMm / 5) * 5;
  const values = [base, base - 5, base + 5, base - 10, base + 10];
  const unique = new Map<string, number>();
  for (const mm of values) unique.set(mm.toFixed(3), toInches(mm));
  return Array.from(unique.values());
}

function backtrack(
  frontPlacements: PlacedPainting[],
  allPlacements: PlacedPainting[],
  idx: number,
  current: Map<string, number>
): Map<string, number> | null {
  if (idx >= frontPlacements.length) return new Map(current);

  const p = frontPlacements[idx];
  const candidates = candidateSet(p.x);
  for (const cx of candidates) {
    const mutated = allPlacements.map((item) => {
      if (item.id !== p.id) return item;
      return { ...item, x: cx, y: 0 };
    });
    const me = mutated.find((item) => item.id === p.id)!;
    const others = mutated.filter((item) => item.id !== p.id);
    if (!isPlacementValid({ x: me.x, y: me.y }, me.width, me.height, others)) {
      continue;
    }

    current.set(p.id, cx);
    const solved = backtrack(frontPlacements, mutated, idx + 1, current);
    if (solved) return solved;
    current.delete(p.id);
  }

  return null;
}

for (const fixture of fixtures) {
  const layout = generateLayoutWithoutExtraSamples(fixture.order);
  const movable = layout.placements.filter((p) => !p.sampleType);
  const front = movable.filter((p) => Math.abs(toMm(p.y)) <= 0.01);

  console.log(`\n[${fixture.name}] front placements`);
  console.table(front.map((p) => ({ ref: p.referenceNumber, xMm: Number(toMm(p.x).toFixed(3)), yMm: Number(toMm(p.y).toFixed(6)) })));

  const solved = backtrack(front, movable, 0, new Map());
  if (!solved) {
    console.log(`[${fixture.name}] no valid 5mm combo found in bounded candidate set`);
  } else {
    console.log(`[${fixture.name}] valid bounded combo found`);
    for (const p of front) {
      const x = solved.get(p.id);
      console.log(`${p.referenceNumber}: ${Number(toMm(p.x).toFixed(3))} -> ${Number(toMm(x ?? p.x).toFixed(3))}`);
    }
  }
}
