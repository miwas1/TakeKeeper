import { useState, useEffect } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useGetScreenplayImport, 
  useCreateScreenplayImport,
  useUpdateScreenplayImport,
  useApproveScreenplayImport,
  useRetryScreenplayImport,
  getGetScreenplayImportQueryKey,
  getGetProjectQueryKey,
  getListScenesQueryKey,
  ScreenplayBreakdown,
  ScreenplayScene,
  ScreenplayContinuityItem
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  FileText, Upload, Type, Cpu, AlertTriangle, RefreshCcw, 
  CheckCircle, ChevronLeft, Trash2, Plus, Film, Eye, Save, Check
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function ScreenplayImportPage() {
  const { projectId } = useParams();
  
  const { data, isLoading, error } = useGetScreenplayImport(projectId || "", {
    query: {
      retry: false,
      queryKey: getGetScreenplayImportQueryKey(projectId || ""),
      refetchInterval: (query) => query.state.data?.status === 'analyzing' ? 2000 : false,
    }
  });

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto mt-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[400px] w-full rounded-xl" />
      </div>
    );
  }

  // Assuming 404 means no import exists yet
  if ((error as { status?: number } | null)?.status === 404 || !data) {
    return <ImportForm projectId={projectId!} />;
  }

  if (error) {
    return (
      <div className="mx-auto mt-20 max-w-lg text-center">
        <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-destructive" />
        <h2 className="font-mono text-lg font-bold">SCREENPLAY WORKSPACE UNAVAILABLE</h2>
        <p className="mt-2 text-sm text-muted-foreground">The saved screenplay could not be loaded. Return to the project and try again.</p>
      </div>
    );
  }

  if (data.status === 'analyzing') {
    return <AnalyzingState />;
  }

  if (data.status === 'failed') {
    return <FailedState data={data} />;
  }

  if (data.status === 'review') {
    return <ReviewState data={data} projectId={projectId!} />;
  }

  if (data.status === 'approved') {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in zoom-in-95 duration-500">
        <CheckCircle className="w-16 h-16 text-success mb-6" />
        <h2 className="text-2xl font-bold font-mono">BREAKDOWN APPROVED</h2>
        <p className="text-muted-foreground mt-2 mb-8 max-w-sm">
          The script breakdown has been successfully processed and imported into the project.
        </p>
        <Link href={`/projects/${projectId}`}>
          <Button className="font-mono">RETURN TO PROJECT</Button>
        </Link>
      </div>
    );
  }

  return null;
}

