import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetShotQueryKey, useGetShot, useUpdateTake } from "@workspace/api-client-react";
import { ArrowLeft, Camera, CheckCircle2, CircleDot, Clock3, ImageIcon, StickyNote } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

export default function ShotWorkspace() {
  const { shotId = "" } = useParams();
  const { data, isLoading, error } = useGetShot(shotId);
  const updateTake = useUpdateTake();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const setStatus = (takeId: string, status: "unrated" | "hold" | "circle" | "reject") => {
    updateTake.mutate({ takeId, data: { status, isCircle: status === "circle" } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetShotQueryKey(shotId) });
        toast({ title: status === "circle" ? "Take marked Circle" : `Take marked ${status}` });
      },
    });
  };

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-56" /><Skeleton className="h-96 w-full" /></div>;
  if (error || !data) return <div className="border border-destructive/30 p-8 text-center text-destructive">Shot could not be loaded.</div>;

  const reference = data.takes.find((take) => take.isReference);
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header className="space-y-4">
        <Link href={`/scenes/${data.scene.id}`} className="inline-flex items-center gap-2 text-xs font-mono text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> SCENE {data.scene.sceneNumber}</Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-mono text-primary">SC {data.scene.sceneNumber} • SHOT</p>
            <h1 className="mt-1 text-3xl font-bold">{data.shot.label}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{data.shot.description || data.scene.slugline}</p>
          </div>
          <Link href={`/shoot/${data.shot.id}`}><Button className="w-full sm:w-auto"><Camera className="mr-2 h-4 w-4" /> {reference ? "Check New Take" : "Capture Reference"}</Button></Link>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="p-4"><div className="text-[10px] font-mono text-muted-foreground">REFERENCE</div><div className="mt-2 font-semibold">{reference ? "Ready" : "Not captured"}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-[10px] font-mono text-muted-foreground">TAKES</div><div className="mt-2 text-2xl font-bold font-mono">{data.takes.length}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-[10px] font-mono text-muted-foreground">CONTINUITY ISSUES</div><div className="mt-2 text-2xl font-bold font-mono">{data.shot.issueCount}</div></CardContent></Card>
      </div>

      {reference && (
        <Card className="overflow-hidden border-success/30">
          <CardHeader className="border-b border-border/60 p-4"><CardTitle className="flex items-center gap-2 text-sm"><ImageIcon className="h-4 w-4 text-success" /> Approved Reference</CardTitle></CardHeader>
          <CardContent className="p-0">
            {reference.mediaUrl ? <img src={reference.mediaUrl} alt={`Reference for ${data.shot.label}`} className="max-h-80 w-full bg-black object-contain" /> : <div className="grid h-48 place-items-center text-muted-foreground">Reference record has no attached image.</div>}
          </CardContent>
        </Card>
      )}

      <section className="space-y-3">
        <div><h2 className="text-lg font-semibold">Takes</h2><p className="text-sm text-muted-foreground">Rate takes and preserve the selected Circle take.</p></div>
        {data.takes.length === 0 ? (
          <Card className="border-dashed"><CardContent className="py-12 text-center"><Camera className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p>Capture the setup you want future takes to match.</p></CardContent></Card>
        ) : data.takes.map((take) => (
          <Card key={take.id} className={take.isCircle ? "border-primary bg-primary/5" : ""}>
            <CardContent className="p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex h-12 w-14 shrink-0 items-center justify-center border border-border bg-background font-mono font-bold">{String(take.takeNumber).padStart(2, "0")}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">TAKE {String(take.takeNumber).padStart(2, "0")}</span>{take.isReference && <Badge variant="success">Reference</Badge>}{take.isCircle && <Badge>Circle</Badge>}</div>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" />{new Date(take.capturedAt).toLocaleString()}</span><span>{take.issueCount} ISSUES</span></div>
                  {take.notes && <p className="mt-2 inline-flex items-start gap-2 text-sm text-muted-foreground"><StickyNote className="mt-0.5 h-3.5 w-3.5" />{take.notes}</p>}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex">
                  <Button size="sm" variant={take.status === "hold" ? "secondary" : "outline"} onClick={() => setStatus(take.id, "hold")}>Hold</Button>
                  <Button size="sm" variant={take.isCircle ? "default" : "outline"} onClick={() => setStatus(take.id, "circle")}><CircleDot className="mr-1.5 h-3.5 w-3.5" /> Circle</Button>
                  <Button size="sm" variant={take.status === "reject" ? "destructive" : "outline"} onClick={() => setStatus(take.id, "reject")}>Reject</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      {data.takes.length > 0 && <Link href={`/shots/${shotId}/results`}><Button variant="outline"><CheckCircle2 className="mr-2 h-4 w-4" /> View Continuity Results</Button></Link>}
    </div>
  );
}