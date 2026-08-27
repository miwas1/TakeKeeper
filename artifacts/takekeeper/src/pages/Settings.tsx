import { useState } from "react";
import { Link } from "wouter";
import { useHealthCheck } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings as SettingsIcon, Server, Database, CheckCircle2, XCircle, Bot, ExternalLink, Gauge, HardDrive } from "lucide-react";
import { Switch } from "@/components/ui/switch";

export default function Settings() {
  const { data: health, isLoading, error } = useHealthCheck();
  const [demoMode, setDemoMode] = useState(true);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <SettingsIcon className="w-8 h-8 text-primary" /> Environment
        </h1>
        <p className="text-muted-foreground text-sm font-mono mt-1">SYSTEM STATUS & CONFIGURATION</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Server className="w-5 h-5" />
              API Server
            </CardTitle>
            <CardDescription>Core backend connection status</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center gap-3 animate-pulse">
                <div className="w-3 h-3 rounded-full bg-muted-foreground" />
                <span className="font-mono text-sm">CHECKING...</span>
              </div>
            ) : error ? (
              <div className="flex items-center gap-3 text-destructive">
                <XCircle className="w-5 h-5" />
                <span className="font-mono text-sm font-bold">DISCONNECTED</span>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-3 text-success">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="font-mono text-sm font-bold">ONLINE</span>
                  <Badge variant="success" className="ml-auto text-[10px]">VERIFIED</Badge>
                </div>
                <div className="pt-4 border-t border-border/50">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Status Response</span>
                    <span className="font-mono">{health?.status}</span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Database className="w-5 h-5" />
              Database
            </CardTitle>
            <CardDescription>PostgreSQL connection status</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center gap-3 animate-pulse">
                <div className="w-3 h-3 rounded-full bg-muted-foreground" />
                <span className="font-mono text-sm">CHECKING...</span>
              </div>
            ) : error ? (
              <div className="flex items-center gap-3 text-destructive">
                <XCircle className="w-5 h-5" />
                <span className="font-mono text-sm font-bold">UNKNOWN</span>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-3 text-success">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="font-mono text-sm font-bold">CONNECTED</span>
                  <Badge variant="success" className="ml-auto text-[10px]">VERIFIED</Badge>
                </div>
                <div className="pt-4 border-t border-border/50">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Status Response</span>
                    <span className="font-mono">{health?.database}</span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card">
        <CardHeader className="border-b border-border/50">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg"><Bot className="h-5 w-5 text-primary" /> Developer · Demo Mode</CardTitle>
              <CardDescription>Safe observability for the continuity and reporting workflows. Secrets and hidden reasoning stay out of the UI.</CardDescription>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground"><span>{demoMode ? "ON" : "OFF"}</span><Switch checked={demoMode} onCheckedChange={setDemoMode} aria-label="Toggle Demo Mode" /></div>
          </div>
        </CardHeader>
        {demoMode && <CardContent className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatusLine icon={Bot} label="Google Agent" value={health?.agent.status ?? "Unknown"} detail={health?.agent.model ?? "—"} good={health?.agent.status === "ready"} />
            <StatusLine icon={Gauge} label="Latest latency" value={health?.latestAgentLatencyMs != null ? `${health.latestAgentLatencyMs}ms` : "—"} detail="last persisted event" />
            <StatusLine icon={HardDrive} label="Storage" value={health?.storage.status ?? "Unknown"} detail={health?.storage.provider ?? "—"} good={health?.storage.status === "ready"} />
            <StatusLine icon={Server} label="Auth" value={health?.auth ?? "Unknown"} detail={health?.environment ?? "—"} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-4 text-sm">
            <div className="text-muted-foreground">Agent Engine: <span className="font-mono text-foreground">{health?.agent.agentEngineConfigured ? "configured" : "configuration pending"}</span> · Google project: <span className="font-mono text-foreground">{health?.agent.cloudProjectConfigured ? "configured" : "configuration pending"}</span></div>
            <Link href="/agent-activity" className="inline-flex items-center gap-2 text-xs font-mono text-primary hover:underline">Open Agent Activity <ExternalLink className="h-3.5 w-3.5" /></Link>
          </div>
        </CardContent>}
      </Card>

      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-lg">Client Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 font-mono text-sm">
            <div className="flex flex-col sm:flex-row sm:justify-between py-2 border-b border-border/50">
              <span className="text-muted-foreground mb-1 sm:mb-0">Frontend Version</span>
              <span>v0.1.0-alpha</span>
            </div>
            <div className="flex flex-col sm:flex-row sm:justify-between py-2 border-b border-border/50">
              <span className="text-muted-foreground mb-1 sm:mb-0">Environment</span>
              <span>Development</span>
            </div>
            <div className="flex flex-col sm:flex-row sm:justify-between py-2">
              <span className="text-muted-foreground mb-1 sm:mb-0">Theme Mode</span>
              <span className="text-primary">Cinematic Dark</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusLine({ icon: Icon, label, value, detail, good }: { icon: typeof Server; label: string; value: string; detail: string; good?: boolean }) {
  return <div className="border border-border/70 p-3"><div className={`flex items-center gap-2 text-[10px] font-mono uppercase ${good === false ? "text-warning" : good ? "text-success" : "text-muted-foreground"}`}><Icon className="h-3.5 w-3.5" /> {label}</div><div className="mt-1 truncate text-sm font-semibold">{value}</div><div className="mt-1 truncate text-[10px] text-muted-foreground">{detail}</div></div>;
}
