import { useState } from "react";
import { Link } from "wouter";
import {
  getGetDailyReportQueryKey,
  useGenerateDailyReport,
  useGetDailyReport,
  useListProjects,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  FileText,
  History,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function statusBadge(status: string) {
  if (status === "ready") return <Badge variant="success"><CheckCircle2 className="mr-1 h-3 w-3" /> Ready</Badge>;
  if (status === "failed") return <Badge variant="destructive"><AlertTriangle className="mr-1 h-3 w-3" /> Failed</Badge>;
  if (status === "generating") return <Badge variant="info"><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Generating</Badge>;
  return <Badge variant="outline">Not generated</Badge>;
}

export default function Reports() {
  const { data: projects } = useListProjects();
  const { toast } = useToast();
  const [projectId, setProjectId] = useState("");
  const [shootDate, setShootDate] = useState(today);
  const selectedId = projectId || projects?.[0]?.id || "";
  const reportParams = { projectId: selectedId, shootDate };
  const reportQuery = useGetDailyReport(reportParams, {
    query: {
      enabled: Boolean(selectedId && shootDate),
      queryKey: getGetDailyReportQueryKey(reportParams),
    },
  });
  const generate = useGenerateDailyReport({
    mutation: {
      onSuccess: (result) => {
        void reportQuery.refetch();
        toast({
          title: result.status === "ready" ? "Daily report saved" : "Report generation needs attention",
          description: result.message,
          variant: result.status === "ready" ? undefined : "destructive",
        });
      },
      onError: () => toast({
        title: "Couldn't generate the report",
        description: "Your production records are safe. Try again.",
        variant: "destructive",
      }),
    },
  });
  const report = reportQuery.data;

  function generateReport() {
    if (!selectedId || !shootDate) return;
    generate.mutate({ data: { projectId: selectedId, shootDate } });
  }

  const metrics = report ? [
    ["Scenes worked", report.scenesWorked],
    ["Shots", report.shots],
    ["Takes", report.takeCount],
    ["Circle takes", report.circleTakes],
    ["Issues detected", report.issuesDetected],
    ["Fixed", report.issuesFixed],
    ["Intentional", report.issuesIntentional],
    ["Unresolved", report.unresolvedWarnings],
  ] as const : [];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <header className="space-y-2">
        <div className="text-xs font-mono text-primary">PRODUCTION RECORD</div>
        <h1 className="text-3xl font-bold tracking-tight">Daily reports</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">A persisted shoot-day record with database-owned counts and a concise Report Agent summary.</p>
      </header>

      <Card>
        <CardHeader className="border-b border-border/50">
          <CardTitle className="flex items-center gap-2 text-base"><CalendarDays className="h-4 w-4 text-primary" /> Choose a shoot day</CardTitle>
          <CardDescription>Select a project and date to inspect the current factual snapshot or regenerate its narrative.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 space-y-2 text-xs font-mono text-muted-foreground">
            PROJECT
            <Select value={selectedId} onValueChange={setProjectId}>
              <SelectTrigger className="h-10 w-full font-sans text-sm"><SelectValue placeholder="Choose project" /></SelectTrigger>
              <SelectContent>{projects?.map((project) => <SelectItem key={project.id} value={project.id}>{project.title}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <label className="space-y-2 text-xs font-mono text-muted-foreground">
            SHOOT DAY
            <input
              type="date"
              value={shootDate}
              onChange={(event) => setShootDate(event.target.value)}
              className="block h-10 w-full border border-input bg-background px-3 font-sans text-sm text-foreground outline-none focus:ring-2 focus:ring-ring sm:w-44"
              aria-label="Shoot day"
            />
          </label>
          <Button onClick={generateReport} disabled={!selectedId || !shootDate || generate.isPending} className="h-10">
            {generate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : report?.status === "ready" ? <RefreshCw className="mr-2 h-4 w-4" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {generate.isPending ? "Generating…" : report?.status === "ready" ? "Regenerate" : "Generate report"}
          </Button>
        </CardContent>
      </Card>

      {!selectedId ? (
        <Card className="border-dashed"><CardContent className="py-14 text-center text-sm text-muted-foreground">Create a project before generating a report.</CardContent></Card>
      ) : reportQuery.isLoading ? (
        <div className="space-y-4"><Skeleton className="h-20 w-full" /><Skeleton className="h-44 w-full" /><Skeleton className="h-64 w-full" /></div>
      ) : reportQuery.error || !report ? (
        <Card className="border-destructive/30"><CardContent className="py-12 text-center text-sm text-destructive">The report records could not be loaded. Try again.</CardContent></Card>
      ) : (
        <article className="space-y-5" aria-label={`Daily continuity report for ${report.project}`}>
          <div className="flex flex-col gap-3 border border-border/70 bg-card p-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">{statusBadge(report.status)} <span className="text-xs font-mono text-muted-foreground">{formatDate(report.shootDate)}</span></div>
              <h2 className="mt-2 text-xl font-semibold">Daily continuity report</h2>
              <p className="mt-1 text-sm text-muted-foreground">{report.project} · {report.message}</p>
            </div>
            <div className="text-left text-xs text-muted-foreground sm:text-right">
              {report.generatedAt && <time dateTime={report.generatedAt}>Generated {new Date(report.generatedAt).toLocaleString()}</time>}
              {report.model && <div className="mt-1 font-mono">{report.model}</div>}
            </div>
          </div>

          {report.status === "failed" && <div role="alert" className="flex items-start gap-3 border border-destructive/30 bg-destructive/5 p-4 text-sm"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" /><div><div className="font-medium">Couldn't generate the report</div><p className="mt-1 text-muted-foreground">Your production records are safe. Try again.</p></div></div>}

          <section aria-labelledby="report-facts-heading" className="space-y-3">
            <div><h2 id="report-facts-heading" className="text-lg font-semibold">Factual snapshot</h2><p className="text-sm text-muted-foreground">Counts are calculated from persisted production records for this shoot day.</p></div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {metrics.map(([label, value]) => <div key={label} className="border border-border/70 bg-card p-3"><div className="text-[10px] font-mono uppercase text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-bold font-mono">{value}</div></div>)}
            </div>
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Summary</CardTitle><CardDescription>Written from the validated records above.</CardDescription></CardHeader>
              <CardContent>{report.narrative ? <p className="whitespace-pre-wrap text-sm leading-6">{report.narrative}</p> : <div className="flex items-start gap-3 border border-dashed border-border p-4 text-sm text-muted-foreground"><FileText className="mt-0.5 h-5 w-5 text-primary" /><span>No shoot-day report yet. Generate one when the Report Agent is configured.</span></div>}</CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4 text-primary" /> Scenes worked</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {report.sceneSummaries.length ? report.sceneSummaries.map((scene) => <div key={scene.sceneId} className="flex items-center justify-between gap-3 border-b border-border/50 py-2 last:border-0"><div className="min-w-0"><div className="font-medium">Scene {scene.sceneNumber}</div><div className="truncate text-xs text-muted-foreground">{scene.slugline}</div></div><div className="shrink-0 text-right text-xs font-mono text-muted-foreground">{scene.shotCount} shot{scene.shotCount === 1 ? "" : "s"} · {scene.takeCount} take{scene.takeCount === 1 ? "" : "s"}</div></div>) : <p className="text-sm text-muted-foreground">No takes were recorded for this shoot day.</p>}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CircleDot className="h-4 w-4 text-primary" /> Circle takes</CardTitle><CardDescription>Captured Circle Takes are listed from production records.</CardDescription></CardHeader>
              <CardContent className="space-y-2">
                {report.circleTakeDetails.length ? report.circleTakeDetails.map((take) => <div key={take.takeId} className="flex items-start justify-between gap-3 border-b border-border/50 py-2 last:border-0"><div><div className="font-medium">Scene {take.sceneNumber} / {take.shotLabel}</div><div className="text-xs text-muted-foreground">Take {String(take.takeNumber).padStart(2, "0")}{take.notes ? ` · ${take.notes}` : ""}</div></div><Badge variant={take.continuityStatus === "all_clear" ? "success" : take.continuityStatus === "issues" ? "warning" : "outline"}>{take.continuityStatus === "all_clear" ? "All clear" : take.continuityStatus === "issues" ? "Issues" : "Not checked"}</Badge></div>) : <p className="text-sm text-muted-foreground">No Circle Takes were recorded for this shoot day.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-primary" /> Continuity issues</CardTitle><CardDescription>Decisions stay distinct from unresolved warnings.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2 text-xs"><Badge variant="success">Fixed {report.issuesFixed}</Badge><Badge variant="info">Intentional {report.issuesIntentional}</Badge><Badge variant="secondary">Ignored {report.issuesIgnored}</Badge><Badge variant={report.unresolvedWarnings ? "warning" : "outline"}>Unresolved {report.unresolvedWarnings}</Badge></div>
                {report.unresolvedIssues.length ? <div className="space-y-2">{report.unresolvedIssues.slice(0, 5).map((issue) => <div key={issue.id} className="border-l-2 border-warning pl-3"><div className="font-medium">{issue.entity}</div><div className="text-xs text-muted-foreground">Expected {issue.expectedState}; observed {issue.observedState}</div></div>)}</div> : <div className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> No unresolved continuity warnings.</div>}
              </CardContent>
            </Card>
          </div>

          {(report.intentionalChanges.length > 0 || report.notes.length > 0) && <div className="grid gap-5 lg:grid-cols-2">
            <Card><CardHeader><CardTitle className="text-base">Intentional changes</CardTitle><CardDescription>Approved state changes, separate from mistakes.</CardDescription></CardHeader><CardContent>{report.intentionalChanges.length ? <ul className="space-y-2 text-sm">{report.intentionalChanges.map((change, index) => <li key={`${change}-${index}`} className="border-l-2 border-primary pl-3">{change}</li>)}</ul> : <p className="text-sm text-muted-foreground">No intentional changes recorded.</p>}</CardContent></Card>
            <Card><CardHeader><CardTitle className="text-base">Crew notes</CardTitle></CardHeader><CardContent>{report.notes.length ? <ul className="space-y-2 text-sm text-muted-foreground">{report.notes.slice(0, 12).map((note, index) => <li key={`${note}-${index}`}>{note}</li>)}</ul> : <p className="text-sm text-muted-foreground">No notes recorded for this shoot day.</p>}</CardContent></Card>
          </div>}

          <details className="border border-dashed border-border/70 bg-card/40">
            <summary className="cursor-pointer list-none p-4 text-sm font-medium">Developer trace · Report Agent tools</summary>
            <div className="border-t border-border/60 p-4"><div className="flex flex-wrap gap-2">{report.agentTools.map((tool) => <Badge key={tool} variant="outline" className="font-mono text-[10px]">{tool}</Badge>)}</div><p className="mt-3 text-xs text-muted-foreground">Tool names and timing are auditable in <Link href="/agent-activity" className="text-primary hover:underline">Agent Activity</Link>. Production content and secrets are not shown in the trace.</p></div>
          </details>
        </article>
      )}
    </div>
  );
}
