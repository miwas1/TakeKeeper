import { Link } from "wouter";
import { useListProjects } from "@workspace/api-client-react";
import { Camera, Clapperboard, FolderOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function ShootLauncher() {
  const { data: projects, isLoading } = useListProjects();
  return (
    <div className="space-y-6">
      <header><div className="text-xs font-mono text-primary">ON SET</div><h1 className="mt-1 text-3xl font-bold">Shoot</h1><p className="mt-2 text-muted-foreground">Choose an active production, then open a scene and shot.</p></header>
      <div className="relative overflow-hidden border border-primary/30 bg-card p-6">
        <Camera className="absolute -right-6 -top-6 h-32 w-32 text-primary/5" />
        <div className="relative max-w-xl"><Badge>Know what changed before you roll again.</Badge><h2 className="mt-4 text-xl font-semibold">Start from the approved setup.</h2><p className="mt-2 text-sm text-muted-foreground">Select a project below to open its current scene, choose a shot, and capture a reference or new take.</p></div>
      </div>
      {isLoading ? <p className="text-muted-foreground">Loading productions…</p> : projects?.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {projects.filter((project) => project.status === "active").map((project) => (
            <Card key={project.id}><CardContent className="flex items-center gap-4 p-4"><div className="grid h-12 w-12 place-items-center bg-primary/10 text-primary"><Clapperboard className="h-5 w-5" /></div><div className="min-w-0 flex-1"><div className="truncate font-semibold">{project.title}</div><div className="mt-1 text-xs font-mono text-muted-foreground">{project.sceneCount} SCENES • {project.activeIssueCount} WARNINGS</div></div><Link href={`/projects/${project.id}`}><Button size="sm">Open</Button></Link></CardContent></Card>
          ))}
        </div>
      ) : <Card className="border-dashed"><CardContent className="py-12 text-center"><FolderOpen className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p>Create a project to begin shooting.</p><Link href="/projects"><Button className="mt-4">Go to Projects</Button></Link></CardContent></Card>}
    </div>
  );
}