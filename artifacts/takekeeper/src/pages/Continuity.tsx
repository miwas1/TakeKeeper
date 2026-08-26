import { ShieldCheck, ArrowRight, Lock, Image as ImageIcon, Camera } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

export default function Continuity() {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500 max-w-4xl mx-auto">
      <div className="text-center py-10 pb-6">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4 ring-1 ring-primary/20">
          <ShieldCheck className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Continuity Workspace</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl mx-auto">
          The foundation for automated visual continuity verification.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="bg-card border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera className="w-5 h-5 text-primary" />
              On-Set Capture
            </CardTitle>
            <CardDescription>
              Awaiting implementation of media ingestion pipeline.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-4">
            <p>
              Future iterations will allow script supervisors to upload stills and video clips directly from set, tagged automatically to active scenes and shots.
            </p>
            <div className="p-3 bg-secondary/50 rounded-sm font-mono text-[10px] border border-border/50">
              STATUS: PENDING_API_ROUTES
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-info/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-info" />
              Agentic Verification
            </CardTitle>
            <CardDescription>
              Awaiting computer vision models for frame analysis.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-4">
            <p>
              When media is uploaded, the TakeKeeper vision agents will analyze frames for prop placement, wardrobe consistency, and actor positioning across takes.
            </p>
            <div className="p-3 bg-secondary/50 rounded-sm font-mono text-[10px] border border-border/50">
              STATUS: ARCHITECTURE_PLANNING
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-8 border-dashed bg-transparent border-muted-foreground/30">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <Lock className="w-8 h-8 text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-medium">Workflow Locked</h3>
          <p className="text-muted-foreground text-sm max-w-md mt-2 mb-6">
            The continuity tracking module will be unlocked once the core project and scene infrastructure is validated in the current phase.
          </p>
          <Link href="/projects">
            <Button variant="outline" className="font-mono text-xs">
              MANAGE PROJECTS <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}