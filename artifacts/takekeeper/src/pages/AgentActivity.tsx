import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useHealthCheck, useListActivity } from "@workspace/api-client-react";
import { Activity, ArrowLeft, CheckCircle2, CircleAlert, Database, Gauge, HardDrive, Server, ShieldCheck, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function statusVariant(status: string) {
  if (status === "completed") return "success" as const;
  if (status === "failed") return "destructive" as const;
  return "info" as const;
}

export default function AgentActivity() {
  const { data: health, isLoading: healthLoading } = useHealthCheck();
  const [agent, setAgent] = useState("");
  const [status, setStatus] = useState<"all" | "started" | "completed" | "failed">("all");
  const { data: activities, isLoading, error } = useListActivity({
    limit: 100,
    offset: 0,
    agent: agent || undefined,
    status: status === "all" ? undefined : status,
  });
  const agentNames = useMemo(() => [...new Set((activities ?? []).map((event) => event.agent))].sort(), [activities]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <header><Link href="/settings" className="mb-3 inline-flex items-center gap-2 text-xs font-mono text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> DEVELOPER SETTINGS</Link><h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight"><Activity className="h-8 w-8 text-primary" /> Agent Activity</h1><p className="mt-1 text-sm font-mono text-muted-foreground">DEVELOPER-ONLY WORKFLOW TRACE</p></header>
        <Badge variant="outline" className="font-mono text-[10px]">No hidden reasoning</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatusCard icon={Server} label="Google Agent" value={healthLoading ? "Checking…" : health?.agent.status ?? "Unavailable"} detail={health?.agent.model ?? "—"} tone={health?.agent.status === "ready" ? "good" : "warn"} />
        <StatusCard icon={Database} label="Database" value={healthLoading ? "Checking…" : health?.database ?? "Unavailable"} detail={health?.environment ?? "—"} tone={health?.database === "connected" ? "good" : "bad"} />
        <StatusCard icon={HardDrive} label="Storage" value={healthLoading ? "Checking…" : health?.storage.status ?? "Unavailable"} detail={health?.storage.provider ?? "—"} tone={health?.storage.status === "ready" ? "good" : "warn"} />
        <StatusCard icon={Gauge} label="Latest latency" value={health?.latestAgentLatencyMs != null ? `${health.latestAgentLatencyMs}ms` : "—"} detail="most recent event" tone="neutral" />
      </div>

      <Card>
        <CardHeader className="border-b border-border/50"><div className="flex flex-wrap items-end justify-between gap-3"><div><CardTitle className="text-base">Workflow events</CardTitle><CardDescription>Persisted agent, tool, latency, and safe outcome metadata.</CardDescription></div><div className="flex flex-wrap gap-2"><label className="sr-only" htmlFor="agent-filter">Filter by agent</label><select id="agent-filter" value={agent} onChange={(event) => setAgent(event.target.value)} className="h-9 border border-input bg-background px-2 text-xs"><option value="">All agents</option>{agentNames.map((name) => <option key={name} value={name}>{name}</option>)}</select><label className="sr-only" htmlFor="status-filter">Filter by status</label><select id="status-filter" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="h-9 border border-input bg-background px-2 text-xs"><option value="all">All outcomes</option><option value="started">Started</option><option value="completed">Completed</option><option value="failed">Failed</option></select></div></div></CardHeader>
        <CardContent className="p-0">
          {isLoading ? <div className="space-y-3 p-4">{[...Array(6)].map((_, index) => <div key={index} className="flex gap-3"><Skeleton className="h-8 w-8" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-3 w-2/3" /></div></div>)}</div>
            : error ? <div role="alert" className="p-10 text-center text-sm text-destructive">Agent Activity could not be loaded. Try again.</div>
              : !activities?.length ? <div className="p-10 text-center"><CircleAlert className="mx-auto h-8 w-8 text-muted-foreground/50" /><p className="mt-3 text-sm text-muted-foreground">Agent actions will appear after an AI workflow runs.</p></div>
                : <ol className="divide-y divide-border/50" aria-label="Agent workflow events">{activities.map((event) => <li key={event.id} className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto]"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-bold text-primary">{event.agent}</span><span className="text-muted-foreground">·</span><span className="text-sm font-medium">{event.action.replaceAll("_", " ")}</span></div><div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>{event.toolName && <span className="font-mono">tool: {event.toolName}</span>}{event.projectTitle && <span>project: {event.projectTitle}</span>}</div>{event.metadata && Object.keys(event.metadata).length > 0 && <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono text-muted-foreground">{Object.entries(event.metadata).slice(0, 5).map(([key, value]) => <span key={key}>{key}: {typeof value === "object" ? "…" : String(value)}</span>)}</div>}</div><div className="flex items-start justify-between gap-3 md:flex-col md:items-end"><Badge variant={statusVariant(event.status)}>{event.status}</Badge>{event.latencyMs != null && <span className="text-xs font-mono text-muted-foreground">{event.latencyMs}ms</span>}</div></li>)}</ol>}
        </CardContent>
      </Card>

      <div className="border border-dashed border-border/70 p-4 text-xs text-muted-foreground"><ShieldCheck className="mr-2 inline h-4 w-4 text-primary" />The trace exposes event metadata, tool names, status, and latency only. It never renders model chain-of-thought, credentials, or raw media.</div>
    </div>
  );
}

function StatusCard({ icon: Icon, label, value, detail, tone }: { icon: typeof Server; label: string; value: string; detail: string; tone: "good" | "warn" | "bad" | "neutral" }) {
  const toneClass = tone === "good" ? "text-success" : tone === "bad" ? "text-destructive" : tone === "warn" ? "text-warning" : "text-muted-foreground";
  const StatusIcon = tone === "good" ? CheckCircle2 : tone === "bad" ? XCircle : Icon;
  return <Card><CardContent className="p-4"><div className={`flex items-center gap-2 text-xs font-mono uppercase ${toneClass}`}><StatusIcon className="h-4 w-4" /> {label}</div><div className="mt-2 truncate text-lg font-semibold">{value}</div><div className="mt-1 truncate text-xs text-muted-foreground">{detail}</div></CardContent></Card>;
}
