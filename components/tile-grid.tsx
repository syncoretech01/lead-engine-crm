"use client";

import { Children, isValidElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HTMLAttributes, ReactElement, ReactNode } from "react";
import type { GridStack, GridStackWidget } from "gridstack";
import { Check, GripVertical, LayoutGrid, RotateCcw } from "lucide-react";
import { resetTileLayoutAction, saveTileLayoutAction } from "@/app/actions";
import type { TileLayoutItem } from "@/lib/phase1/types";
import "gridstack/dist/gridstack.min.css";

export type TileItemProps = {
  /** Stable id — must be unique on the page and consistent across renders. */
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  children: ReactNode;
};

// Marker component: TileGrid reads its props/children and renders the grid
// structure itself, so TileItem never renders DOM on its own.
export function TileItem(_props: TileItemProps): null {
  return null;
}

type TileGridProps = {
  pageKey: string;
  canCustomize: boolean;
  saved: TileLayoutItem[] | null;
  children: ReactNode;
};

type ResolvedTile = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  node: ReactNode;
};

const SAVE_DEBOUNCE_MS = 600;

// GridStack reads geometry from `gs-*` attributes on init. React's DOM typings
// don't include these custom attributes, so build them as a plain object and
// spread (React passes through hyphenated custom attributes to the DOM).
function gridItemAttrs(tile: ResolvedTile): HTMLAttributes<HTMLDivElement> {
  const attrs: Record<string, string | number> = {
    "gs-id": tile.id,
    "gs-x": tile.x,
    "gs-y": tile.y,
    "gs-w": tile.w,
    "gs-h": tile.h
  };
  if (tile.minW != null) {
    attrs["gs-min-w"] = tile.minW;
  }
  if (tile.minH != null) {
    attrs["gs-min-h"] = tile.minH;
  }
  return attrs as unknown as HTMLAttributes<HTMLDivElement>;
}

export function TileGrid({ pageKey, canCustomize, saved, children }: TileGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<GridStack | null>(null);
  const editingRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editing, setEditing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [ready, setReady] = useState(false);

  // Resolve each TileItem child's geometry: a saved layout (per tile id)
  // overrides the page-provided default. Tiles missing from `saved` keep their
  // default; saved entries with no matching tile are ignored — so the layout
  // survives tiles being added or removed.
  const tiles = useMemo<ResolvedTile[]>(() => {
    const savedMap = new Map((saved ?? []).map((item) => [item.id, item] as const));
    // Filter by the presence of a string `id` prop rather than `child.type ===
    // TileItem`. These pages are Server Components, so the TileItem elements they
    // create carry a client-reference proxy as `type` that is not identity-equal
    // to the TileItem function imported here — props, however, are preserved.
    return Children.toArray(children)
      .filter((child): child is ReactElement<TileItemProps> => {
        return isValidElement(child) && typeof (child.props as Partial<TileItemProps>)?.id === "string";
      })
      .map((child) => {
        const props = child.props;
        const pos = savedMap.get(props.id);
        return {
          id: props.id,
          x: pos?.x ?? props.x,
          y: pos?.y ?? props.y,
          w: pos?.w ?? props.w,
          h: pos?.h ?? props.h,
          minW: props.minW,
          minH: props.minH,
          node: props.children
        };
      });
  }, [children, saved]);

  const collectItems = useCallback((): TileLayoutItem[] => {
    const grid = instanceRef.current;
    if (!grid) {
      return [];
    }
    const widgets = grid.save(false) as GridStackWidget[];
    return widgets
      .filter((widget) => widget.id != null)
      .map((widget) => ({
        id: String(widget.id),
        x: widget.x ?? 0,
        y: widget.y ?? 0,
        w: widget.w ?? 1,
        h: widget.h ?? 1
      }));
  }, []);

  const persist = useCallback(() => {
    const items = collectItems();
    if (items.length) {
      void saveTileLayoutAction(pageKey, items);
    }
  }, [collectItems, pageKey]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
    }
    saveTimer.current = setTimeout(persist, SAVE_DEBOUNCE_MS);
  }, [persist]);

  useEffect(() => {
    let disposed = false;

    void (async () => {
      try {
        const mod = await import("gridstack");
        if (disposed || !gridRef.current) {
          return;
        }
        const grid = mod.GridStack.init(
          {
            column: 12,
            cellHeight: 84,
            margin: 8,
            float: false,
            disableDrag: true,
            disableResize: true,
            handle: ".tile-drag-handle",
            resizable: { handles: "e, se, s" },
            columnOpts: { breakpointForWindow: true, breakpoints: [{ w: 768, c: 1 }] }
          },
          gridRef.current
        );
        instanceRef.current = grid;
        grid.on("change", () => {
          if (editingRef.current) {
            scheduleSave();
          }
        });
      } finally {
        // Reveal the grid once positioned (or even if GridStack failed to load,
        // so tiles are never left hidden).
        if (!disposed) {
          setReady(true);
        }
      }
    })();

    return () => {
      disposed = true;
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      instanceRef.current?.destroy(false);
      instanceRef.current = null;
    };
  }, [scheduleSave]);

  const enterEdit = useCallback(() => {
    const grid = instanceRef.current;
    if (!grid) {
      return;
    }
    editingRef.current = true;
    setEditing(true);
    grid.enableMove(true);
    grid.enableResize(true);
  }, []);

  const exitEdit = useCallback(() => {
    const grid = instanceRef.current;
    editingRef.current = false;
    setEditing(false);
    grid?.enableMove(false);
    grid?.enableResize(false);
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    persist();
  }, [persist]);

  const reset = useCallback(async () => {
    setResetting(true);
    try {
      await resetTileLayoutAction(pageKey);
      // Reload so the page re-renders from default geometry and re-inits the grid.
      window.location.reload();
    } catch {
      setResetting(false);
    }
  }, [pageKey]);

  return (
    <div className={`tile-grid-wrap${editing ? " editing" : ""}${ready ? " ready" : ""}`}>
      {canCustomize ? (
        <div className="tile-grid-toolbar">
          {editing ? (
            <>
              <button type="button" className="button secondary" onClick={reset} disabled={resetting}>
                <RotateCcw size={15} aria-hidden="true" />
                Reset
              </button>
              <button type="button" className="button primary" onClick={exitEdit}>
                <Check size={15} aria-hidden="true" />
                Done
              </button>
            </>
          ) : (
            <button type="button" className="button secondary" onClick={enterEdit}>
              <LayoutGrid size={15} aria-hidden="true" />
              Customize layout
            </button>
          )}
        </div>
      ) : null}

      <div className={`grid-stack${editing ? " editing" : ""}`} ref={gridRef}>
        {tiles.map((tile) => (
          <div key={tile.id} className="grid-stack-item" {...gridItemAttrs(tile)}>
            <div className="grid-stack-item-content">
              {canCustomize ? (
                <span className="tile-drag-handle" aria-hidden="true">
                  <GripVertical size={16} />
                </span>
              ) : null}
              {tile.node}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
