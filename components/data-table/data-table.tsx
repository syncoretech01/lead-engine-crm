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
  type RowSelectionState,
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
import { Checkbox } from "@/components/ui/checkbox";
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
  /** Enable a leading checkbox column + bulk-action bar. */
  enableSelection?: boolean;
  /** Floating bar shown while rows are selected. */
  renderBulkBar?: (args: { selected: TData[]; clear: () => void }) => React.ReactNode;
  /** Clicking a row (outside interactive cells) invokes this — e.g. open a peek. */
  onRowClick?: (row: TData, context: { rows: TData[]; index: number }) => void;
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
  renderToolbar,
  enableSelection,
  renderBulkBar,
  onRowClick
}: DataTableProps<TData>) {
  const [globalFilter, setGlobalFilter] = React.useState(initialQuery);
  const [sorting, setSorting] = React.useState<SortingState>(() => parseSortParam(initialSort));
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [pagination, setPagination] = React.useState({ pageIndex: initialPage, pageSize: PAGE_SIZE });

  const allColumns = React.useMemo<ColumnDef<TData, unknown>[]>(() => {
    if (!enableSelection) return columns;
    const selectionColumn: ColumnDef<TData, unknown> = {
      id: "__select",
      enableSorting: false,
      enableHiding: false,
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(Boolean(value))}
          aria-label="Select all rows on this page"
        />
      ),
      cell: ({ row }) => (
        <span onClick={(event) => event.stopPropagation()}>
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(Boolean(value))}
            aria-label="Select row"
          />
        </span>
      )
    };
    return [selectionColumn, ...columns];
  }, [columns, enableSelection]);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table returns non-memoizable functions by design; the compiler correctly skips memoizing this component.
  const table = useReactTable({
    data,
    columns: allColumns,
    getRowId,
    enableRowSelection: enableSelection,
    state: { globalFilter, sorting, columnFilters, columnVisibility, rowSelection, pagination },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    autoResetPageIndex: false
  });

  const selectedRows = table.getSelectedRowModel().rows.map((row) => row.original);
  const clearSelection = React.useCallback(() => setRowSelection({}), []);

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
  const queueRows = table.getPrePaginationRowModel().rows;
  const queueDataRows = queueRows.map((row) => row.original);
  const queueIndexById = new Map(queueRows.map((row, index) => [row.id, index]));
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
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  className={cn(onRowClick && "cursor-pointer")}
                  onClick={
                    onRowClick
                      ? () => onRowClick(row.original, { rows: queueDataRows, index: queueIndexById.get(row.id) ?? 0 })
                      : undefined
                  }
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === "Enter" && event.currentTarget === event.target) {
                            event.preventDefault();
                            onRowClick(row.original, { rows: queueDataRows, index: queueIndexById.get(row.id) ?? 0 });
                          }
                        }
                      : undefined
                  }
                >
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

      {enableSelection && renderBulkBar && selectedRows.length > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border bg-popover px-3 py-2 text-sm shadow-lg">
            <span className="pl-1 font-medium tabular-nums">{selectedRows.length} selected</span>
            <span className="h-4 w-px bg-border" aria-hidden="true" />
            {renderBulkBar({ selected: selectedRows, clear: clearSelection })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
