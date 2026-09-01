import { useNavigate } from "@tanstack/react-router";
import { Button } from "@vibe/ui/components/Button";
import { StateSurface } from "@vibe/ui/components/StateSurface";

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="flex h-full min-h-0 items-center justify-center p-base">
      <StateSurface
        state="empty"
        title={<h1>Page not found</h1>}
        description="The page you requested does not exist or is no longer available."
        action={
          <Button
            className="min-h-11"
            size="lg"
            variant="secondary"
            onClick={() => void navigate({ to: "/", replace: true })}
          >
            Back to home
          </Button>
        }
      />
    </div>
  );
}
