import type { StateSurfaceProps } from "@vibe/ui/components/StateSurface";
import { StateSurface } from "@vibe/ui/components/StateSurface";

type StandaloneStatePageProps = Omit<StateSurfaceProps, "className">;

export function StandaloneStatePage(props: StandaloneStatePageProps) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center overflow-auto bg-primary px-base py-double">
      <div className="w-full max-w-md rounded-sm border border-border bg-secondary">
        <StateSurface className="w-full" {...props} />
      </div>
    </main>
  );
}
