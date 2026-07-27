import { generateLayout, generateLayoutWithoutExtraSamples, isPlacementValid } from '../src/optimizer/layoutEngine';
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

function candidatesFrom(valueInches: number) {
  const mm = toMm(valueInches);
  const base = Math.round(mm / 5) * 5;
  return [base, base - 5, base + 5, base - 10, base + 10].map(toInches);
}

for (const fixture of fixtures) {
  const layouts = [
    { label: 'without-extra-samples', layout: generateLayoutWithoutExtraSamples(fixture.order) },
    { label: 'with-extra-samples', layout: generateLayout(fixture.order) },
  ];

  for (const entry of layouts) {
    const placement = entry.layout.placements.find((p) => p.referenceNumber === '#01' && !p.sampleType);
    if (!placement) {
      console.log(`[${fixture.name}][${entry.label}] missing #01`);
      continue;
    }

    const table = entry.layout.tables.find((t) => t.tableNumber === placement.tableNumber);
    const others = (table?.paintings ?? []).filter((p) => p.id !== placement.id);

    console.log(`\n[${fixture.name}][${entry.label}] #01 before`);
    console.log({
      xMm: Number(toMm(placement.x).toFixed(3)),
      yMm: Number(toMm(placement.y).toFixed(6)),
      front001: Math.abs(toMm(placement.y)) <= 0.001,
      front01: Math.abs(toMm(placement.y)) <= 0.01,
    });

    const checked = candidatesFrom(placement.x).map((candidateX) => {
      const validAtCurrentY = isPlacementValid({ x: candidateX, y: placement.y }, placement.width, placement.height, others);
      const validAtYZero = isPlacementValid({ x: candidateX, y: 0 }, placement.width, placement.height, others);
      return {
        xMm: Number(toMm(candidateX).toFixed(3)),
        validAtCurrentY,
        validAtYZero,
      };
    });

    console.log(`[${fixture.name}][${entry.label}] candidates`);
    console.table(checked);
  }
}
