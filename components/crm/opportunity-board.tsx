"use client";

import * as React from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { MeterBar } from "@/components/ui/meter-bar";
import { StatusBadge } from "@/components/ui/status-badge";
import { statusTone } from "@/components/status-pill";
import { updateOpportunityStageAction } from "@/app/actions";
import { stageProbability } from "@/lib/phase1/crm";
import type { OpportunityStage } from "@/lib/phase1/types";
import { cn, formatCurrency } from "@/lib/utils";

export type BoardOpportunity = {
  id: string;
  name: string;
  companyId: string;
  companyName: string;
  stage: OpportunityStage;
  amount: number;
  probability: number;
  openTasks: number;
};

type MoveAction = { id: string; stage: OpportunityStage };

export function OpportunityBoard({
  opportunities,
  stages
}: {
  opportunities: BoardOpportunity[];
  stages: OpportunityStage[];
}) {
  const [optimistic, applyMove] = React.useOptimistic(
    opportunities,
    (rows: BoardOpportunity[], move: MoveAction) =>
      rows.map((row) =>
        row.id === move.id ? { ...row, stage: move.stage, probability: stageProbability(move.stage) } : row
      )
  );
  const [, startTransition] = React.useTransition();
  const [activeId, setActiveId] = React.useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const active = activeId ? optimistic.find((row) => row.id === activeId) ?? null : null;

  const move = (id: string, stage: OpportunityStage) => {
    startTransition(async () => {
      applyMove({ id, stage });
      const fd = new FormData();
      fd.set("id", id);
      fd.set("stage", stage);
      try {
        await updateOpportunityStageAction(fd);
      } catch {
        toast.error("Couldn't move the opportunity.");
      }
    });
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const overStage = event.over?.id as OpportunityStage | undefined;
    const dragged = optimistic.find((row) => row.id === event.active.id);
    if (!overStage || !dragged || dragged.stage === overStage) return;
    move(dragged.id, overStage);
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(event: DragStartEvent) => setActiveId(event.active.id as string)}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={onDragEnd}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Opportunity pipeline">
        {stages.map((stage) => {
          const items = optimistic.filter((row) => row.stage === stage);
          const total = items.reduce((sum, row) => sum + row.amount, 0);
          return (
            <Column key={stage} stage={stage} count={items.length} total={total}>
              {items.map((row) => (
                <DraggableCard key={row.id} opportunity={row} stages={stages} onMove={move} />
              ))}
            </Column>
          );
        })}
      </div>
      <DragOverlay>{active ? <CardBody opportunity={active} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({
  stage,
  count,
  total,
  children
}: {
  stage: OpportunityStage;
  count: number;
  total: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-dashed border-transparent p-1 transition-colors",
        isOver && "border-primary/50 bg-primary/5"
      )}
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <strong className="text-sm font-semibold text-foreground">{stage}</strong>
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">{formatCurrency(total)}</span>
          <StatusBadge label={`${count}`} tone={count ? statusTone(stage) : "default"} />
        </div>
      </div>
      {children}
      {count === 0 ? (
        <p className="px-1 py-6 text-center text-xs text-muted-foreground">Drop deals here</p>
      ) : null}
    </div>
  );
}

function DraggableCard({
  opportunity,
  stages,
  onMove
}: {
  opportunity: BoardOpportunity;
  stages: OpportunityStage[];
  onMove: (id: string, stage: OpportunityStage) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: opportunity.id });
  return (
    <div ref={setNodeRef} className={cn(isDragging && "opacity-40")}>
      <CardBody opportunity={opportunity} handleProps={{ ...attributes, ...listeners }} stages={stages} onMove={onMove} />
    </div>
  );
}

function CardBody({
  opportunity,
  handleProps,
  stages,
  onMove,
  dragging
}: {
  opportunity: BoardOpportunity;
  handleProps?: Record<string, unknown>;
  stages?: OpportunityStage[];
  onMove?: (id: string, stage: OpportunityStage) => void;
  dragging?: boolean;
}) {
  return (
    <Card className={cn("gap-3 p-4", dragging && "shadow-lg")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">{opportunity.name}</h3>
          <p className="truncate text-xs text-muted-foreground">{opportunity.companyName}</p>
        </div>
        {handleProps ? (
          <button
            type="button"
            className="-mr-1 cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing"
            aria-label="Drag to move stage"
            {...handleProps}
          >
            <GripVertical className="size-4" />
          </button>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-2">
        <StatusBadge label={formatCurrency(opportunity.amount)} tone="info" />
        <div className="flex w-20 flex-col items-end gap-1">
          <span className="text-xs font-semibold text-foreground">{opportunity.probability}%</span>
          <MeterBar value={opportunity.probability} showValue={false} />
        </div>
      </div>
      {/* Accessible / mobile fallback: pick the stage without dragging. */}
      {stages && onMove ? (
        <select
          aria-label="Move to stage"
          value={opportunity.stage}
          onChange={(event) => onMove(opportunity.id, event.target.value as OpportunityStage)}
          className="h-8 rounded-md border bg-background px-2 text-xs"
        >
          {stages.map((stage) => (
            <option key={stage} value={stage}>
              {stage}
            </option>
          ))}
        </select>
      ) : null}
      <Link
        href={`/crm/accounts/${opportunity.companyId}`}
        className="text-xs text-primary hover:underline"
      >
        Open account →
      </Link>
    </Card>
  );
}
