import { useGetDashboard } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Clapperboard, FolderOpen, AlertCircle, PlayCircle, Film, Camera } from "lucide-react";
import { Link } from "wouter";

export default function Dashboard() {
  const { data: dashboard, isLoading, error } = useGetDashboard();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="text-muted-foreground">Production workspace metrics</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <Skeleton className="h-4 w-[100px]" />
                <Skeleton className="h-4 w-4" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-[60px]" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-[300px] w-full" />
          <Skeleton className="h-[300px] w-full" />
        </div>
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="p-6 text-center text-destructive">
        <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p>Failed to load dashboard metrics. Agent connection may be interrupted.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Production Status</h1>
        <p className="text-muted-foreground text-sm font-mono">WORKSPACE / ACTIVE</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Projects</CardTitle>
            <FolderOpen className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono">{dashboard.activeProjectCount}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Scenes</CardTitle>
            <Clapperboard className="h-4 w-4 text-info" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono">{dashboard.sceneCount}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Open Issues</CardTitle>
            <AlertCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono text-destructive">{dashboard.openIssueCount}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Circled Takes</CardTitle>
            <PlayCircle className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono text-success">{dashboard.circledTakeCount}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Film className="w-5 h-5 text-muted-foreground" /> 
              Active Productions
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1">
            {dashboard.projects.length === 0 ? (
              <div className="text-sm text-muted-foreground h-full flex items-center justify-center border border-dashed border-border rounded-sm p-8">
                No active projects found.
              </div>
            ) : (
              <div className="space-y-4">
                {dashboard.projects.slice(0, 5).map(project => (
                  <Link 
                    key={project.id} 
                    href={`/projects/${project.id}`}
                    className="flex items-center justify-between p-3 rounded-sm border border-border bg-background hover:bg-secondary/50 transition-colors group cursor-pointer"
                  >
                    <div>
                      <div className="font-semibold text-sm group-hover:text-primary transition-colors">{project.title}</div>
                      <div className="text-xs text-muted-foreground font-mono mt-1">
                        {project.sceneCount} SCENES • {project.status.toUpperCase()}
                      </div>
                    </div>
                    {project.activeIssueCount > 0 && (
                      <Badge variant="destructive">{project.activeIssueCount} ISSUES</Badge>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ActivityIcon className="w-5 h-5 text-muted-foreground" />
              Recent Agent Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1">
            {dashboard.recentActivity.length === 0 ? (
              <div className="text-sm text-muted-foreground h-full flex items-center justify-center border border-dashed border-border rounded-sm p-8">
                No recent activity.
              </div>
            ) : (
              <div className="space-y-4">
                {dashboard.recentActivity.slice(0, 5).map(activity => (
                  <div key={activity.id} className="flex gap-4 p-3 rounded-sm border border-border bg-background">
                    <div className="w-2 h-2 mt-1.5 rounded-full bg-primary shrink-0" />
                    <div className="space-y-1 w-full">
                      <div className="flex items-start justify-between">
                        <span className="text-xs font-mono text-primary">{activity.agent}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(activity.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-sm">{activity.action}</p>
                      {activity.projectTitle && (
                        <p className="text-xs text-muted-foreground font-mono">{activity.projectTitle}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ActivityIcon(props: React.ComponentProps<"svg">) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}