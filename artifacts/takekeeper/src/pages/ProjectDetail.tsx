import { useParams } from "wouter";
import { useState } from "react";
import { 
  useGetProject, 
  useListScenes, 
  useCreateScene, 
  getGetProjectQueryKey,
  getListScenesQueryKey 
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Film, Plus, AlertCircle, MapPin, Camera, Video, Clock } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

const sceneFormSchema = z.object({
  sceneNumber: z.string().min(1, "Scene number is required"),
  slugline: z.string().min(1, "Slugline is required"),
  location: z.string().optional(),
  intExt: z.string().optional(),
  timeOfDay: z.string().optional(),
  storyDay: z.string().optional(),
});

export default function ProjectDetail() {
  const { projectId } = useParams();
  const { data: project, isLoading: projectLoading, error: projectError } = useGetProject(projectId || "");
  const { data: scenes, isLoading: scenesLoading } = useListScenes(projectId || "");
  
  const createScene = useCreateScene();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const form = useForm<z.infer<typeof sceneFormSchema>>({
    resolver: zodResolver(sceneFormSchema),
    defaultValues: {
      sceneNumber: "",
      slugline: "",
      location: "",
      intExt: "INT",
      timeOfDay: "DAY",
      storyDay: "D1",
    },
  });

  function onSubmit(values: z.infer<typeof sceneFormSchema>) {
    if (!projectId) return;
    
    createScene.mutate(
      { projectId, data: values },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListScenesQueryKey(projectId) });
          queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
          setOpen(false);
          form.reset();
          toast({
            title: "Scene added",
            description: "Scene has been added to the project.",
          });
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Failed to add scene.",
            variant: "destructive",
          });
        },
      }
    );
  }

  if (projectError) {
    return (
      <div className="p-8 text-center border border-destructive/20 bg-destructive/5 rounded-sm">
        <AlertCircle className="w-8 h-8 mx-auto mb-3 text-destructive" />
        <h3 className="text-lg font-medium text-destructive">Project Not Found</h3>
        <p className="text-muted-foreground mt-1 mb-4">The project you're looking for doesn't exist or you don't have access.</p>
        <Link href="/projects">
          <Button variant="outline">RETURN TO PROJECTS</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Header section */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground font-mono mb-2">
            <Link href="/projects" className="hover:text-foreground transition-colors">PROJECTS</Link>
            <span>/</span>
            <span className="text-foreground truncate max-w-[200px]">{project?.title || "..."}</span>
          </div>
          
          {projectLoading ? (
            <Skeleton className="h-10 w-64" />
          ) : (
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{project?.title}</h1>
          )}
          
          {projectLoading ? (
            <Skeleton className="h-5 w-48 mt-2" />
          ) : (
            <div className="flex flex-wrap items-center gap-3 text-sm mt-2">
              <Badge variant="secondary" className="font-mono text-[10px]">{project?.type}</Badge>
              <Badge variant={project?.status === 'active' ? 'default' : 'outline'} className="font-mono text-[10px]">
                {project?.status}
              </Badge>
              <span className="text-muted-foreground text-xs font-mono flex items-center gap-1">
                <Clock className="w-3 h-3" /> Updated {new Date(project?.updatedAt || "").toLocaleDateString()}
              </span>
            </div>
          )}
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="w-full shrink-0 font-mono text-xs uppercase tracking-wider sm:w-auto" disabled={projectLoading}>
              <Plus className="w-4 h-4 mr-2" /> Add Scene
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Scene</DialogTitle>
              <DialogDescription>
                Register a new scene for continuity tracking.
              </DialogDescription>
            </DialogHeader>
            
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="sceneNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Scene #</FormLabel>
                        <FormControl>
                          <Input placeholder="1A" {...field} className="font-mono uppercase" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="intExt"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>INT/EXT</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="font-mono">
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="INT">INT</SelectItem>
                            <SelectItem value="EXT">EXT</SelectItem>
                            <SelectItem value="INT/EXT">INT/EXT</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                
                <FormField
                  control={form.control}
                  name="slugline"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Slugline</FormLabel>
                      <FormControl>
                        <Input placeholder="MAIN OFFICE" {...field} className="font-mono uppercase" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="timeOfDay"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Time</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="font-mono">
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="DAY">DAY</SelectItem>
                            <SelectItem value="NIGHT">NIGHT</SelectItem>
                            <SelectItem value="MORNING">MORNING</SelectItem>
                            <SelectItem value="EVENING">EVENING</SelectItem>
                            <SelectItem value="CONTINUOUS">CONTINUOUS</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="storyDay"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Story Day</FormLabel>
                        <FormControl>
                          <Input placeholder="D1" {...field} className="font-mono uppercase" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                
                <DialogFooter className="pt-4">
                  <Button 
                    type="submit" 
                    disabled={createScene.isPending}
                    className="font-mono text-xs w-full sm:w-auto"
                  >
                    {createScene.isPending ? "ADDING..." : "ADD SCENE"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        <Card className="bg-card">
          <CardContent className="p-4 flex flex-col items-center justify-center text-center">
            <span className="text-muted-foreground text-[10px] font-mono mb-1">TOTAL SCENES</span>
            {projectLoading ? <Skeleton className="h-8 w-12" /> : <span className="text-2xl font-bold font-mono">{project?.sceneCount || 0}</span>}
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardContent className="p-4 flex flex-col items-center justify-center text-center">
            <span className="text-muted-foreground text-[10px] font-mono mb-1">OPEN ISSUES</span>
            {projectLoading ? <Skeleton className="h-8 w-12" /> : <span className={cn("text-2xl font-bold font-mono", project?.activeIssueCount ? "text-destructive" : "")}>{project?.activeIssueCount || 0}</span>}
          </CardContent>
        </Card>
        <Card className="bg-card opacity-50">
          <CardContent className="p-4 flex flex-col items-center justify-center text-center">
            <span className="text-muted-foreground text-[10px] font-mono mb-1">TOTAL SHOTS</span>
            <span className="text-2xl font-bold font-mono">—</span>
          </CardContent>
        </Card>
        <Card className="bg-card opacity-50">
          <CardContent className="p-4 flex flex-col items-center justify-center text-center">
            <span className="text-muted-foreground text-[10px] font-mono mb-1">COMPLETION</span>
            <span className="text-2xl font-bold font-mono">—%</span>
          </CardContent>
        </Card>
      </div>

      {/* Scenes List */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 border-b border-border/50 bg-secondary/20">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Video className="w-4 h-4 text-muted-foreground" />
            Script Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {scenesLoading ? (
            <div className="p-4 space-y-4">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !scenes || scenes.length === 0 ? (
            <div className="text-center p-12 text-muted-foreground border-t border-border/50">
              <Camera className="w-8 h-8 mx-auto mb-3 opacity-20" />
              <p className="text-sm">No scenes have been added to this project yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent bg-muted/20 border-border/50">
                  <TableHead className="w-20 font-mono text-[10px]">SC</TableHead>
                  <TableHead className="w-24 font-mono text-[10px]">I/E</TableHead>
                  <TableHead className="font-mono text-[10px]">SLUGLINE</TableHead>
                  <TableHead className="w-24 font-mono text-[10px]">TIME</TableHead>
                  <TableHead className="w-20 font-mono text-[10px]">DAY</TableHead>
                  <TableHead className="w-20 text-right font-mono text-[10px]">SHOTS</TableHead>
                  <TableHead className="w-20 text-right font-mono text-[10px]">CONT</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scenes.map((scene) => (
                  <TableRow key={scene.id} className="cursor-pointer group">
                    <TableCell className="font-mono font-bold">{scene.sceneNumber}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">{scene.intExt}</TableCell>
                    <TableCell>
                      <span className="font-mono font-medium group-hover:text-primary transition-colors">
                        {scene.slugline}
                      </span>
                      {scene.location && (
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
                          <MapPin className="w-3 h-3" /> {scene.location}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">{scene.timeOfDay}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">{scene.storyDay}</TableCell>
                    <TableCell className="text-right font-mono">{scene.shotCount}</TableCell>
                    <TableCell className="text-right font-mono">
                      <span className={cn(
                        "inline-flex items-center justify-center w-6 h-6 rounded-sm text-xs",
                        scene.continuityCount > 0 ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                      )}>
                        {scene.continuityCount}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}