import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetContinuityCheckQueryKey,
  getGetContinuityIssueHistoryQueryKey,
  getGetSceneQueryKey,
  getGetShotQueryKey,
  useAddContinuityIssueNote,
  useApproveContinuityIssueChange,
  useGetContinuityCheck,
  useGetContinuityIssueHistory,
  useGetShot,
  useIgnoreContinuityIssue,
  useRunContinuityCheck,
  type ContinuityIssue,
} from "@workspace/api-client-react";
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleAlert, Loader2, ScanSearch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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

function severityIcon(severity: string) {
  if (severity === "high") return <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />;
  if (severity === "medium") return <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />;
  return <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />;
}

function severityLabel(severity: string) {
  if (severity === "high") return "High priority";
  if (severity === "medium") return "Review recommended";
  return "Low priority";
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
  const approveChange = useApproveContinuityIssueChange();
  const ignoreIssue = useIgnoreContinuityIssue();
  const addIssueNote = useAddContinuityIssueNote();
  const [intentionalIssueId, setIntentionalIssueId] = useState<string | null>(null);
  const [intentionalScope, setIntentionalScope] = useState<"this_shot" | "rest_of_scene" | "from_now_on">("rest_of_scene");
  const [intentionalState, setIntentionalState] = useState("");
  const [intentionalNote, setIntentionalNote] = useState("");
  const [ignoreIssueId, setIgnoreIssueId] = useState<string | null>(null);
  const [ignoreNote, setIgnoreNote] = useState("");
  const [noteIssueId, setNoteIssueId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [historyIssueId, setHistoryIssueId] = useState<string | null>(null);
  const issueHistoryQuery = useGetContinuityIssueHistory(historyIssueId ?? "", { query: { enabled: Boolean(historyIssueId), queryKey: getGetContinuityIssueHistoryQueryKey(historyIssueId ?? "") } });

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

  function refreshContinuity() {
    if (!current) return;
    void queryClient.invalidateQueries({ queryKey: getGetContinuityCheckQueryKey(current.id) });
    void queryClient.invalidateQueries({ queryKey: getGetShotQueryKey(shotId) });
    if (shotData?.scene.id) void queryClient.invalidateQueries({ queryKey: getGetSceneQueryKey(shotData.scene.id) });
  }

  function openIntentional(issue: ContinuityIssue) {
    setIntentionalIssueId(issue.id);
    setIntentionalScope("rest_of_scene");
    setIntentionalState(issue.observedState);
    setIntentionalNote("");
  }

  function saveIntentional() {
    if (!intentionalIssueId || !intentionalState.trim()) return;
    approveChange.mutate({
      issueId: intentionalIssueId,
      data: {
        newState: intentionalState.trim(),
        effectiveScope: intentionalScope,
        sourceTakeId: current?.id,
        note: intentionalNote.trim() || undefined,
      },
    }, {
      onSuccess: () => {
        setIntentionalIssueId(null);
        refreshContinuity();
        toast({ title: "Continuity updated", description: `This state will be expected for ${intentionalScope.replaceAll("_", " ")}.` });
      },
      onError: () => toast({ title: "Couldn’t approve this change", description: "The issue was not changed. Try again.", variant: "destructive" }),
    });
  }

  function saveIgnore() {
    if (!ignoreIssueId) return;
    ignoreIssue.mutate({ issueId: ignoreIssueId, data: ignoreNote.trim() ? { note: ignoreNote.trim() } : undefined }, {
      onSuccess: () => {
        setIgnoreIssueId(null);
        setIgnoreNote("");
        refreshContinuity();
        toast({ title: "Issue ignored", description: "The approved continuity state was left unchanged." });
      },
      onError: () => toast({ title: "Couldn’t ignore this issue", variant: "destructive" }),
    });
  }

  function saveNote() {
    if (!noteIssueId || !noteText.trim()) return;
    addIssueNote.mutate({ issueId: noteIssueId, data: { note: noteText.trim() } }, {
      onSuccess: () => {
        setNoteIssueId(null);
        setNoteText("");
        refreshContinuity();
        toast({ title: "Note saved" });
      },
      onError: () => toast({ title: "Couldn’t save note", variant: "destructive" }),
    });
  }

  if (shotLoading) return <div className="space-y-4"><Skeleton className="h-10 w-56" /><Skeleton className="h-96 w-full" /></div>;
  if (!shotData) return <div className="border border-destructive/30 p-8 text-center text-destructive">Shot could not be loaded.</div>;

  const issues = check?.issues ?? [];
  const openIssues = issues.filter((issue) => issue.status === "open");
  const resolvedIssues = issues.filter((issue) => issue.status !== "open");
  const completed = check?.status === "completed";
  const analysisFailed = check?.status === "failed";
  const checkReady = Boolean(reference && current && (!check || analysisFailed));
  const title = completed
    ? openIssues.length > 0
      ? `${openIssues.length} thing${openIssues.length === 1 ? "" : "s"} changed`
      : "All clear"
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
          {current ? `Take ${String(current.takeNumber).padStart(2, "0")} compared with approved continuity` : "Upload a new take before running a comparison."}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr_0.8fr]">
        {[["Reference", reference], ["Current Take", current]].map(([label, take]) => (
          <Card key={label as string} className="overflow-hidden">
            <CardHeader className="p-4 pb-3"><CardTitle className="text-sm">{label as string}</CardTitle></CardHeader>
            <CardContent className="p-0">{typeof take === "object" && take?.mediaUrl ? <img src={take.mediaUrl} alt={label as string} className="aspect-video w-full bg-black object-contain" /> : <div className="grid aspect-video place-items-center border-t border-dashed text-sm text-muted-foreground">No image</div>}</CardContent>
          </Card>
        ))}
        <Card className={completed && openIssues.length === 0 ? "border-success/40" : analysisFailed ? "border-destructive/40" : ""}>
          <CardHeader className="p-4 pb-3"><CardTitle className="flex items-center gap-2 text-sm"><ScanSearch className="h-4 w-4 text-primary" /> Continuity check</CardTitle></CardHeader>
          <CardContent className="space-y-4 p-4 pt-0">
            {!reference ? <p className="text-sm text-muted-foreground">Capture an approved reference before checking a new take.</p> : !current ? <p className="text-sm text-muted-foreground">Capture a new take to compare with the approved reference.</p> : check?.status === "analyzing" || check?.status === "pending" ? <div className="flex items-center gap-3 text-sm"><Loader2 className="h-5 w-5 animate-spin text-primary" /> Visual state and continuity agents are working…</div> : completed && openIssues.length === 0 ? <div className="space-y-2"><CheckCircle2 className="h-8 w-8 text-success" /><h2 className="text-lg font-semibold">All clear</h2><p className="text-sm text-muted-foreground">Setup matches your approved continuity. Any prior decisions remain in the audit trail.</p></div> : analysisFailed ? <div className="space-y-2"><CircleAlert className="h-8 w-8 text-destructive" /><h2 className="text-lg font-semibold">Couldn’t complete the continuity check</h2><p className="text-sm text-muted-foreground">Your take is saved. Try the analysis again.</p>{check.errorMessage && <p className="text-xs text-destructive/80">{check.errorMessage}</p>}</div> : <div className="space-y-2"><AlertTriangle className="h-8 w-8 text-primary" /><h2 className="text-lg font-semibold">Ready to check</h2><p className="text-sm text-muted-foreground">Use the approved reference and persisted Visual State observations for this take.</p></div>}
            {completed && openIssues.length > 0 && <div className="space-y-2 border-t border-border/60 pt-4"><div className="text-[10px] font-mono uppercase text-muted-foreground">Open issues</div>{openIssues.slice(0, 4).map((issue) => <div key={issue.id} className="flex items-start gap-2 text-sm"><span className={issue.severity === "high" ? "text-destructive" : issue.severity === "medium" ? "text-warning" : "text-muted-foreground"}>{severityIcon(issue.severity)}</span><span className="min-w-0 flex-1 truncate">{issue.entity}</span><span className="shrink-0 text-xs text-muted-foreground">{severityLabel(issue.severity)}</span></div>)}{openIssues.length > 4 && <p className="text-xs text-muted-foreground">{openIssues.length - 4} more below.</p>}</div>}
            {reference && current && <Button className="w-full" onClick={() => runContinuityCheck(Boolean(check?.status === "failed" || check?.status === "completed"))} disabled={runCheck.isPending || check?.status === "analyzing" || check?.status === "pending"}>
              {runCheck.isPending || check?.status === "analyzing" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanSearch className="mr-2 h-4 w-4" />}
              {analysisFailed ? "Retry Analysis" : checkReady ? "Run Continuity Check" : "Run Again"}
            </Button>}
          </CardContent>
        </Card>
      </div>

      {completed && openIssues.length > 0 && <section className="space-y-3"><div><h2 className="text-lg font-semibold">What needs attention</h2><p className="text-sm text-muted-foreground">Each decision is saved with its scope and audit history.</p></div>{openIssues.map((issue) => <Card key={issue.id} className="border-l-4 border-l-primary"><CardContent className="space-y-4 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="text-base font-semibold">{issue.entity} changed</h3><p className="mt-1 text-xs font-mono uppercase text-muted-foreground">{issue.category.replace("_", " ")} · {issue.stateDimension?.replaceAll("_", " ")}</p></div><div className="flex flex-wrap gap-2"><Badge variant={severityVariant(issue.severity)}>{severityIcon(issue.severity)}<span className="ml-1">{severityLabel(issue.severity)}</span></Badge><Badge variant={issue.confidence >= 0.85 ? "success" : issue.confidence >= 0.6 ? "warning" : "outline"}>{confidenceLabel(issue.confidence)}{import.meta.env.DEV && ` · ${Math.round(issue.confidence * 100)}%`}</Badge></div></div><div className="grid gap-3 text-sm sm:grid-cols-2"><div className="border border-border/70 bg-muted/20 p-3"><div className="text-[10px] font-mono uppercase text-muted-foreground">Approved state</div><p className="mt-1">{issue.expectedState}</p></div><div className="border border-border/70 bg-muted/20 p-3"><div className="text-[10px] font-mono uppercase text-muted-foreground">Observed state</div><p className="mt-1">{issue.observedState}</p></div></div><p className="text-sm text-muted-foreground">{issue.explanation}</p>{issue.suggestedFix && <div className="border border-primary/20 bg-primary/5 p-3 text-sm"><span className="font-medium">Suggested correction: </span>{issue.suggestedFix}</div>}{issue.notes && <p className="border-l-2 border-border pl-3 text-xs text-muted-foreground">Note: {issue.notes}</p>}<div className="flex flex-wrap gap-2 pt-1"><Link href={`/shoot/${shotId}?recheckIssueId=${encodeURIComponent(issue.id)}`}><Button size="sm"><ScanSearch className="mr-1.5 h-3.5 w-3.5" /> Fix &amp; Recheck</Button></Link><Button size="sm" variant="outline" onClick={() => openIntentional(issue)}>Intentional</Button><Button size="sm" variant="outline" onClick={() => setIgnoreIssueId(issue.id)}>Ignore</Button><Button size="sm" variant="ghost" onClick={() => { setNoteIssueId(issue.id); setNoteText(""); }}>Add note</Button><Button size="sm" variant="ghost" onClick={() => setHistoryIssueId(issue.id)}>History</Button></div></CardContent></Card>)}</section>}

      {completed && resolvedIssues.length > 0 && <section className="space-y-3"><div><h2 className="text-lg font-semibold">Recent decisions</h2><p className="text-sm text-muted-foreground">These records remain visible without changing the original reference.</p></div><div className="grid gap-3 md:grid-cols-2">{resolvedIssues.map((issue) => <Card key={issue.id}><CardContent className="space-y-2 p-4"><div className="flex items-center justify-between gap-3"><div className="font-medium">{issue.entity}</div><Badge variant={issue.status === "fixed" ? "success" : issue.status === "intentional" ? "info" : "secondary"}>{issue.status}</Badge></div>{issue.resolution && <p className="text-sm text-muted-foreground">{issue.resolution}</p>}{issue.notes && <p className="text-xs text-muted-foreground">{issue.notes}</p>}<div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => { setNoteIssueId(issue.id); setNoteText(""); }}>Add note</Button><Button size="sm" variant="ghost" onClick={() => setHistoryIssueId(issue.id)}>History</Button></div></CardContent></Card>)}</div></section>}

      {import.meta.env.DEV && completed && <details className="rounded-sm border border-dashed border-border/70"><summary className="cursor-pointer p-4 text-sm font-medium">Developer comparison inspector</summary><div className="divide-y border-t border-border/60">{check.comparison.map((item) => <div key={`${item.category}-${item.entity}`} className="grid gap-3 p-4 text-sm md:grid-cols-[1.2fr_1fr_1fr_0.8fr]"><div><div className="text-[10px] font-mono text-muted-foreground">ENTITY</div><div className="font-medium">{item.entity}</div></div><div><div className="text-[10px] font-mono text-muted-foreground">APPROVED</div><div>{item.approvedState}</div></div><div><div className="text-[10px] font-mono text-muted-foreground">CURRENT</div><div className={item.mismatch ? "text-destructive" : ""}>{item.currentState ?? item.visibility.replace("_", " ")}</div></div><div><div className="text-[10px] font-mono text-muted-foreground">DECISION</div><div>{item.mismatch ? `mismatch · ${Math.round((item.confidence ?? 0) * 100)}%` : item.visibility === "visible" ? "match" : item.visibility.replace("_", " ")}</div></div></div>)}</div></details>}

      <Link href={`/shoot/${shotId}`}><Button variant="outline">Back to Shoot</Button></Link>

      <Dialog open={Boolean(intentionalIssueId)} onOpenChange={(open) => { if (!open) setIntentionalIssueId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Update continuity from this take?</DialogTitle><DialogDescription>This updates the approved state for future comparisons. The original reference remains unchanged.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>New approved state</Label><Textarea value={intentionalState} onChange={(event) => setIntentionalState(event.target.value)} placeholder="Describe the state future takes should match" /></div>
            <div className="space-y-2"><Label>Scope</Label><select value={intentionalScope} onChange={(event) => setIntentionalScope(event.target.value as typeof intentionalScope)} className="h-10 w-full border border-input bg-background px-3 text-sm"><option value="this_shot">This shot only</option><option value="rest_of_scene">Rest of scene</option><option value="from_now_on">From now on</option></select></div>
            <div className="space-y-2"><Label>Note (optional)</Label><Textarea value={intentionalNote} onChange={(event) => setIntentionalNote(event.target.value)} placeholder="Why was this change approved?" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setIntentionalIssueId(null)}>Cancel</Button><Button onClick={saveIntentional} disabled={approveChange.isPending || !intentionalState.trim()}>{approveChange.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Approve change</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(ignoreIssueId)} onOpenChange={(open) => { if (!open) setIgnoreIssueId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Ignore issue</DialogTitle><DialogDescription>The approved state stays exactly as it is. Add context for the audit trail if useful.</DialogDescription></DialogHeader>
          <Textarea value={ignoreNote} onChange={(event) => setIgnoreNote(event.target.value)} placeholder="Optional note" />
          <DialogFooter><Button variant="outline" onClick={() => setIgnoreIssueId(null)}>Cancel</Button><Button onClick={saveIgnore} disabled={ignoreIssue.isPending}>{ignoreIssue.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Ignore issue</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(noteIssueId)} onOpenChange={(open) => { if (!open) setNoteIssueId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add issue note</DialogTitle><DialogDescription>Notes are appended to the persisted issue history.</DialogDescription></DialogHeader>
          <Textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="What should the crew remember?" />
          <DialogFooter><Button variant="outline" onClick={() => setNoteIssueId(null)}>Cancel</Button><Button onClick={saveNote} disabled={addIssueNote.isPending || !noteText.trim()}>{addIssueNote.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save note</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(historyIssueId)} onOpenChange={(open) => { if (!open) setHistoryIssueId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Issue history</DialogTitle><DialogDescription>Persisted detection, notes, and human decisions for this issue.</DialogDescription></DialogHeader>
          <div className="max-h-80 space-y-3 overflow-y-auto">{issueHistoryQuery.isLoading ? <div className="text-sm text-muted-foreground">Loading history…</div> : issueHistoryQuery.data?.events.length ? issueHistoryQuery.data.events.map((event) => <div key={event.id} className="border-l-2 border-border pl-3"><div className="flex flex-wrap items-center gap-2 text-xs font-mono"><span>{event.eventType.replaceAll("_", " ")}</span>{event.status && <Badge variant="outline" className="text-[9px]">{event.status}</Badge>}<span className="text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</span></div>{event.note && <p className="mt-1 text-sm">{event.note}</p>}{event.resolution && <p className="mt-1 text-xs text-muted-foreground">{event.resolution}</p>}</div>) : <div className="text-sm text-muted-foreground">No decision events recorded yet.</div>}</div>
          <DialogFooter><Button onClick={() => setHistoryIssueId(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
