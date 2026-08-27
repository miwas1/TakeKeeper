import { ShieldCheck, ArrowRight, History, ListChecks } from "lucide-react";
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
          Review validated mismatches, make deliberate state decisions, and keep a traceable production record.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="bg-card border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="w-5 h-5 text-primary" />
              Human review loop
            </CardTitle>
            <CardDescription>
              Decisions stay attached to the issue that prompted them.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-4">
            <p>
              From a shot’s Results view, fix and recheck with a new take, approve an intentional change for a defined scope, ignore a false alarm, or add a note.
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-info/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="w-5 h-5 text-info" />
              Approved state history
            </CardTitle>
            <CardDescription>
              Original references and later approved states remain distinguishable.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-4">
            <p>
              Scene workspaces show the current approved state, original baseline, change scope, source take, and who approved it. Circle takes store the same snapshot for on-set reference.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-8 border-dashed bg-transparent border-muted-foreground/30">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <ShieldCheck className="w-8 h-8 text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-medium">Start from a scene</h3>
          <p className="text-muted-foreground text-sm max-w-md mt-2 mb-6">
            Open a scene to manage its continuity bible and inspect the full state-change history.
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
