import { useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetContinuityHistoryQueryKey, getGetSceneQueryKey, useCreateContinuityChange, useGetContinuityHistory, useGetScene } from "@workspace/api-client-react";
import { ArrowLeft, ArrowRight, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

function scopeLabel(scope: string) {
  if (scope === "this_shot") return "This shot only";
  if (scope === "rest_of_scene") return "Rest of scene";
  return "From now on";
}

export default function ContinuityHistory() {
  const { sceneId = "" } = useParams();
  const queryClient = useQueryClient();
  const { data: scene } = useGetScene(sceneId);
  const { data: history, isLoading, error } = useGetContinuityHistory(sceneId);
  const createChange = useCreateContinuityChange();
  const { toast } = useToast();
  const [correction, setCorrection] = useState<{
    itemId: string;
    sourceTakeId: string;
    state: string;
    scope: "this_shot" | "rest_of_scene" | "from_now_on";
  } | null>(null);

  function saveCorrection() {
    if (!correction?.state.trim()) return;
    createChange.mutate({
      itemId: correction.itemId,
      data: {
        newState: correction.state.trim(),
        effectiveScope: correction.scope,
        sourceTakeId: correction.sourceTakeId,
        effectiveFromTakeId: correction.sourceTakeId,
        note: "Corrective approved state change",
      },
    }, {
      onSuccess: () => {
        setCorrection(null);
        void queryClient.invalidateQueries({ queryKey: getGetContinuityHistoryQueryKey(sceneId) });
        void queryClient.invalidateQueries({ queryKey: getGetSceneQueryKey(sceneId) });
        toast({ title: "Correction saved", description: "The earlier decision remains in history." });
      },
      onError: () => toast({ title: "Couldn’t save correction", description: "The approved state was not changed.", variant: "destructive" }),
    });
  }

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-56" /><Skeleton className="h-72 w-full" /></div>;
  if (error) return <div className="border border-destructive/30 p-8 text-center text-destructive">Continuity history could not be loaded.</div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <Link href={`/scenes/${sceneId}`} className="inline-flex items-center gap-2 text-xs font-mono text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> SCENE</Link>
      <header>
        <div className="flex items-center gap-2 text-xs font-mono text-primary"><History className="h-4 w-4" /> APPROVED STATE HISTORY</div>
        <h1 className="mt-2 text-3xl font-bold">Scene {scene?.scene.sceneNumber ?? ""} continuity history</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Every intentional state change, its effective scope, source take, approving user, and corrective history remain visible after reload.</p>
      </header>

      {!history?.length ? (
        <Card className="border-dashed"><CardContent className="py-14 text-center text-sm text-muted-foreground">No intentional continuity changes have been approved for this scene.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {history.map((entry) => (
            <Card key={entry.id}>
              <CardHeader className="p-4 pb-2"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">{entry.entity}</CardTitle><p className="mt-1 text-xs font-mono uppercase text-muted-foreground">{entry.category.replaceAll("_", " ")} · <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time></p></div><div className="flex flex-wrap gap-2"><Badge variant="info">{scopeLabel(entry.effectiveScope)}</Badge>{entry.supersedesChangeId && <Badge variant="outline">Corrects earlier decision</Badge>}</div></div></CardHeader>
              <CardContent className="space-y-3 p-4 pt-2">
                <div className="flex flex-wrap items-center gap-2 text-sm"><span className="border border-border/70 bg-muted/20 px-3 py-2">{entry.previousState}</span><ArrowRight className="h-4 w-4 text-muted-foreground" /><span className="border border-primary/30 bg-primary/5 px-3 py-2 font-medium">{entry.newState}</span></div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground"><span>Source: Take {entry.sourceTakeNumber} · {entry.shotLabel}</span><span>Approved by: {entry.userDisplayName ?? entry.userId}</span>{entry.effectiveUntilTakeId && <span>Ends at a later take</span>}<Link href={`/shots/${entry.shotId}`} className="text-primary hover:underline">Open shot</Link><Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => setCorrection({ itemId: entry.continuityItemId, sourceTakeId: entry.sourceTakeId, state: entry.previousState, scope: entry.effectiveScope })}>Correct this state</Button></div>
                {entry.reason && <p className="border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground">{entry.reason}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={Boolean(correction)} onOpenChange={(open) => { if (!open) setCorrection(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Correct approved state</DialogTitle><DialogDescription>Save a new corrective change. The earlier approval stays preserved in the timeline.</DialogDescription></DialogHeader>
          {correction && <div className="space-y-4"><div className="space-y-2"><Label>Correct state to</Label><Textarea value={correction.state} onChange={(event) => setCorrection({ ...correction, state: event.target.value })} /></div><div className="space-y-2"><Label>Scope</Label><select value={correction.scope} onChange={(event) => setCorrection({ ...correction, scope: event.target.value as typeof correction.scope })} className="h-10 w-full border border-input bg-background px-3 text-sm"><option value="this_shot">This shot only</option><option value="rest_of_scene">Rest of scene</option><option value="from_now_on">From now on</option></select></div></div>}
          <DialogFooter><Button variant="outline" onClick={() => setCorrection(null)}>Cancel</Button><Button onClick={saveCorrection} disabled={createChange.isPending || !correction?.state.trim()}>{createChange.isPending ? "Saving…" : "Save correction"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
