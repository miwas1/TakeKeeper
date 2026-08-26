import React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "./ui/button";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  resetKey?: any;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.props.resetKey !== prevProps.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 my-8 border border-destructive/30 bg-destructive/5 rounded-sm max-w-2xl mx-auto w-full animate-in fade-in">
          <div className="flex items-center gap-3 text-destructive mb-4">
            <AlertTriangle className="h-6 w-6 shrink-0" />
            <h2 className="text-lg font-bold uppercase tracking-wider">UI Module Failure</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            A critical error occurred while rendering this interface component.
          </p>
          {this.state.error && (
            <div className="bg-background/50 p-4 rounded-sm border border-border/50 overflow-auto mb-6">
              <pre className="text-[10px] font-mono text-destructive">
                {this.state.error.message}
                {'\n'}
                {this.state.error.stack?.split('\n').slice(0, 3).join('\n')}
              </pre>
            </div>
          )}
          <Button 
            variant="outline" 
            onClick={() => this.setState({ hasError: false, error: null })}
            className="font-mono text-xs uppercase"
          >
            Attempt Recovery
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}