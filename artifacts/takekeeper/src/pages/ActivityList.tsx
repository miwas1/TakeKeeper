import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useListActivity } from "@workspace/api-client-react";
import { Activity, ArrowLeft, ArrowRight, CircleAlert, Clock, History, Terminal } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ActivityFilter = "all" | "takes" | "issues" | "changes" | "circle";

const filters: Array<{ id: ActivityFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "takes", label: "Takes" },
  { id: "issues", label: "Issues" },
  { id: "changes", label: "Continuity changes" },
  { id: "circle", label: "Circle Takes" },
];

function eventCategory(event: { agent: string; action: string; metadata?: Record<string, unknown> | null }): ActivityFilter {
  const action = event.action.toLowerCase();
  const status = typeof event.metadata?.status === "string" ? event.metadata.status.toLowerCase() : "";
  if (action.includes("circle") || action.includes("circled") || status === "circle") return "circle";
  if (action.includes("state_change") || action.includes("approve_state") || event.agent === "continuity-state") return "changes";
  if (action.includes("issue") || action.includes("continuity_check") || action.includes("continuity")) return "issues";
  if (action.includes("take") || action.includes("reference")) return "takes";
  return "all";
}

function statusVariant(status: string) {
  if (status === "completed") return "success" as const;
  if (status === "failed") return "destructive" as const;
  if (status === "started") return "info" as const;
  return "outline" as const;
}

export default function ActivityList() {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [offset, setOffset] = useState(0);
  const pageSize = 40;
  const { data: activities, isLoading, error } = useListActivity({ limit: pageSize, offset });
  const visibleActivities = useMemo(() => (activities ?? []).filter((event) => filter === "all" || eventCategory(event) === filter), [activities, filter]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <header>
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight"><Activity className="h-8 w-8 text-primary" /> Production activity</h1>
        <p className="mt-1 text-sm font-mono text-muted-foreground">CHRONOLOGICAL PRODUCTION HISTORY</p>
      </header>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Activity filters">
        {filters.map((item) => <Button key={item.id} type="button" size="sm" variant={filter === item.id ? "default" : "outline"} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</Button>)}
      </div>

      <Card className="overflow-hidden bg-card">
        <CardHeader className="border-b border-border/50 bg-secondary/20 pb-4"><CardTitle className="flex items-center gap-2 text-sm font-medium"><Terminal className="h-4 w-4 text-muted-foreground" /> Persisted event timeline</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? <div className="divide-y divide-border">{[...Array(7)].map((_, index) => <div key={index} className="flex items-center gap-4 p-4"><Skeleton className="h-8 w-8 shrink-0 rounded-sm" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-1/4" /><Skeleton className="h-3 w-1/2" /></div><Skeleton className="h-4 w-16" /></div>)}</div>
            : error ? <div role="alert" className="p-8 text-center text-destructive">Production activity could not be loaded. Try again.</div>
              : visibleActivities.length === 0 ? <div className="p-10 text-center"><History className="mx-auto h-8 w-8 text-muted-foreground/50" /><p className="mt-3 text-sm text-muted-foreground">{activities?.length ? "No events match this filter." : "Production activity will appear here as you shoot."}</p></div>
                : <ol className="divide-y divide-border/50" aria-label="Production activity events">
                  {visibleActivities.map((event) => <li key={event.id} className="group flex items-start gap-3 p-4 transition-colors hover:bg-secondary/30 sm:gap-4">
                    <div className="hidden w-14 shrink-0 flex-col items-center text-[10px] font-mono text-muted-foreground sm:flex"><Clock className="mb-1 h-4 w-4 opacity-60 group-hover:opacity-100" /><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div>
                    <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center border border-border/70 bg-background text-primary sm:hidden"><Activity className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-bold text-primary">{event.agent}</span><span className="hidden text-xs text-muted-foreground sm:inline">·</span><span className="text-sm font-medium">{event.action.replaceAll("_", " ")}</span></div><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><time dateTime={event.createdAt} className="sm:hidden">{new Date(event.createdAt).toLocaleString()}</time>{event.projectTitle && <span>{event.projectTitle}</span>}{event.metadata && Object.keys(event.metadata).length > 0 && Object.entries(event.metadata).slice(0, 4).map(([key, value]) => <span key={key} className="font-mono">{key}: {typeof value === "object" ? "…" : String(value)}</span>)}</div></div>
                    <div className="flex shrink-0 flex-col items-end gap-2"><Badge variant={statusVariant(event.status)} className="text-[10px]">{event.status}</Badge>{event.latencyMs != null && <span className="text-[10px] font-mono text-muted-foreground">{event.latencyMs}ms</span>}</div>
                  </li>)}
                </ol>}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><span>Showing {offset + 1}–{offset + (activities?.length ?? 0)} persisted events{filter !== "all" ? " matching this filter" : ""}.</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}><ArrowLeft className="mr-1 h-3.5 w-3.5" /> Previous</Button><Button size="sm" variant="outline" disabled={!activities || activities.length < pageSize} onClick={() => setOffset(offset + pageSize)}>Next <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button></div></div>
      <Link href="/agent-activity" className="inline-flex items-center gap-2 text-xs font-mono text-primary hover:underline"><CircleAlert className="h-3.5 w-3.5" /> Developer Agent Activity</Link>
    </div>
  );
}
