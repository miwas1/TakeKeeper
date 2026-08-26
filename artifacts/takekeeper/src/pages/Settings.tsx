import { useHealthCheck } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings as SettingsIcon, Server, Database, CheckCircle2, XCircle } from "lucide-react";

export default function Settings() {
  const { data: health, isLoading, error } = useHealthCheck();

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