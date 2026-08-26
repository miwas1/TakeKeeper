export function ErrorFallback({ error, resetErrorBoundary }: { error: Error, resetErrorBoundary: () => void }) {
  return (
    <div className="p-8 flex flex-col gap-4 max-w-md bg-destructive/10 border border-destructive/20 rounded-sm">
      <h2 className="text-lg font-bold text-destructive">Something went wrong</h2>
      <pre className="text-xs font-mono bg-background p-4 rounded-sm border border-border overflow-auto max-h-48 text-muted-foreground">
        {error.message}
      </pre>
      <button 
        onClick={resetErrorBoundary}
        className="px-4 py-2 bg-destructive text-destructive-foreground font-medium rounded-sm hover:bg-destructive/90 text-sm font-mono uppercase"
      >
        Try again
      </button>
    </div>
  );
}