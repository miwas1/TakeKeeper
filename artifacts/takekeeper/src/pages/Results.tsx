import { Link, useParams } from "wouter";
import { useGetShot } from "@workspace/api-client-react";
import { ArrowLeft, ScanSearch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function Results() {
  const { shotId = "" } = useParams();
  const { data } = useGetShot(shotId);
  const reference = data?.takes.find((take) => take.isReference);
  const current = data?.takes.filter((take) => !take.isReference).sort((left, right) => right.takeNumber - left.takeNumber)[0];
  return (
    <div className="space-y-6">
      <Link href={`/shots/${shotId}`} className="inline-flex items-center gap-2 text-xs font-mono text-muted-foreground"><ArrowLeft className="h-4 w-4" /> SHOT</Link>
      <header><Badge variant="outline">READY FOR FUTURE CHECK</Badge><h1 className="mt-3 text-3xl font-bold">Continuity results</h1><p className="mt-2 text-muted-foreground">{current ? `Take ${String(current.takeNumber).padStart(2, "0")} is saved. A real comparison can run when the Continuity Supervisor is connected.` : "Upload a new take before running a comparison."}</p></header>
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr_0.8fr]">
        {[["Reference", reference], ["Current Take", current]].map(([label, take]) => (
          <Card key={label as string}><CardHeader><CardTitle className="text-sm">{label as string}</CardTitle></CardHeader><CardContent>{typeof take === "object" && take?.mediaUrl ? <img src={take.mediaUrl} alt={label as string} className="aspect-video w-full bg-black object-contain" /> : <div className="grid aspect-video place-items-center border border-dashed text-sm text-muted-foreground">No image</div>}</CardContent></Card>
        ))}
        <Card><CardHeader><CardTitle className="text-sm">Issues</CardTitle></CardHeader><CardContent className="py-8 text-center"><ScanSearch className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-medium">Comparison not run</p><p className="mt-2 text-sm text-muted-foreground">No AI findings are shown yet. TakeKeeper only displays persisted media until the comparison phase is implemented.</p></CardContent></Card>
      </div>
      <Link href={`/shoot/${shotId}`}><Button>Back to Shoot</Button></Link>
    </div>
  );
}
