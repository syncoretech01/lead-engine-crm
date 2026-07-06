"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type Table as TanstackTable,
  type VisibilityState
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { parseSortParam, useTableUrlSync } from "@/components/data-table/use-table-url-state";

const PAGE_SIZE = 50;

type DataTableProps<TData> = {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  getRowId: (row: TData) => string;
  /** Human labels for the column-visibility menu, keyed by column id. */
  columnLabels?: Record<string, string>;
  searchPlaceholder?: string;
  /** Initial values parsed server-side from searchParams. */
  initialQuery?: string;
  initialSort?: string;
  initialPage?: number;
  /** Empty-state node shown when there are zero rows after filtering. */
  emptyState?: React.ReactNode;
  /** Extra toolbar controls (e.g. filter chips) rendered with access to the table. */
  renderToolbar?: (table: TanstackTable<TData>) => React.ReactNode;
};

export function DataTable<TData>({
  columns,
  data,
  getRowId,
  columnLabels,
  searchPlaceholder,
  initialQuery = "",
  initialSort,
  initialPage = 0,
  emptyState,
  renderToolbar
}: DataTableProps<TData>) {
  const [globalFilter, setGlobalFilter] = React.useState(initialQuery);
  const [sorting, setSorting] = React.useState<SortingState>(() => parseSortParam(initialSort));
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [pagination, setPagination] = React.useState({ pageIndex: initialPage, pageSize: PAGE_SIZE });

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table returns non-memoizable functions by design; the compiler correctly skips memoizing this component.
  const table = useReactTable({
    data,
    columns,
    getRowId,
    state: { globalFilter, sorting, columnFilters, columnVisibility, pagination },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    autoResetPageIndex: false
  });

  // Reset to the first page whenever the search term changes.
  const handleSearchChange = React.useCallback(
    (value: string) => {
      setGlobalFilter(value);
      setPagination((prev) => ({ ...prev, pageIndex: 0 }));
    },
    []
  );

  useTableUrlSync({ q: globalFilter, sort: sorting, page: pagination.pageIndex });

  const rows = table.getRowModel().rows;
  const colSpan = table.getVisibleFlatColumns().length;

  return (
    <div className="flex flex-col">
      <DataTableToolbar
        table={table}
        search={globalFilter}
        onSearchChange={handleSearchChange}
        searchPlaceholder={searchPlaceholder}
        columnLabels={columnLabels}
      >
        {renderToolbar?.(table)}
      </DataTableToolbar>

      <div className="border-t">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead key={header.id} className={cn(canSort && "select-none")}>
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" ? (
                            <ArrowUp className="size-3.5" />
                          ) : sorted === "desc" ? (
                            <ArrowDown className="size-3.5" />
                          ) : (
                            <ChevronsUpDown className="size-3.5 opacity-40" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() ? "selected" : undefined}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={colSpan} className="p-0">
                  {emptyState ?? (
                    <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                      No results.
                    </div>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="border-t">
        <DataTablePagination table={table} />
      </div>
    </div>
  );
}
