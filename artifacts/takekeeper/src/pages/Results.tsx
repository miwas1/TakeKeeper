import { useEffect } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetContinuityCheckQueryKey,
  getGetShotQueryKey,
  useGetContinuityCheck,
  useGetShot,
  useRunContinuityCheck,
} from "@workspace/api-client-react";
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleAlert, Loader2, ScanSearch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.85) return "High confidence";
  if (confidence >= 0.6) return "Likely mismatch";
  return "Worth checking";
}

function severityVariant(severity: string) {
  if (severity === "high") return "destructive" as const;
  if (severity === "medium") return "warning" as const;
  return "outline" as const;
}

function statusLabel(status: string | undefined): string {
  if (status === "analyzing" || status === "pending") return "ANALYZING";
  if (status === "completed") return "CHECK COMPLETE";
  if (status === "failed") return "CHECK FAILED";
  return "READY TO CHECK";
}

export default function Results() {
  const { shotId = "" } = useParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: shotData, isLoading: shotLoading } = useGetShot(shotId);
  const reference = shotData?.takes.find((take) => take.isReference);
  const current = shotData?.takes
    .filter((take) => !take.isReference)
    .sort((left, right) => right.takeNumber - left.takeNumber)[0];
  const checkQuery = useGetContinuityCheck(current?.id ?? "", {
    query: { enabled: Boolean(current), queryKey: getGetContinuityCheckQueryKey(current?.id ?? "") },
  });
  const check = checkQuery.data;
  const runCheck = useRunContinuityCheck();

  useEffect(() => {
    if (!current || check?.status !== "analyzing") return;
    const timer = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: getGetContinuityCheckQueryKey(current.id) });
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [check?.status, current, queryClient]);

  function runContinuityCheck(retry = false) {
    if (!current) return;
    runCheck.mutate({ takeId: current.id, data: retry ? { retry: true } : undefined }, {
      onSuccess: (result) => {
        queryClient.setQueryData(getGetContinuityCheckQueryKey(current.id), result);
        queryClient.invalidateQueries({ queryKey: getGetShotQueryKey(shotId) });
      },
      onError: () => toast({ title: "Couldn’t start continuity check", description: "Your take is saved. Try again when the analysis service is available.", variant: "destructive" }),
    });
  }

  if (shotLoading) return <div className="space-y-4"><Skeleton className="h-10 w-56" /><Skeleton className="h-96 w-full" /></div>;
  if (!shotData) return <div className="border border-destructive/30 p-8 text-center text-destructive">Shot could not be loaded.</div>;

  const issues = check?.issues ?? [];
  const completed = check?.status === "completed";
  const analysisFailed = check?.status === "failed";
  const checkReady = Boolean(reference && current && (!check || analysisFailed));
  const title = completed
    ? `${issues.length} thing${issues.length === 1 ? "" : "s"} changed`
    : "Continuity results";

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <Link href={`/shots/${shotId}`} className="inline-flex items-center gap-2 text-xs font-mono text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> SHOT</Link>
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={analysisFailed ? "destructive" : completed ? "success" : "outline"}>{statusLabel(check?.status)}</Badge>
          {check?.model && <span className="text-[10px] font-mono text-muted-foreground">{check.model}</span>}
        </div>
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="text-muted-foreground">
          {current ? `Take ${String(current.takeNumber).padStart(2, "0")} compared with approved reference` : "Upload a new take before running a comparison."}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr_0.8fr]">
        {[["Reference", reference], ["Current Take", current]].map(([label, take]) => (
          <Card key={label as string} className="overflow-hidden">
            <CardHeader className="p-4 pb-3"><CardTitle className="text-sm">{label as string}</CardTitle></CardHeader>
            <CardContent className="p-0">{typeof take === "object" && take?.mediaUrl ? <img src={take.mediaUrl} alt={label as string} className="aspect-video w-full bg-black object-contain" /> : <div className="grid aspect-video place-items-center border-t border-dashed text-sm text-muted-foreground">No image</div>}</CardContent>
          </Card>
        ))}
        <Card className={completed && issues.length === 0 ? "border-success/40" : analysisFailed ? "border-destructive/40" : ""}>
          <CardHeader className="p-4 pb-3"><CardTitle className="flex items-center gap-2 text-sm"><ScanSearch className="h-4 w-4 text-primary" /> Analysis</CardTitle></CardHeader>
          <CardContent className="space-y-4 p-4 pt-0">
            {!reference ? <p className="text-sm text-muted-foreground">Capture an approved reference before checking a new take.</p> : !current ? <p className="text-sm text-muted-foreground">Capture a new take to compare with the approved reference.</p> : check?.status === "analyzing" || check?.status === "pending" ? <div className="flex items-center gap-3 text-sm"><Loader2 className="h-5 w-5 animate-spin text-primary" /> Visual state and continuity agents are working…</div> : completed && issues.length === 0 ? <div className="space-y-2"><CheckCircle2 className="h-8 w-8 text-success" /><h2 className="text-lg font-semibold">All clear</h2><p className="text-sm text-muted-foreground">Setup matches your approved continuity.</p></div> : analysisFailed ? <div className="space-y-2"><CircleAlert className="h-8 w-8 text-destructive" /><h2 className="text-lg font-semibold">Couldn’t complete the continuity check</h2><p className="text-sm text-muted-foreground">Your take is saved. Try the analysis again.</p>{check.errorMessage && <p className="text-xs text-destructive/80">{check.errorMessage}</p>}</div> : <div className="space-y-2"><AlertTriangle className="h-8 w-8 text-primary" /><h2 className="text-lg font-semibold">Ready to check</h2><p className="text-sm text-muted-foreground">Use the approved reference and persisted Visual State observations for this take.</p></div>}
            {reference && current && <Button className="w-full" onClick={() => runContinuityCheck(Boolean(check?.status === "failed" || check?.status === "completed"))} disabled={runCheck.isPending || check?.status === "analyzing" || check?.status === "pending"}>
              {runCheck.isPending || check?.status === "analyzing" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanSearch className="mr-2 h-4 w-4" />}
              {analysisFailed ? "Retry Analysis" : checkReady ? "Run Continuity Check" : "Run Again"}
            </Button>}
          </CardContent>
        </Card>
      </div>

      {completed && issues.length > 0 && <section className="space-y-3"><div><h2 className="text-lg font-semibold">What needs attention</h2><p className="text-sm text-muted-foreground">Only persisted, validated mismatches are shown.</p></div>{issues.map((issue) => <Card key={issue.id} className="border-l-4 border-l-primary"><CardContent className="space-y-4 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="text-base font-semibold">{issue.entity} changed</h3><p className="mt-1 text-xs font-mono uppercase text-muted-foreground">{issue.category.replace("_", " ")}</p></div><div className="flex flex-wrap gap-2"><Badge variant={severityVariant(issue.severity)}>{issue.severity}</Badge><Badge variant={issue.confidence >= 0.85 ? "success" : issue.confidence >= 0.6 ? "warning" : "outline"}>{Math.round(issue.confidence * 100)}% · {confidenceLabel(issue.confidence)}</Badge></div></div><div className="grid gap-3 text-sm sm:grid-cols-2"><div className="border border-border/70 bg-muted/20 p-3"><div className="text-[10px] font-mono uppercase text-muted-foreground">Expected state</div><p className="mt-1">{issue.expectedState}</p></div><div className="border border-border/70 bg-muted/20 p-3"><div className="text-[10px] font-mono uppercase text-muted-foreground">Observed state</div><p className="mt-1">{issue.observedState}</p></div></div><p className="text-sm text-muted-foreground">{issue.explanation}</p>{issue.suggestedFix && <div className="border border-primary/20 bg-primary/5 p-3 text-sm"><span className="font-medium">Suggested correction: </span>{issue.suggestedFix}</div>}</CardContent></Card>)}</section>}

      {import.meta.env.DEV && completed && <details className="rounded-sm border border-dashed border-border/70"><summary className="cursor-pointer p-4 text-sm font-medium">Developer comparison inspector</summary><div className="divide-y border-t border-border/60">{check.comparison.map((item) => <div key={`${item.category}-${item.entity}`} className="grid gap-3 p-4 text-sm md:grid-cols-[1.2fr_1fr_1fr_0.8fr]"><div><div className="text-[10px] font-mono text-muted-foreground">ENTITY</div><div className="font-medium">{item.entity}</div></div><div><div className="text-[10px] font-mono text-muted-foreground">APPROVED</div><div>{item.approvedState}</div></div><div><div className="text-[10px] font-mono text-muted-foreground">CURRENT</div><div className={item.mismatch ? "text-destructive" : ""}>{item.currentState ?? item.visibility.replace("_", " ")}</div></div><div><div className="text-[10px] font-mono text-muted-foreground">DECISION</div><div>{item.mismatch ? `mismatch · ${Math.round((item.confidence ?? 0) * 100)}%` : item.visibility === "visible" ? "match" : item.visibility.replace("_", " ")}</div></div></div>)}</div></details>}

      <Link href={`/shoot/${shotId}`}><Button variant="outline">Back to Shoot</Button></Link>
    </div>
  );
}
