import { useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetSceneQueryKey,
  useCreateContinuityItem,
  useCreateShot,
  useDeleteContinuityItem,
  useGetScene,
  useUpdateContinuityItem,
  type ContinuityItem,
} from "@workspace/api-client-react";
import { ArrowLeft, BookOpen, Camera, Clapperboard, Edit3, History, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const categories = [
  ["wardrobe", "Wardrobe"],
  ["props", "Props"],
  ["hair_makeup", "Hair & Makeup"],
  ["blocking", "Blocking"],
  ["set", "Set"],
  ["action", "Action"],
  ["other", "Other"],
] as const;

export default function SceneWorkspace() {
  const { sceneId = "" } = useParams();
  const { data, isLoading, error } = useGetScene(sceneId);
  const queryClient = useQueryClient();
  const createItem = useCreateContinuityItem();
  const updateItem = useUpdateContinuityItem();
  const deleteItem = useDeleteContinuityItem();
  const createShot = useCreateShot();
  const { toast } = useToast();
  const [continuityOpen, setContinuityOpen] = useState(false);
  const [shotOpen, setShotOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ContinuityItem | null>(null);
  const [category, setCategory] = useState("wardrobe");
  const [entity, setEntity] = useState("");
  const [expectedState, setExpectedState] = useState("");
  const [shotLabel, setShotLabel] = useState("");
  const [shotDescription, setShotDescription] = useState("");

  const refresh = () => queryClient.invalidateQueries({ queryKey: getGetSceneQueryKey(sceneId) });

  function openAddItem() {
    setEditingItem(null);
    setCategory("wardrobe");
    setEntity("");
    setExpectedState("");
    setContinuityOpen(true);
  }

  function openEditItem(item: ContinuityItem) {
    setEditingItem(item);
    setCategory(item.category);
    setEntity(item.entity);
    setExpectedState(item.currentApprovedState);
    setContinuityOpen(true);
  }

  function saveItem() {
    if (!entity.trim() || !expectedState.trim()) return;
    const onSuccess = () => {
      refresh();
      setContinuityOpen(false);
      toast({ title: editingItem ? "Continuity updated" : "Continuity item added" });
    };
    if (editingItem) {
      updateItem.mutate({ itemId: editingItem.id, data: { category, entity, expectedState } }, { onSuccess });
    } else {
      createItem.mutate({ sceneId, data: { category, entity, expectedState, sourceType: "manual", confidence: 1 } }, { onSuccess });
    }
  }

  function removeItem(item: ContinuityItem) {
    deleteItem.mutate({ itemId: item.id }, {
      onSuccess: () => {
        refresh();
        toast({ title: "Continuity item removed" });
      },
    });
  }

  function saveShot() {
    if (!shotLabel.trim()) return;
    createShot.mutate({ sceneId, data: { label: shotLabel, description: shotDescription || undefined } }, {
      onSuccess: () => {
        refresh();
        setShotOpen(false);
        setShotLabel("");
        setShotDescription("");
        toast({ title: "Shot created", description: "Ready for a reference setup." });
      },
    });
  }

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-80 w-full" /></div>;
  if (error || !data) return <div className="border border-destructive/30 p-8 text-center text-destructive">Scene workspace could not be loaded.</div>;

  const grouped = categories.map(([key, label]) => ({
    key,
    label,
    items: data.continuity.filter((item) => item.category === key),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header className="space-y-4">
        <Link href={`/projects/${data.scene.projectId}`} className="inline-flex items-center gap-2 text-xs font-mono text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> PROJECT
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xs font-mono text-primary">SCENE WORKSPACE</div>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">Scene {data.scene.sceneNumber}</h1>
            <p className="mt-2 text-sm font-mono text-muted-foreground">{data.scene.slugline}</p>
          </div>
          <Link href={data.shots[0] ? `/shoot/${data.shots[0].id}` : "#shots"}>
            <Button className="w-full font-mono text-xs sm:w-auto" disabled={!data.shots[0]}>
              <Camera className="mr-2 h-4 w-4" /> {data.shots[0] ? "OPEN SHOOT" : "ADD A SHOT FIRST"}
            </Button>
          </Link>
        </div>
      </header>

      <Tabs defaultValue="continuity" className="w-full">
        <TabsList className="grid h-12 w-full grid-cols-3 rounded-sm border border-border bg-card p-1">
          <TabsTrigger value="continuity">Continuity</TabsTrigger>
          <TabsTrigger value="shots">Shots</TabsTrigger>
          <TabsTrigger value="script">Script</TabsTrigger>
        </TabsList>

        <TabsContent value="continuity" className="mt-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Continuity Bible</h2>
              <p className="text-sm text-muted-foreground">Approved states future takes should match.</p>
            </div>
            <div className="flex gap-2"><Link href={`/scenes/${sceneId}/continuity-history`}><Button variant="outline" size="sm"><History className="mr-2 h-4 w-4" /> History</Button></Link><Button onClick={openAddItem} size="sm"><Plus className="mr-2 h-4 w-4" /> Add Item</Button></div>
          </div>
          {grouped.length === 0 ? (
            <Card className="border-dashed"><CardContent className="py-12 text-center">
              <BookOpen className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <h3 className="font-medium">Build this scene’s continuity checklist.</h3>
              <p className="mt-1 text-sm text-muted-foreground">Add wardrobe, props, blocking, and set details manually.</p>
            </CardContent></Card>
          ) : grouped.map((group) => (
            <Card key={group.key}>
              <CardHeader className="border-b border-border/60 p-4"><CardTitle className="text-sm">{group.label}</CardTitle></CardHeader>
              <CardContent className="divide-y divide-border/60 p-0">
                {group.items.map((item) => (
                  <div key={item.id} className="flex items-start gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{item.entity}</span>
                        <Badge variant="outline" className="text-[9px]">{item.sourceType}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-foreground">{item.currentApprovedState}</p>
                      {item.originalState !== item.currentApprovedState && <p className="mt-1 text-xs text-muted-foreground">Originally: {item.originalState}</p>}
                      {item.lastChange && <p className="mt-2 text-[10px] font-mono uppercase text-primary">Changed intentionally · Take {item.lastChange.sourceTakeNumber ?? "—"} · {item.lastChange.effectiveScope.replaceAll("_", " ")}</p>}
                    </div>
                    <Button variant="ghost" size="icon" aria-label={`Edit ${item.entity}`} onClick={() => openEditItem(item)}><Edit3 className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" aria-label={`Delete ${item.entity}`} onClick={() => removeItem(item)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="shots" id="shots" className="mt-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div><h2 className="text-lg font-semibold">Shot List</h2><p className="text-sm text-muted-foreground">Plan coverage and approve references.</p></div>
            <Button size="sm" onClick={() => setShotOpen(true)}><Plus className="mr-2 h-4 w-4" /> New Shot</Button>
          </div>
          {data.shots.length === 0 ? (
            <Card className="border-dashed"><CardContent className="py-12 text-center"><Clapperboard className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p>Add the first shot for this scene.</p></CardContent></Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {data.shots.map((shot) => (
                <Link key={shot.id} href={`/shots/${shot.id}`}>
                  <Card className="group h-full cursor-pointer transition-colors hover:border-primary/60">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div><div className="font-mono text-lg font-bold group-hover:text-primary">{shot.label}</div><p className="mt-1 text-sm text-muted-foreground">{shot.description || "No description"}</p></div>
                        <Badge variant={shot.referenceTakeId ? "success" : "outline"}>{shot.referenceTakeId ? "Reference ready" : "No reference"}</Badge>
                      </div>
                      <div className="mt-4 flex gap-4 text-xs font-mono text-muted-foreground"><span>{shot.takeCount} TAKES</span><span>{shot.issueCount} ISSUES</span></div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="script" className="mt-5">
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><BookOpen className="h-4 w-4" /> Scene Script</CardTitle></CardHeader>
            <CardContent>
              <div className="min-h-72 whitespace-pre-wrap border-l-2 border-primary/50 bg-background p-5 font-mono text-sm leading-7">
                {data.scene.scriptText || "No screenplay text has been added for this scene."}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={continuityOpen} onOpenChange={setContinuityOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingItem ? "Edit continuity item" : "Add continuity item"}</DialogTitle><DialogDescription>Record the approved visual state for this scene.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Category</Label><Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{categories.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Entity</Label><Input value={entity} onChange={(event) => setEntity(event.target.value)} placeholder="Maya’s red jacket" /></div>
            <div className="space-y-2"><Label>Expected / current state</Label><Textarea value={expectedState} onChange={(event) => setExpectedState(event.target.value)} placeholder="Unzipped, sleeves pushed to elbows" /></div>
          </div>
          <DialogFooter><Button onClick={saveItem} disabled={createItem.isPending || updateItem.isPending}>{editingItem ? "Save Changes" : "Add to Bible"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={shotOpen} onOpenChange={setShotOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create shot</DialogTitle><DialogDescription>Add the next setup for this scene.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Shot label</Label><Input value={shotLabel} onChange={(event) => setShotLabel(event.target.value)} placeholder="1A Wide" /></div>
            <div className="space-y-2"><Label>Description</Label><Textarea value={shotDescription} onChange={(event) => setShotDescription(event.target.value)} placeholder="Wide master covering Maya at the counter" /></div>
          </div>
          <DialogFooter><Button onClick={saveShot} disabled={createShot.isPending}>Create Shot</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
