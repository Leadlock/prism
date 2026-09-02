/*
 * Tiny dependency-free grid layout engine for the dashboard.
 * Items are { id, x, y, w, h } in grid units (x/w across `cols`, y/h in rows).
 * Layout gravity is upward: compact() pulls every item as far up as it fits,
 * so there are never vertical gaps.
 */

export const GRID_COLS = 12;
export const ROW_PX = 12;   // height of one grid row unit (px)
export const GRID_MARGIN = 16; // px gutter between cells, both axes
export const MIN_W = 3;     // narrowest a widget may be resized

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function collides(a, b) {
  return (
    a.id !== b.id &&
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

/** Gravity toward the top-left: pull each item up, then left, until it settles. */
export function compact(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed = [];
  for (const it of sorted) {
    let x = it.x;
    let y = it.y;
    let moved = true;
    while (moved) {
      moved = false;
      while (y > 0 && !placed.some((p) => collides({ ...it, x, y: y - 1 }, p))) { y--; moved = true; }
      while (x > 0 && !placed.some((p) => collides({ ...it, x: x - 1, y }, p))) { x--; moved = true; }
    }
    placed.push({ ...it, x, y });
  }
  // preserve caller's array order
  return items.map((it) => placed.find((p) => p.id === it.id));
}

/**
 * Resolve every overlap by pushing the lower/later item straight down, then
 * compact. `priority` (an id) is never displaced — everything yields to it.
 */
export function resolveCollisions(items, priorityId) {
  let result = items.map((i) => ({ ...i }));
  const order = [...result].sort((a, b) =>
    a.id === priorityId ? -1 : b.id === priorityId ? 1 : a.y - b.y || a.x - b.x
  );
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      if (collides(order[i], order[j])) {
        order[j].y = order[i].y + order[i].h;
      }
    }
  }
  const compacted = compact(order.filter((i) => i.id !== priorityId));
  const prio = order.find((i) => i.id === priorityId);
  const merged = prio ? [prio, ...compacted] : compacted;
  return items.map((it) => merged.find((m) => m.id === it.id));
}

/** Move `id` to (x, y); push whatever it lands on out of the way, then compact. */
export function moveItem(items, id, x, y) {
  const moving = items.find((i) => i.id === id);
  if (!moving) return items;
  const next = items.map((i) =>
    i.id === id
      ? { ...i, x: clamp(x, 0, GRID_COLS - moving.w), y: Math.max(0, y) }
      : i
  );
  return resolveCollisions(next, id);
}

/**
 * Resize `id` to `w` cols / `h` rows; reflow whatever it now overlaps, compact.
 * `minH` (content-fit floor, row units) keeps a widget from ever clipping its
 * content — there are no scrollbars inside widgets.
 */
export function resizeItem(items, id, w, h, minH = 2) {
  const it = items.find((i) => i.id === id);
  if (!it) return items;
  const next = items.map((i) =>
    i.id === id
      ? { ...i, w: clamp(w, MIN_W, GRID_COLS - it.x), h: Math.max(minH, Math.round(h)) }
      : i
  );
  return resolveCollisions(next, id);
}

/** First free slot scanning top-to-bottom, left-to-right. */
export function firstFreeSlot(existing, w, h) {
  for (let y = 0; y < 5000; y++) {
    for (let x = 0; x <= GRID_COLS - w; x++) {
      const cand = { id: "__probe", x, y, w, h };
      if (!existing.some((e) => collides(cand, e))) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

/**
 * Build a full item list for `order`. Honours saved {x,y,w,h}; for widgets with
 * no saved height, uses the measured content height (`heights`, row units).
 * User-set heights win outright — content that overflows scrolls.
 */
export function buildLayout(order, saved, heights, defaultW) {
  const placed = [];
  for (const id of order) {
    const s = saved[id];
    const w = clamp(s?.w || defaultW(id), MIN_W, GRID_COLS);
    // content-fit height is always the floor — widgets never scroll
    const contentH = heights[id] || 12;
    const h = Math.max(contentH, s?.h || 0);
    const hasPos = s && Number.isFinite(s.x) && Number.isFinite(s.y);
    const pos = hasPos
      ? { x: clamp(s.x, 0, GRID_COLS - w), y: Math.max(0, s.y) }
      : firstFreeSlot(placed, w, h);
    placed.push({ id, x: pos.x, y: pos.y, w, h });
  }
  return resolveCollisions(placed, null);
}

/** Bottom edge of the layout in row units (for container height). */
export function layoutRows(items) {
  return items.reduce((m, it) => Math.max(m, it.y + it.h), 0);
}

/** Pixel geometry of one item given the current column width. */
export function itemBox(it, colW) {
  return {
    left: it.x * (colW + GRID_MARGIN),
    top: it.y * (ROW_PX + GRID_MARGIN),
    width: it.w * colW + (it.w - 1) * GRID_MARGIN,
    height: it.h * ROW_PX + (it.h - 1) * GRID_MARGIN,
  };
}

/** Column width in px for a container of `containerW`. */
export function colWidth(containerW) {
  return (containerW - (GRID_COLS - 1) * GRID_MARGIN) / GRID_COLS;
}

/** Pointer offset (px, relative to grid) → grid cell. */
export function pxToCell(px, py, colW) {
  return {
    x: Math.round(px / (colW + GRID_MARGIN)),
    y: Math.round(py / (ROW_PX + GRID_MARGIN)),
  };
}
