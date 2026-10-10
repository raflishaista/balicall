export const GRID_PAGE_SIZE = 9;
export const TILE_RATIO = 16 / 9;

export function fitParticipantGrid(count: number, width: number, height: number, gap = 12) {
  const desired = count <= 1 ? 1 : count <= 4 ? 2 : 3;
  const responsive = width < 340 ? 1 : width < 760 ? 2 : 3;
  const columns = Math.min(desired, responsive);
  const rows = Math.max(1, Math.ceil(count / columns));
  const tileWidth = Math.max(1, Math.min(
    (width - gap * (columns - 1)) / columns,
    (height - gap * (rows - 1)) / rows * TILE_RATIO,
  ));
  return { columns, rows, tileWidth };
}

export function participantPage<T>(items: T[], requested: number, size = GRID_PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.max(0, Math.min(requested, pages - 1));
  return { page, pages, items: items.slice(page * size, (page + 1) * size) };
}

export function orderParticipants<T extends { identity: string; joinedAt?: Date }>(items: T[]): T[] {
  return items.toSorted((a, b) => (a.joinedAt?.getTime() || 0) - (b.joinedAt?.getTime() || 0) || a.identity.localeCompare(b.identity));
}

