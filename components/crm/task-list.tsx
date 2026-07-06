"use client";

import * as React from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { statusTone } from "@/components/status-pill";
import { completeTaskAction } from "@/app/actions";
import { cn } from "@/lib/utils";

export type TaskItem = {
  id: string;
  title: string;
  status: string;
  priority: string;
  ownerName: string;
  dueLabel?: string;
};

export function TaskList({ tasks }: { tasks: TaskItem[] }) {
  const [completing, setCompleting] = React.useState<Set<string>>(new Set());
  const [, startTransition] = React.useTransition();

  const complete = (id: string) => {
    // Optimistically strike the row; the server action + revalidation reconciles.
    setCompleting((prev) => new Set(prev).add(id));
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("id", id);
        await completeTaskAction(fd);
      } catch {
        toast.error("Couldn't complete the task.");
        setCompleting((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    });
  };

  if (tasks.length === 0) {
    return <p className="text-xs text-muted-foreground">No open contact tasks right now.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {tasks.map((task) => {
        const isCompleting = completing.has(task.id);
        return (
          <div
            key={task.id}
            className={cn(
              "flex flex-col gap-2 border-b pb-4 transition-opacity last:border-0 last:pb-0",
              isCompleting && "opacity-50"
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <span className={cn("font-medium text-foreground", isCompleting && "line-through")}>
                {task.title}
              </span>
              <StatusBadge label={task.status} tone={statusTone(task.status)} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge label={task.priority} />
              <StatusBadge label={task.ownerName} />
              {task.dueLabel ? <StatusBadge label={task.dueLabel} /> : null}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              disabled={isCompleting}
              onClick={() => complete(task.id)}
            >
              {isCompleting ? <Loader2 className="animate-spin" /> : <Check aria-hidden="true" />}
              Complete
            </Button>
          </div>
        );
      })}
    </div>
  );
}
