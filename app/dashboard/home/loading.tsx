// Route-level loading UI (shown while 7d/30d switches trigger a new server render)

export default function Loading() {
  return (
    <div className="p-4 md:p-6 space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-6 w-56 rounded bg-white/10" />
        <div className="h-8 w-24 rounded-full bg-white/10" />
      </div>

      {/* hero skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="h-4 w-24 rounded bg-white/10 mb-2" />
            <div className="h-6 w-28 rounded bg-white/10" />
          </div>
        ))}
      </div>

      {/* 3 cards skeleton */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
            <div className="h-4 w-40 rounded bg-white/10" />
            {Array.from({ length: 6 }).map((__, j) => (
              <div key={j} className="h-10 rounded-xl bg-white/5 border border-white/10" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
