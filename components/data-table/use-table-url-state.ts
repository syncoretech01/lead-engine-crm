"use client";

import * as React from "react";
import type { SortingState } from "@tanstack/react-table";

export type TableUrlState = {
  q: string;
  sort: SortingState;
  page: number;
};

export function parseSortParam(sort: string | undefined): SortingState {
  if (!sort) return [];
  const desc = sort.startsWith("-");
  const id = desc ? sort.slice(1) : sort;
  return id ? [{ id, desc }] : [];
}

function serializeSort(sort: SortingState): string {
  if (sort.length === 0) return "";
  const first = sort[0]!;
  return `${first.desc ? "-" : ""}${first.id}`;
}

/**
 * Syncs a table's search / sort / page to the URL query string via
 * history.replaceState — NOT router.replace — so filtering a force-dynamic page
 * never triggers a server refetch. Initial values come from the server-parsed
 * searchParams. Returns nothing; call it with the live table state.
 */
export function useTableUrlSync(state: TableUrlState) {
  const { q, sort, page } = state;

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);

    if (q) params.set("q", q);
    else params.delete("q");

    const sortParam = serializeSort(sort);
    if (sortParam) params.set("sort", sortParam);
    else params.delete("sort");

    if (page > 0) params.set("page", String(page + 1));
    else params.delete("page");

    const query = params.toString();
    const next = `${window.location.pathname}${query ? `?${query}` : ""}`;
    window.history.replaceState(window.history.state, "", next);
  }, [q, sort, page]);
}
