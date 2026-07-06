"use client";

import type { Table } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export function DataTablePagination<TData>({ table }: { table: Table<TData> }) {
  const pageIndex = table.getState().pagination.pageIndex;
  const pageCount = table.getPageCount();
  const filteredRows = table.getFilteredRowModel().rows.length;
  const totalRows = table.getCoreRowModel().rows.length;

  if (pageCount <= 1 && filteredRows === totalRows) {
    return (
      <div className="flex items-center justify-between px-3 py-2.5 text-xs text-muted-foreground">
        <span>{totalRows.toLocaleString()} rows</span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2.5 text-xs text-muted-foreground">
      <span>
        {filteredRows.toLocaleString()}
        {filteredRows !== totalRows ? ` of ${totalRows.toLocaleString()}` : ""} rows
      </span>
      <div className="flex items-center gap-3">
        <span>
          Page {pageIndex + 1} of {Math.max(pageCount, 1)}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label="Previous page"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label="Next page"
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
