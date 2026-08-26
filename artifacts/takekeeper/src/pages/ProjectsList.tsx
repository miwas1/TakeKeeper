import { useState } from "react";
import { Link } from "wouter";
import { useListProjects, useCreateProject, getListProjectsQueryKey, getGetDashboardQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Film, Plus, AlertCircle, Clock, Clapperboard } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const formSchema = z.object({
  title: z.string().min(1, "Project title is required").max(100),
  type: z.string().default("feature"),
});

export default function ProjectsList() {
  const { data: projects, isLoading, error } = useListProjects();
  const createProject = useCreateProject();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      type: "feature",
    },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    createProject.mutate(
      { data: values },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
          setOpen(false);
          form.reset();
          toast({
            title: "Project created",
            description: "New production workspace initialized.",
          });
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Failed to initialize project.",
            variant: "destructive",
          });
        },
      }
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Film className="w-8 h-8 text-primary" /> Projects
          </h1>
          <p className="text-muted-foreground text-sm font-mono mt-1">PRODUCTION DIRECTORY</p>
        </div>
        
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="font-mono text-xs uppercase tracking-wider">
              <Plus className="w-4 h-4 mr-2" /> New Project
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Initialize Production</DialogTitle>
              <DialogDescription>
                Create a new workspace for script and continuity tracking.
              </DialogDescription>
            </DialogHeader>
            
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Project Title</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. THE LAST SCENE" {...field} className="font-mono" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Production Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger className="font-mono">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="feature">FEATURE FILM</SelectItem>
                          <SelectItem value="short">SHORT FILM</SelectItem>
                          <SelectItem value="commercial">COMMERCIAL</SelectItem>
                          <SelectItem value="television">TELEVISION</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <DialogFooter className="pt-4">
                  <Button 
                    type="submit" 
                    disabled={createProject.isPending}
                    className="font-mono text-xs w-full sm:w-auto"
                  >
                    {createProject.isPending ? "INITIALIZING..." : "CREATE WORKSPACE"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : error ? (
        <div className="p-8 text-center border border-destructive/20 bg-destructive/5 rounded-sm">
          <AlertCircle className="w-8 h-8 mx-auto mb-3 text-destructive" />
          <h3 className="text-lg font-medium text-destructive">Failed to Load Projects</h3>
          <p className="text-muted-foreground mt-1">Verify connection to the TakeKeeper API.</p>
        </div>
      ) : projects?.length === 0 ? (
        <div className="text-center p-12 border border-dashed border-border rounded-sm">
          <Clapperboard className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h3 className="text-lg font-medium">No active productions</h3>
          <p className="text-muted-foreground mt-1 mb-4">Initialize a new project to start tracking continuity.</p>
          <Button variant="outline" onClick={() => setOpen(true)} className="font-mono text-xs">
            <Plus className="w-4 h-4 mr-2" /> CREATE FIRST PROJECT
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects?.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="h-full hover:border-primary/50 hover:shadow-[0_0_15px_rgba(245,158,11,0.1)] transition-all duration-300 cursor-pointer group bg-card">
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start gap-4">
                    <CardTitle className="line-clamp-2 text-lg group-hover:text-primary transition-colors">
                      {project.title}
                    </CardTitle>
                    <Badge variant={project.status === 'active' ? 'default' : 'secondary'} className="shrink-0 text-[10px]">
                      {project.status}
                    </Badge>
                  </div>
                  <CardDescription className="font-mono text-xs uppercase tracking-wider flex items-center gap-2 mt-1">
                    {project.type}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="bg-secondary/50 p-2 rounded-sm border border-border/50">
                        <div className="text-muted-foreground text-[10px] font-mono mb-1">SCENES</div>
                        <div className="font-mono font-bold text-foreground">{project.sceneCount}</div>
                      </div>
                      <div className="bg-secondary/50 p-2 rounded-sm border border-border/50">
                        <div className="text-muted-foreground text-[10px] font-mono mb-1">ISSUES</div>
                        <div className={cn("font-mono font-bold", project.activeIssueCount > 0 ? "text-destructive" : "text-success")}>
                          {project.activeIssueCount}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2">
                      <Clock className="w-3.5 h-3.5" />
                      Updated {new Date(project.updatedAt).toLocaleDateString()}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}