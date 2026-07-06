import { Skeleton } from "@/components/ui/skeleton";

function HeaderSkeleton() {
  return (
    <div className="mb-6 space-y-2">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-4 w-full max-w-xl" />
    </div>
  );
}

function StatRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-lg border bg-card p-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-8 w-16" />
          <Skeleton className="mt-3 h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-3 py-2.5">
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="flex items-center gap-4 px-3 py-2.5">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-1/5" />
            <Skeleton className="ml-auto h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** List-page loading shape: header + stat row + a table. */
export function ListPageSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-6">
      <HeaderSkeleton />
      <StatRowSkeleton />
      <TableSkeleton rows={rows} />
    </div>
  );
}

/** Record-detail loading shape: header + left rail + tab strip + timeline bars. */
export function DetailPageSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-6">
      <HeaderSkeleton />
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-4 rounded-lg border bg-card p-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <Skeleton className="h-5 w-40" />
          <div className="space-y-2 pt-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="flex items-center justify-between gap-4">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-28" />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <div className="flex gap-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-24" />
            ))}
          </div>
          <div className="space-y-3 rounded-lg border bg-card p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="flex gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
