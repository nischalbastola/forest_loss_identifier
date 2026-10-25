export function LabFallback() {
  return (
    <div className="flex min-h-80 flex-col gap-3 rounded-xl bg-card p-5 ring-1 ring-foreground/10" aria-hidden>
      <div className="h-8 w-40 rounded-md bg-muted" />
      <div className="h-4 w-72 max-w-full rounded-md bg-muted" />
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="h-64 rounded-xl bg-muted" />
        <div className="h-64 rounded-xl bg-muted" />
      </div>
    </div>
  );
}
