"use client";

import * as React from "react";
import type { Table } from "@tanstack/react-table";
import { Search, SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

type DataTableToolbarProps<TData> = {
  table: Table<TData>;
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  /** Column-id → readable label for the visibility menu. */
  columnLabels?: Record<string, string>;
  /** Filter chips or extra controls, rendered between search and column toggle. */
  children?: React.ReactNode;
};

export function DataTableToolbar<TData>({
  table,
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  columnLabels,
  children
}: DataTableToolbarProps<TData>) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  // `/` focuses search unless the user is already typing in a field.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/") return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const hideableColumns = table.getAllColumns().filter((column) => column.getCanHide());

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
      <div className="relative w-full max-w-xs">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={inputRef}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          className="h-8 pl-8 pr-8"
          aria-label="Search table"
        />
        {search ? (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {children}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="ml-auto">
            <SlidersHorizontal aria-hidden="true" />
            Columns
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {hideableColumns.map((column) => (
            <DropdownMenuCheckboxItem
              key={column.id}
              className="capitalize"
              checked={column.getIsVisible()}
              onCheckedChange={(value) => column.toggleVisibility(Boolean(value))}
            >
              {columnLabels?.[column.id] ?? column.id}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
