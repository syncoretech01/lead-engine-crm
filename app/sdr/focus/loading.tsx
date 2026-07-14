// Shaped loading skeleton for the Focus workspace (rail + dossier + dock) shown
// while the queue read model resolves (SDR Cockpit §Required states).
export default function FocusLoading() {
  return (
    <div className="cockpit flex h-[calc(100vh-3.5rem)] min-h-[560px] w-full overflow-hidden bg-co-page">
      <aside className="w-[300px] shrink-0 border-r border-co-border bg-white p-3">
        <div className="h-8 w-full animate-pulse rounded-md bg-co-sunken-2" />
        <div className="mt-2 h-8 w-full animate-pulse rounded-md bg-co-sunken-2" />
        <div className="mt-4 flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="h-14 animate-pulse rounded-md bg-co-sunken-2" />
          ))}
        </div>
      </aside>
      <main className="flex-1 bg-white p-6">
        <div className="flex items-center gap-3">
          <div className="size-11 animate-pulse rounded-lg bg-co-sunken-2" />
          <div className="flex-1">
            <div className="h-5 w-56 animate-pulse rounded bg-co-sunken-2" />
            <div className="mt-2 h-3 w-72 animate-pulse rounded bg-co-sunken-2" />
          </div>
        </div>
        <div className="mt-4 h-14 animate-pulse rounded-[10px] bg-co-sunken-2" />
        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="h-48 animate-pulse rounded-[10px] bg-co-sunken-2" />
          <div className="h-48 animate-pulse rounded-[10px] bg-co-sunken-2" />
        </div>
      </main>
      <aside className="hidden w-[388px] shrink-0 border-l border-co-border bg-co-sunken p-4 xl:block">
        <div className="h-32 animate-pulse rounded-[10px] bg-white" />
        <div className="mt-4 h-40 animate-pulse rounded-[10px] bg-white" />
      </aside>
    </div>
  );
}
