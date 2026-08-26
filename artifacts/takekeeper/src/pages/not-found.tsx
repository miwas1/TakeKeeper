import { useLocation } from "wouter";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  const [location] = useLocation();

  return (
    <div className="flex w-full mt-20 items-center justify-center p-4">
      <div className="flex flex-col items-center justify-center text-center space-y-4 max-w-md animate-in fade-in slide-in-from-bottom-4 duration-500">
        <AlertCircle className="h-16 w-16 text-destructive opacity-80" />
        <h1 className="text-3xl font-bold tracking-tight text-foreground">404 NOT FOUND</h1>
        <p className="text-sm text-muted-foreground font-mono mt-2 bg-secondary/50 p-2 rounded-sm border border-border w-full truncate">
          {location}
        </p>
        <p className="text-muted-foreground">
          The module or directory you requested does not exist in the active workspace.
        </p>
      </div>
    </div>
  );
}