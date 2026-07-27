# Production Layout Philosophy

This application is intended to optimize painting layouts the same way an experienced print operator would arrange work on a printing table.

The objective is NOT simply mathematical packing efficiency.

The objective is the most practical production layout.

## Primary Objectives (Highest Priority)

1. Use the fewest possible tables.
2. Minimize waste.
3. Produce clean, easy-to-print layouts.
4. Maintain deterministic, repeatable layouts.

---

# Layout Strategy

The optimizer must completely rebuild the layout whenever the painting list changes.

Triggers include:

- Add Painting
- Delete Painting
- Edit Painting
- Orientation Change

Previous placements are NOT preserved.

The optimizer should always generate the best layout for the current list of paintings.

---

# Fence Priority

The table origin is the FRONT-RIGHT corner.

Coordinate Rules

- X = 0 is the RIGHT fence.
- Y = 0 is the FRONT fence.

Paintings should always attempt to begin against these fences.

There is NO spacing required between paintings and the fences.

---

# Growth Direction

Layouts should grow naturally away from the SAMPLE piece.

Preferred growth direction:

1. Against the right fence.
2. Against the front fence.
3. Expand left.
4. Expand upward.

The occupied area should remain as compact as possible.

---

# Spacing Rules

Maintain exactly 1 inch spacing between:

- paintings
- paintings and SAMPLE

Do NOT add spacing between paintings and the front or right fences.

---

# Human Layout Rules

The optimizer should imitate how an experienced operator would naturally arrange paintings.

Preferred behavior:

- create straight rows
- create straight columns
- align edges whenever possible
- maximize shared edges
- fill existing gaps before expanding
- avoid floating paintings
- avoid isolated pockets
- avoid thin unusable strips
- avoid jagged layouts

Whenever a better arrangement exists, the optimizer is expected to rearrange previously placed paintings.

---

# Placement Strategy

The optimizer evaluates candidate placements, not painting order.

For every remaining painting:

- Generate every legal placement.
- Score every placement.
- Select the single highest scoring placement.
- Place it.
- Recalculate.
- Repeat.

Do not process paintings sequentially.

---

# Placement Priority

Candidate scoring should prioritize:

1. Uses current table.
2. Front fence contact.
3. Right fence contact.
4. Fills an existing gap.
5. Row alignment.
6. Column alignment.
7. Longest shared edge.
8. Smallest overall occupied rectangle.
9. Largest remaining usable free space.

---

# Table Creation

A new table may only be created after:

- Every remaining painting has been evaluated.
- Every legal placement has been considered.
- No remaining painting can fit on the current table.

The optimizer should never create a new table simply because the next painting in the list cannot fit.

---

# Future Optimizer Philosophy

When choosing between two mathematically similar layouts, always prefer the one a human operator would naturally create.

Readable, compact, fence-aligned layouts are preferred over mathematically optimal but fragmented layouts.
# Layout Stability

When two layouts have equal scores, prefer the layout that changes the fewest existing painting positions.

Only move existing paintings when doing so produces a measurably better layout.

Small additions should generally result in small layout changes.
The optimizer is a global optimizer, not a greedy placer. Every layout change causes the entire table arrangement to be recomputed. The objective is to minimize the number of tables used while producing a layout that a knowledgeable human would naturally create. Paintings may be freely moved, rotated, and reordered during optimization. Local placement decisions must never prevent a better overall layout.