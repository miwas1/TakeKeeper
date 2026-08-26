import { useListActivity } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Clock, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function ActivityList() {
  const { data: activities, isLoading, error } = useListActivity({ limit: 50 });

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <Activity className="w-8 h-8 text-primary" /> Activity Log
        </h1>
        <p className="text-muted-foreground text-sm font-mono mt-1">AGENT & PRODUCTION EVENTS</p>
      </div>

      <Card className="bg-card overflow-hidden">
        <CardHeader className="bg-secondary/20 border-b border-border/50 pb-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Terminal className="w-4 h-4 text-muted-foreground" />
            System Output
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="divide-y divide-border">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="p-4 flex items-center gap-4">
                  <Skeleton className="h-8 w-8 rounded-sm shrink-0" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-1/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="p-8 text-center text-destructive">
              Failed to load activity log.
            </div>
          ) : activities?.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground font-mono text-sm">
              NO_EVENTS_FOUND
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {activities?.map((event) => (
                <div key={event.id} className="p-4 flex items-start sm:items-center gap-4 hover:bg-secondary/30 transition-colors group">
                  <div className="hidden sm:flex w-12 text-[10px] font-mono text-muted-foreground flex-col items-center shrink-0">
                    <Clock className="w-4 h-4 mb-1 opacity-50 group-hover:opacity-100 transition-opacity" />
                    {new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-xs text-primary font-bold">{event.agent}</span>
                      <span className="text-muted-foreground text-xs font-mono hidden sm:inline">::</span>
                      <span className="text-sm font-medium truncate">{event.action}</span>
                    </div>
                    {event.projectTitle && (
                      <div className="text-xs text-muted-foreground font-mono truncate">
                        CTX: {event.projectTitle}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Badge variant={
                      event.status === 'success' ? 'success' :
                      event.status === 'error' ? 'destructive' :
                      event.status === 'running' ? 'info' : 'outline'
                    } className="text-[10px]">
                      {event.status.toUpperCase()}
                    </Badge>
                    {event.latencyMs && (
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {event.latencyMs}ms
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}