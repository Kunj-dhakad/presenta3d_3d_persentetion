import { Skeleton } from "@/components/ui/skeleton";

export function WorkspaceSkeleton() {
  return (
    <div className="flex h-full flex-col" aria-busy="true" aria-label="Loading workspace">
      <div className="flex h-11 items-center gap-2 border-b border-border px-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="ml-auto h-7 w-24" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-[28%] space-y-3 border-r border-border p-4">
          <Skeleton className="h-16 w-4/5" />
          <Skeleton className="ml-auto h-10 w-3/5" />
          <Skeleton className="h-24 w-full" />
        </div>
        <div className="flex-1 p-4">
          <Skeleton className="h-full w-full" />
        </div>
      </div>
    </div>
  );
}