function ImportForm({ projectId }: { projectId: string }) {
  const [mode, setMode] = useState<"paste" | "upload">("upload");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const create = useCreateScreenplayImport();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleProcess = async () => {
    if (mode === "paste") {
      if (text.trim().length < 40) {
        toast({ title: "Text too short", description: "Please paste a longer screenplay excerpt.", variant: "destructive" });
        return;
      }
      create.mutate(
        { projectId, data: { sourceType: "paste", content: text } },
        {
          onSuccess: (result) => queryClient.setQueryData(getGetScreenplayImportQueryKey(projectId), result),
          onError: () => toast({ title: "Import failed", description: "The screenplay could not be saved.", variant: "destructive" }),
        },
      );
    } else {
      if (!file) {
        toast({ title: "Please select a file", variant: "destructive" });
        return;
      }
      if (!file.name.toLowerCase().endsWith(".txt")) {
        toast({ title: "Unsupported file", description: "Choose a plain-text .txt screenplay.", variant: "destructive" });
        return;
      }
      try {
        const content = await file.text();
        if (content.trim().length < 40) {
          toast({ title: "File is empty or invalid", variant: "destructive" });
          return;
        }
        create.mutate(
          { projectId, data: { sourceType: "txt", fileName: file.name, content } },
          {
            onSuccess: (result) => queryClient.setQueryData(getGetScreenplayImportQueryKey(projectId), result),
            onError: () => toast({ title: "Import failed", description: "The screenplay could not be saved.", variant: "destructive" }),
          },
        );
      } catch {
        toast({ title: "Unreadable file", description: "TakeKeeper could not read this text file.", variant: "destructive" });
      }
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 mt-8 animate-in fade-in slide-in-from-bottom-4">
      <div className="space-y-2 mb-8">
        <div className="flex items-center gap-2 text-sm text-muted-foreground font-mono mb-2">
          <Link href={`/projects/${projectId}`} className="hover:text-foreground transition-colors">PROJECT</Link>
          <span>/</span>
          <span className="text-foreground">BREAKDOWN</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Script Breakdown</h1>
        <p className="text-muted-foreground">Upload a .txt script file or paste text to generate scenes and continuity items automatically using AI.</p>
      </div>

      <Card className="border-border/50 shadow-sm bg-card/50">
        <CardHeader className="border-b border-border/50 pb-4">
          <div className="flex bg-muted/50 p-1 rounded-md max-w-xs">
            <button 
              onClick={() => setMode("upload")}
              className={cn(
                "flex-1 py-1.5 text-xs font-mono font-medium rounded-sm transition-all duration-200 flex items-center justify-center gap-2", 
                mode === "upload" ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <Upload className="w-3.5 h-3.5" /> .TXT FILE
            </button>
            <button 
              onClick={() => setMode("paste")}
              className={cn(
                "flex-1 py-1.5 text-xs font-mono font-medium rounded-sm transition-all duration-200 flex items-center justify-center gap-2", 
                mode === "paste" ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <Type className="w-3.5 h-3.5" /> PASTE TEXT
            </button>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          {mode === "upload" ? (
             <div className="flex flex-col items-center justify-center border-2 border-dashed border-border/60 rounded-lg p-16 text-center bg-muted/10 transition-colors hover:bg-muted/20">
               <FileText className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
               <Input 
                 type="file" 
                 accept=".txt" 
                 className="max-w-xs mb-3 bg-card" 
                 onChange={e => setFile(e.target.files?.[0] || null)}
               />
               <p className="text-xs text-muted-foreground font-mono">Supported format: Plain text (.txt)</p>
             </div>
          ) : (
             <Textarea 
               placeholder="INT. COFFEE SHOP - DAY\n\nMAYA (20s) sits at a corner table, furiously typing on her laptop..." 
               className="min-h-[300px] font-mono text-sm resize-y"
               value={text}
               onChange={e => setText(e.target.value)}
             />
          )}
          
          <div className="mt-6 flex justify-end">
            <Button onClick={handleProcess} disabled={create.isPending} className="font-mono text-xs w-full sm:w-auto h-10 px-8">
              {create.isPending ? "PROCESSING..." : "ANALYZE SCRIPT"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function AnalyzingState() {
  return (
    <div className="max-w-md mx-auto mt-24 flex flex-col items-center text-center space-y-8 animate-in fade-in duration-1000">
      <div className="relative w-32 h-32 flex items-center justify-center">
        <div className="absolute inset-0 border-[3px] border-primary/20 rounded-full animate-ping" />
        <div className="absolute inset-0 border-[3px] border-primary rounded-full animate-[spin_2s_linear_infinite] border-t-transparent border-l-transparent" />
        <div className="absolute inset-2 border-[3px] border-secondary rounded-full animate-[spin_3s_linear_infinite_reverse] border-b-transparent" />
        <Cpu className="w-10 h-10 text-primary" />
      </div>
      <div className="space-y-3">
        <h2 className="text-xl font-bold font-mono tracking-widest text-primary">ANALYZING</h2>
        <p className="text-muted-foreground text-sm max-w-xs mx-auto leading-relaxed">
          Extracting scene headers, characters, and continuity items from script text.
        </p>
      </div>
    </div>
  );
}

function FailedState({ data }: { data: any }) {
  const retry = useRetryScreenplayImport();
  const queryClient = useQueryClient();
  return (
    <div className="max-w-md mx-auto mt-24 flex flex-col items-center text-center space-y-6 animate-in slide-in-from-bottom-4">
      <div className="w-24 h-24 bg-destructive/10 text-destructive rounded-full flex items-center justify-center mb-2">
        <AlertTriangle className="w-12 h-12" />
      </div>
      <div className="space-y-2">
        <h2 className="text-xl font-bold font-mono tracking-wider">ANALYSIS FAILED</h2>
        <p className="text-muted-foreground text-sm">
          {data.errorMessage || "The model failed to parse the provided text. Please try again."}
        </p>
      </div>
      <Button 
        variant="outline" 
        onClick={() => retry.mutate(
          { importId: data.id },
          { onSuccess: (result) => queryClient.setQueryData(getGetScreenplayImportQueryKey(data.projectId), result) },
        )}
        disabled={retry.isPending}
        className="font-mono text-xs mt-4"
      >
        <RefreshCcw className={cn("w-4 h-4 mr-2", retry.isPending && "animate-spin")} />
        {retry.isPending ? "RETRYING..." : "RETRY ANALYSIS"}
      </Button>
    </div>
  )
}

function ReviewState({ data, projectId }: { data: any, projectId: string }) {
  const [analysis, setAnalysis] = useState<ScreenplayBreakdown | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (data.analysis && !analysis) {
      setAnalysis(data.analysis);
    }
  }, [data.analysis, analysis]);

  const update = useUpdateScreenplayImport();
  const approve = useApproveScreenplayImport();

  if (!analysis) return null;

  const handleSave = () => {
    update.mutate({ importId: data.id, data: { analysis } }, {
      onSuccess: () => {
        toast({ title: "Draft saved", description: "Your changes have been saved." });
        queryClient.invalidateQueries({ queryKey: getGetScreenplayImportQueryKey(projectId) });
      }
    });
  };

  const handleApprove = () => {
    approve.mutate({ importId: data.id, data: { analysis } }, {
      onSuccess: () => {
        toast({ title: "Approved!", description: "Breakdown imported into the project." });
        queryClient.invalidateQueries({ queryKey: getListScenesQueryKey(projectId) });
        queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
        queryClient.invalidateQueries({ queryKey: getGetScreenplayImportQueryKey(projectId) });
        navigate(`/projects/${projectId}`);
      }
    });
  };

  const updateScene = (i: number, updates: Partial<ScreenplayScene>) => {
    setAnalysis(prev => {
      if (!prev) return prev;
      const newScenes = [...prev.scenes];
      newScenes[i] = { ...newScenes[i], ...updates };
      return { ...prev, scenes: newScenes };
    });
  };

  const addScene = () => {
    setAnalysis(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        scenes: [
          ...prev.scenes,
          {
            sceneNumber: "NEW",
            slugline: "NEW SCENE",
            location: "",
            intExt: "INT" as any,
            timeOfDay: "DAY",
            storyDay: "",
            scriptText: "",
            characters: [],
            continuityItems: []
          }
        ]
      }
    });
    setSelectedIndex(analysis.scenes.length);
  };

  const removeScene = (index: number) => {
    setAnalysis(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        scenes: prev.scenes.filter((_, i) => i !== index)
      }
    });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] -mt-2 animate-in fade-in duration-500">
      <div className="flex items-center justify-between py-4 border-b border-border/50">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono mb-1">
            <Link href={`/projects/${projectId}`} className="hover:text-foreground transition-colors">PROJECT</Link>
            <span>/</span>
            <span className="text-primary">REVIEW BREAKDOWN</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight">Review Import</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleSave} disabled={update.isPending || approve.isPending} className="font-mono text-xs">
            <Save className="w-3.5 h-3.5 mr-2" />
            <span className="hidden sm:inline">{update.isPending ? "SAVING..." : "SAVE DRAFT"}</span>
          </Button>
          <Button size="sm" onClick={handleApprove} disabled={approve.isPending || update.isPending} className="font-mono text-xs bg-primary text-primary-foreground hover:bg-primary/90">
            <Check className="w-3.5 h-3.5 mr-2" />
            <span className="hidden sm:inline">{approve.isPending ? "APPROVING..." : "APPROVE & IMPORT"}</span>
            <span className="sm:hidden">APPROVE</span>
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden mt-4 gap-6">
        {/* Left List Pane */}
        <div className={cn("w-full md:w-[340px] flex-col border border-border/50 rounded-lg bg-card/30 overflow-hidden", selectedIndex !== null ? "hidden md:flex" : "flex")}>
          <div className="p-3 border-b border-border/50 bg-muted/20 font-mono text-xs font-bold flex justify-between items-center">
            <span>SCENES ({analysis.scenes.length})</span>
            <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-primary/20 hover:text-primary" onClick={addScene}>
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          <ScrollArea className="flex-1">
             <div className="p-2 space-y-1">
               {analysis.scenes.length === 0 && (
                 <div className="p-6 text-center text-muted-foreground text-xs font-mono opacity-60">
                   No scenes extracted. Add one manually.
                 </div>
               )}
               {analysis.scenes.map((scene, i) => (
                 <button 
                   key={i} 
                   onClick={() => setSelectedIndex(i)}
                   className={cn(
                     "w-full text-left p-3 rounded-md transition-all border flex items-start gap-3 group",
                     selectedIndex === i ? "bg-muted/80 border-border shadow-sm" : "border-transparent hover:bg-muted/40"
                   )}
                 >
                   <div className="w-9 shrink-0 font-mono text-xs font-bold mt-0.5 text-muted-foreground group-hover:text-foreground">
                     {scene.sceneNumber || "—"}
                   </div>
                   <div className="flex-1 overflow-hidden">
                     <div className="text-sm font-medium truncate group-hover:text-primary transition-colors">{scene.slugline || "Untitled Scene"}</div>
                     <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-2 font-mono">
                       <span className={cn(scene.continuityItems.length > 0 ? "text-primary/80" : "opacity-50")}>
                         {scene.continuityItems.length} ITEMS
                       </span>
                     </div>
                   </div>
                 </button>
               ))}
             </div>
          </ScrollArea>
        </div>

        {/* Right Detail Pane */}
        <div className={cn("flex-1 flex-col border border-border/50 rounded-lg bg-card overflow-hidden", selectedIndex === null ? "hidden md:flex" : "flex")}>
           {selectedIndex === null ? (
             <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground opacity-40">
               <FileText className="w-16 h-16 mb-4" />
               <p className="font-mono text-sm">Select a scene to review its breakdown</p>
             </div>
           ) : (
             <SceneEditor 
                scene={analysis.scenes[selectedIndex]}
                onChange={(updates) => updateScene(selectedIndex, updates)}
                onRemove={() => {
                  removeScene(selectedIndex);
                  setSelectedIndex(null);
                }}
                onBack={() => setSelectedIndex(null)}
             />
           )}
        </div>
      </div>
    </div>
  )
}

function SceneEditor({ 
  scene, 
  onChange, 
  onRemove, 
  onBack 
}: { 
  scene: ScreenplayScene, 
  onChange: (updates: Partial<ScreenplayScene>) => void,
  onRemove: () => void,
  onBack: () => void
}) {
  const updateItem = (itemIdx: number, updates: Partial<ScreenplayContinuityItem>) => {
    const newItems = [...scene.continuityItems];
    newItems[itemIdx] = { ...newItems[itemIdx], ...updates };
    onChange({ continuityItems: newItems });
  };

  const removeItem = (itemIdx: number) => {
    const newItems = scene.continuityItems.filter((_, i) => i !== itemIdx);
    onChange({ continuityItems: newItems });
  };

  const addItem = () => {
    onChange({
      continuityItems: [
        ...scene.continuityItems,
        {
          category: "props",
          entity: "New Item",
          expectedState: "",
          confidence: 1,
          active: true,
          sourceType: "script",
          sourceEvidence: null,
        }
      ]
    });
  };

  return (
    <div className="flex flex-col h-full animate-in fade-in duration-300">
      <div className="p-3 border-b border-border/50 flex items-center justify-between bg-muted/10">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="md:hidden h-8 w-8 mr-1 text-muted-foreground" onClick={onBack}>
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <div className="font-mono font-bold text-sm bg-background px-2 py-1 rounded border shadow-sm">
            SCENE {scene.sceneNumber || "?"}
          </div>
        </div>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 font-mono text-xs" onClick={onRemove}>
          <Trash2 className="w-3.5 h-3.5 mr-2" />
          REMOVE SCENE
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 md:p-6 space-y-8 pb-20">
          
          <section className="space-y-5">
            <h3 className="text-xs font-mono text-primary font-bold flex items-center gap-2 border-b border-border/50 pb-2 uppercase tracking-wider">
              <Film className="w-4 h-4" /> Scene Metadata
            </h3>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase text-muted-foreground">Scene #</Label>
                <Input className="font-mono text-sm h-9 bg-muted/20" value={scene.sceneNumber} onChange={e => onChange({ sceneNumber: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase text-muted-foreground">INT/EXT</Label>
                <Select 
                  value={scene.intExt === "" ? "empty" : scene.intExt} 
                  onValueChange={v => onChange({ intExt: v === "empty" ? "" : v as any })}
                >
                  <SelectTrigger className="font-mono text-sm h-9 bg-muted/20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INT">INT</SelectItem>
                    <SelectItem value="EXT">EXT</SelectItem>
                    <SelectItem value="INT/EXT">INT/EXT</SelectItem>
                    <SelectItem value="empty">NONE</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label className="text-[10px] uppercase text-muted-foreground">Slugline</Label>
                <Input className="font-mono text-sm h-9 bg-muted/20" value={scene.slugline} onChange={e => onChange({ slugline: e.target.value })} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5 col-span-2">
                <Label className="text-[10px] uppercase text-muted-foreground">Location</Label>
                <Input className="font-mono text-sm h-9 bg-muted/20" value={scene.location} onChange={e => onChange({ location: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase text-muted-foreground">Time of Day</Label>
                <Input className="font-mono text-sm h-9 bg-muted/20" value={scene.timeOfDay} onChange={e => onChange({ timeOfDay: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase text-muted-foreground">Story Day</Label>
                <Input className="font-mono text-sm h-9 bg-muted/20" value={scene.storyDay} onChange={e => onChange({ storyDay: e.target.value })} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase text-muted-foreground">Characters</Label>
              <Input
                className="font-mono text-sm h-9 bg-muted/20"
                value={scene.characters.join(", ")}
                onChange={e => onChange({ characters: e.target.value.split(",").map(value => value.trim()).filter(Boolean) })}
                placeholder="MAYA, LEO"
              />
            </div>
            
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase text-muted-foreground">Script Action Excerpt</Label>
              <Textarea 
                className="font-mono text-sm min-h-[120px] resize-y bg-muted/20 leading-relaxed" 
                value={scene.scriptText || ""} 
                onChange={e => onChange({ scriptText: e.target.value })} 
              />
            </div>
          </section>

          <section className="space-y-5">
            <div className="flex items-center justify-between border-b border-border/50 pb-2">
              <h3 className="text-xs font-mono text-primary font-bold flex items-center gap-2 uppercase tracking-wider">
                <Eye className="w-4 h-4" /> Continuity Items
              </h3>
              <Button variant="secondary" size="sm" className="h-7 text-[10px] font-mono hover:bg-primary hover:text-primary-foreground" onClick={addItem}>
                <Plus className="w-3 h-3 mr-1" /> ADD ITEM
              </Button>
            </div>

            {scene.continuityItems.length === 0 ? (
              <div className="text-center p-10 text-muted-foreground text-sm border rounded-md border-dashed bg-muted/5 font-mono opacity-80">
                No continuity items detected for this scene.
              </div>
            ) : (
              <div className="space-y-4">
                {scene.continuityItems.map((item, j) => (
                  <div key={j} className={cn(
                    "p-4 border rounded-lg bg-background shadow-sm transition-all relative overflow-hidden", 
                    !item.active && "opacity-50 grayscale bg-muted/20",
                    item.confidence >= 0.8 ? "border-l-4 border-l-success" : 
                    item.confidence >= 0.5 ? "border-l-4 border-l-primary" : "border-l-4 border-l-destructive"
                  )}>
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-4">
                        <Badge variant="outline" className={cn(
                          "font-mono text-[9px] tracking-widest px-2 py-0.5 rounded-sm",
                          item.confidence >= 0.8 ? "text-success border-success/30 bg-success/10" : 
                          item.confidence >= 0.5 ? "text-primary border-primary/30 bg-primary/10" : 
                          "text-destructive border-destructive/30 bg-destructive/10"
                        )}>
                          {item.confidence >= 0.8 ? "HIGH CONF" : item.confidence >= 0.5 ? "LIKELY" : "REVIEW"}
                        </Badge>
                        <label className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                          <input 
                            type="checkbox" 
                            checked={item.active} 
                            onChange={e => updateItem(j, { active: e.target.checked })} 
                            className="rounded-sm border-input bg-transparent text-primary focus:ring-primary h-3.5 w-3.5"
                          />
                          TRACK ACTIVE
                        </label>
                      </div>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-sm -mr-1 -mt-1" onClick={() => removeItem(j)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-[10px] uppercase text-muted-foreground">Category</Label>
                         <Select value={item.category} onValueChange={value => updateItem(j, { category: value })}>
                           <SelectTrigger className="h-8 text-xs font-mono bg-muted/20 border-border/50">
                             <SelectValue />
                           </SelectTrigger>
                           <SelectContent>
                             {["wardrobe", "props", "hair_makeup", "blocking", "set", "action", "other"].map(category => (
                               <SelectItem key={category} value={category}>{category.replace("_", " ").toUpperCase()}</SelectItem>
                             ))}
                           </SelectContent>
                         </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] uppercase text-muted-foreground">Entity</Label>
                        <Input className="h-8 text-xs font-mono bg-muted/20 border-border/50" value={item.entity} onChange={e => updateItem(j, { entity: e.target.value })} />
                      </div>
                      <div className="space-y-1.5 md:col-span-2">
                        <Label className="text-[10px] uppercase text-muted-foreground">Expected State</Label>
                        <Input className="h-8 text-xs bg-muted/20 border-border/50" value={item.expectedState} onChange={e => updateItem(j, { expectedState: e.target.value })} />
                      </div>
                       <div className="space-y-1.5">
                         <Label className="text-[10px] uppercase text-muted-foreground">Confidence</Label>
                         <Input
                           type="number"
                           min="0"
                           max="1"
                           step="0.05"
                           className="h-8 text-xs font-mono bg-muted/20 border-border/50"
                           value={item.confidence}
                           onChange={e => updateItem(j, { confidence: Math.max(0, Math.min(1, Number(e.target.value))) })}
                         />
                       </div>
                    </div>

                     <div className="mt-4 space-y-1.5">
                       <Label className="text-[10px] uppercase text-muted-foreground">Script Evidence</Label>
                       <Textarea
                         className="min-h-16 text-xs font-mono bg-muted/20 border-border/50"
                         value={item.sourceEvidence || ""}
                         onChange={e => updateItem(j, { sourceEvidence: e.target.value || null })}
                         placeholder="Short screenplay excerpt supporting this item"
                       />
                     </div>
                    
                    {item.sourceEvidence && (
                      <div className="mt-4 p-2.5 bg-muted/30 rounded-md text-xs font-mono italic text-muted-foreground border-l-2 border-primary/30 flex gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary/50 mt-1 shrink-0" />
                        <span className="leading-relaxed">"{item.sourceEvidence}"</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

        </div>
      </ScrollArea>
    </div>
  )
}
