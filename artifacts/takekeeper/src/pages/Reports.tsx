import { useState } from "react";
import { getGetDailyReportQueryKey, useGetDailyReport, useListProjects } from "@workspace/api-client-react";
import { CalendarDays, FileText, LockKeyhole } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Reports() {
  const { data: projects } = useListProjects();
  const [projectId, setProjectId] = useState("");
  const selectedId = projectId || projects?.[0]?.id || "";
  const reportParams = { projectId: selectedId };
  const { data: report } = useGetDailyReport(reportParams, { query: { enabled: Boolean(selectedId), queryKey: getGetDailyReportQueryKey(reportParams) } });
  const metrics = report ? [
    ["Scenes worked", report.scenesWorked],
    ["Shots", report.shots],
    ["Takes", report.takeCount],
    ["Circle takes", report.circleTakes],
    ["Issues caught", report.issuesCaught],
    ["Unresolved", report.unresolvedWarnings],
  ] : [];
  return (
    <div className="space-y-6">
      <header><div className="text-xs font-mono text-primary">PRODUCTION RECORD</div><h1 className="mt-1 text-3xl font-bold">Reports</h1><p className="mt-2 text-muted-foreground">Prepare a factual shoot-day summary from persisted activity.</p></header>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5" /> Daily Report</CardTitle></CardHeader><CardContent className="space-y-5">
        <Select value={selectedId} onValueChange={setProjectId}><SelectTrigger className="max-w-md"><SelectValue placeholder="Choose project" /></SelectTrigger><SelectContent>{projects?.map((project) => <SelectItem key={project.id} value={project.id}>{project.title}</SelectItem>)}</SelectContent></Select>
        {report && <><div className="grid grid-cols-2 gap-3 md:grid-cols-3">{metrics.map(([label, value]) => <div key={label as string} className="border border-border bg-background p-4"><div className="text-[10px] font-mono text-muted-foreground">{label as string}</div><div className="mt-2 text-2xl font-bold font-mono">{value as number}</div></div>)}</div><div className="flex items-start gap-3 border border-dashed border-border p-4"><LockKeyhole className="mt-0.5 h-5 w-5 text-primary" /><div><div className="font-medium">Report Agent not connected</div><p className="mt-1 text-sm text-muted-foreground">{report.message}</p></div></div></>}
        <Button disabled><FileText className="mr-2 h-4 w-4" /> Generate Report <Badge variant="secondary" className="ml-3">Later phase</Badge></Button>
      </CardContent></Card>
    </div>
  );
}
