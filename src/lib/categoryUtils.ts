/**
 * Shared category utility functions.
 * Single source of truth for deduplication and tree building.
 */
import type { Category } from "@/types";

/** Deduplicate categories by slug, keeping the most complete version */
export function deduplicateCategories(raw: any[]): Category[] {
  const score = (c: any) => {
    let s = 0;
    if (c?.icon_url) s += 2;
    if (c?.image_url) s += 2;
    if (c?.description) s += 1;
    if (c?.show_on_homepage) s += 1;
    return s;
  };

  const bySlug = new Map<string, any>();
  for (const c of raw) {
    const slug = String(c?.slug ?? c?.id ?? "");
    if (!slug) continue;
    const existing = bySlug.get(slug);
    if (!existing) { bySlug.set(slug, c); continue; }
    const aScore = score(existing);
    const bScore = score(c);
    if (bScore > aScore) {
      bySlug.set(slug, c);
    } else if (bScore === aScore) {
      const aOrder = existing?.display_order ?? Number.POSITIVE_INFINITY;
      const bOrder = c?.display_order ?? Number.POSITIVE_INFINITY;
      if (bOrder < aOrder) bySlug.set(slug, c);
    }
  }

  return Array.from(bySlug.values())
    .sort((a, b) => (a?.display_order ?? 0) - (b?.display_order ?? 0)) as Category[];
}

/** Build a parent-child category tree from a flat list */
export function buildCategoryTree(categories: Category[]): Category[] {
  const categoryMap = new Map<string, Category>();
  const roots: Category[] = [];

  categories.forEach((c) => categoryMap.set(c.id, { ...c, children: [] }));
  categories.forEach((c) => {
    const node = categoryMap.get(c.id)!;
    if (c.parent_id) {
      const parent = categoryMap.get(c.parent_id);
      if (parent) {
        parent.children = parent.children || [];
        parent.children.push(node);
      }
    } else {
      roots.push(node);
    }
  });

  return roots;
}
