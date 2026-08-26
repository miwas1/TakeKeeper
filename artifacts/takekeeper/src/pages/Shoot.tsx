import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetShotQueryKey,
  useCreateTake,
  useGetShot,
  useRegisterMedia,
  useRequestUploadUrl,
} from "@workspace/api-client-react";
import { ArrowLeft, Camera, ImagePlus, Loader2, RotateCcw, StickyNote, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

export default function Shoot() {
  const { shotId = "" } = useParams();
  const { data, isLoading, error } = useGetShot(shotId);
  const requestUpload = useRequestUploadUrl();
  const registerMedia = useRegisterMedia();
  const createTake = useCreateTake();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const reference = data?.takes.find((take) => take.isReference);
  const isReferenceFlow = !reference;
  const isSaving = requestUpload.isPending || registerMedia.isPending || createTake.isPending;

  function chooseFile(selected?: File) {
    if (!selected) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(selected.type)) {
      toast({ title: "Unsupported media", description: "Choose a JPEG, PNG, or WebP image.", variant: "destructive" });
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
  }

  async function saveTake() {
    if (!file || !data) return;
    try {
      const target = await requestUpload.mutateAsync({
        data: {
          projectId: data.scene.projectId,
          sceneId: data.scene.id,
          fileName: file.name,
          contentType: file.type,
          size: file.size,
        },
      });
      const uploadResponse = await fetch(target.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!uploadResponse.ok) throw new Error("Upload failed");
      const media = await registerMedia.mutateAsync({
        data: {
          projectId: data.scene.projectId,
          sceneId: data.scene.id,
          storageKey: target.storageKey,
          mediaType: file.type,
        },
      });
      await createTake.mutateAsync({ shotId, data: { notes: notes || undefined, isReference: isReferenceFlow, mediaId: media.id } });
      await queryClient.invalidateQueries({ queryKey: getGetShotQueryKey(shotId) });
      setFile(null);
      setPreviewUrl(null);
      setNotes("");
      toast({
        title: isReferenceFlow ? "Reference saved" : "Take saved",
        description: isReferenceFlow ? "This setup is now the approved reference." : "The take is saved and ready for future continuity analysis.",
      });
    } catch {
      toast({ title: "Upload failed", description: "Nothing was lost locally. Choose the image and try again.", variant: "destructive" });
    }
  }

  if (isLoading) return <div className="grid min-h-[70vh] place-items-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (error || !data) return <div className="p-8 text-center text-destructive">Shoot workspace could not be loaded.</div>;

  return (
    <div className="-m-4 min-h-[calc(100vh-8rem)] bg-black md:-m-8">
      <div className="relative mx-auto flex min-h-[calc(100vh-8rem)] max-w-6xl flex-col">
        <header className="z-10 flex items-center justify-between gap-3 border-b border-white/10 bg-black/80 p-4 backdrop-blur">
          <Link href={`/shots/${shotId}`} className="flex h-11 w-11 items-center justify-center text-white" aria-label="Back to shot"><ArrowLeft className="h-5 w-5" /></Link>
          <div className="text-center"><div className="font-mono text-sm font-bold text-white">SC {data.scene.sceneNumber} • {data.shot.label}</div><div className="mt-1 text-[10px] font-mono text-white/50">{data.scene.slugline}</div></div>
          <Badge variant={reference ? "success" : "outline"} className="border-white/20 text-[9px]">{reference ? "REFERENCE READY" : "NO REFERENCE"}</Badge>
        </header>

        <main className="relative flex min-h-[52vh] flex-1 items-center justify-center overflow-hidden bg-[#080808]">
          {previewUrl ? (
            <img src={previewUrl} alt="Selected take preview" className="h-full max-h-[68vh] w-full object-contain" />
          ) : reference?.mediaUrl ? (
            <>
              <img src={reference.mediaUrl} alt="Approved reference" className="h-full max-h-[68vh] w-full object-contain opacity-45" />
              <div className="absolute inset-0 grid place-items-center"><div className="border border-white/20 bg-black/70 px-5 py-3 text-center text-sm text-white"><ImagePlus className="mx-auto mb-2 h-5 w-5 text-primary" />Upload a new take to compare later</div></div>
            </>
          ) : (
            <div className="max-w-sm px-6 text-center text-white"><Camera className="mx-auto mb-4 h-10 w-10 text-primary" /><h1 className="text-xl font-semibold">Capture the setup you want future takes to match.</h1><p className="mt-2 text-sm text-white/55">Web capture uses a still image from your device or gallery.</p></div>
          )}
        </main>

        <footer className="border-t border-white/10 bg-[#0d0d0e] p-4">
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => chooseFile(event.target.files?.[0])} />
          {previewUrl ? (
            <div className="mx-auto max-w-xl space-y-3">
              <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Add take notes…" className="border-white/15 bg-white/5 text-white" />
              <div className="grid grid-cols-2 gap-3">
                <Button variant="outline" className="border-white/20 text-white hover:bg-white/10" onClick={() => inputRef.current?.click()} disabled={isSaving}><RotateCcw className="mr-2 h-4 w-4" /> Choose Another</Button>
                <Button onClick={saveTake} disabled={isSaving}>{isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}{isReferenceFlow ? "Use as Reference" : "Save New Take"}</Button>
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-xl items-center justify-center gap-4">
              <Button size="lg" className="min-w-56" onClick={() => inputRef.current?.click()}><Upload className="mr-2 h-5 w-5" />{isReferenceFlow ? "Upload Reference" : "Upload New Take"}</Button>
              <Button variant="ghost" size="icon" className="text-white" aria-label="Add notes after choosing an image"><StickyNote className="h-5 w-5" /></Button>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}