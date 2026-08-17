export type SortableEntity = { sortKey: string; id: string };

export function compareBySortKey(left: SortableEntity, right: SortableEntity): number {
  return left.sortKey.localeCompare(right.sortKey) || left.id.localeCompare(right.id);
}
