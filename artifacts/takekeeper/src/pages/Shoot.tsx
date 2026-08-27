import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetShotQueryKey,
  getGetContinuityCheckQueryKey,
  useCreateTake,
  useDeleteMedia,
  useGetShot,
  useRegisterMedia,
  useRequestUploadUrl,
  useRunContinuityCheck,
  type UploadRequestContentType,
} from "@workspace/api-client-react";
import { ArrowLeft, Camera, Check, ImagePlus, Loader2, RotateCcw, StickyNote, Upload, X } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { inspectImage, prepareImage, uploadImage, validateImageFile, type ImageDimensions, type PreparedImage } from "@/lib/media";

type CaptureMode = "reference" | "take";
type UploadStage = "idle" | "preparing" | "uploading" | "saving" | "ready" | "error";

function newSubmissionKey() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.replace(/^HTTP \d+ [^:]*:\s*/, "") : "The image could not be saved. Try again or choose another image.";
}

export default function Shoot() {
  const { shotId = "" } = useParams();
  const { data, isLoading, error } = useGetShot(shotId);
  const requestUpload = useRequestUploadUrl();
  const registerMedia = useRegisterMedia();
  const createTake = useCreateTake();
  const deleteMedia = useDeleteMedia();
  const runContinuityCheck = useRunContinuityCheck();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<ImageDimensions | null>(null);
  const [prepared, setPrepared] = useState<PreparedImage | null>(null);
  const [uploadTarget, setUploadTarget] = useState<{ storageKey: string; uploadUrl: string } | null>(null);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [savedTakeId, setSavedTakeId] = useState<string | null>(null);
  const [submissionKey, setSubmissionKey] = useState(newSubmissionKey);
  const [notes, setNotes] = useState("");
  const [mode, setMode] = useState<CaptureMode>("reference");
  const [stage, setStage] = useState<UploadStage>("idle");
  const [progress, setProgress] = useState(0);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [replaceDialogOpen, setReplaceDialogOpen] = useState(false);
  const recheckIssueId = new URLSearchParams(window.location.search).get("recheckIssueId");

  const reference = data?.takes.find((take) => take.isReference);
  const isReferenceFlow = !reference || mode === "reference";
  const isBusy = stage === "preparing" || stage === "uploading" || stage === "saving" || stage === "ready";

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!file) setMode(reference ? "take" : "reference");
  }, [file, reference]);

  function discardUnattachedMedia() {
    if (mediaId && !savedTakeId) {
      void deleteMedia.mutateAsync({ mediaId }).catch(() => undefined);
    }
  }

  function resetCapture(cleanup = true) {
    if (cleanup) discardUnattachedMedia();
    setFile(null);
    setPreviewUrl(null);
    setDimensions(null);
    setPrepared(null);
    setUploadTarget(null);
    setUploadComplete(false);
    setMediaId(null);
    setSavedTakeId(null);
    setSubmissionKey(newSubmissionKey());
    setNotes("");
    setProgress(0);
    setErrorText(null);
    setStage("idle");
    if (inputRef.current) inputRef.current.value = "";
  }

  function chooseFile(selected?: File) {
    if (!selected) return;
    const validationError = validateImageFile(selected);
    if (validationError) {
      toast({ title: "Unsupported image", description: validationError, variant: "destructive" });
      return;
    }
    discardUnattachedMedia();
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
    setDimensions(null);
    setPrepared(null);
    setUploadTarget(null);
    setUploadComplete(false);
    setMediaId(null);
    setSavedTakeId(null);
    setSubmissionKey(newSubmissionKey());
    setProgress(0);
    setErrorText(null);
    setStage("idle");
    if (!reference) setMode("reference");
    if (inputRef.current) inputRef.current.value = "";
    void inspectImage(selected)
      .then(setDimensions)
      .catch((inspectionError) => setErrorText(errorMessage(inspectionError)));
  }

  function openPicker(nextMode: CaptureMode) {
    setMode(nextMode);
    inputRef.current?.click();
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    chooseFile(event.dataTransfer.files[0]);
  }

  async function saveTake() {
    if (!file || !data || isBusy) return;
    setErrorText(null);
    try {
      setStage("preparing");
      const nextPrepared = prepared ?? await prepareImage(file);
      setPrepared(nextPrepared);
      setDimensions({ width: nextPrepared.width, height: nextPrepared.height });
      setProgress(8);

      let nextTarget = uploadTarget;
      if (!nextTarget) {
        nextTarget = await requestUpload.mutateAsync({
          data: {
            projectId: data.scene.projectId,
            sceneId: data.scene.id,
            fileName: nextPrepared.file.name,
            contentType: nextPrepared.file.type as UploadRequestContentType,
            size: nextPrepared.file.size,
          },
        });
        setUploadTarget(nextTarget);
      }

      if (!uploadComplete) {
        setStage("uploading");
        await uploadImage(nextTarget.uploadUrl, nextPrepared.file, (value) => setProgress(Math.max(10, value)));
        setUploadComplete(true);
      }

      setStage("saving");
      let nextMediaId = mediaId;
      if (!nextMediaId) {
        const media = await registerMedia.mutateAsync({
          data: {
            projectId: data.scene.projectId,
            sceneId: data.scene.id,
            storageKey: nextTarget.storageKey,
            mediaType: nextPrepared.file.type,
            width: nextPrepared.width,
            height: nextPrepared.height,
          },
        });
        nextMediaId = media.id;
        setMediaId(media.id);
      }

      const take = await createTake.mutateAsync({
        shotId,
        data: {
          notes: notes.trim() || undefined,
          isReference: isReferenceFlow,
          mediaId: nextMediaId,
          submissionKey,
        },
      });
      setSavedTakeId(take.id);
      setProgress(100);
      setStage("ready");
      await queryClient.invalidateQueries({ queryKey: getGetShotQueryKey(shotId) });
      let recheckStarted = false;
      if (!isReferenceFlow && recheckIssueId) {
        try {
          await runContinuityCheck.mutateAsync({ takeId: take.id, data: { recheckIssueId } });
          recheckStarted = true;
          void queryClient.invalidateQueries({ queryKey: getGetContinuityCheckQueryKey(take.id) });
        } catch (recheckError) {
          toast({ title: "Take saved; recheck could not start", description: errorMessage(recheckError), variant: "destructive" });
        }
      }
      toast({
        title: isReferenceFlow ? "Reference saved" : `Take ${String(take.takeNumber).padStart(2, "0")} saved`,
        description: isReferenceFlow ? "Future takes for this shot will use this approved setup." : recheckStarted ? "A fresh continuity check is running against this take." : "The image is saved and ready for a future continuity check.",
      });
      window.setTimeout(() => {
        if (recheckStarted) window.location.href = `/shots/${shotId}/results`;
        else resetCapture(false);
      }, 700);
    } catch (saveError) {
      setStage("error");
      setErrorText(errorMessage(saveError));
      toast({ title: "Couldn’t save this image", description: errorMessage(saveError), variant: "destructive" });
    }
  }

  function requestSave() {
    if (isReferenceFlow && reference) {
      setReplaceDialogOpen(true);
      return;
    }
    void saveTake();
  }

  if (isLoading) return <div className="grid min-h-[70vh] place-items-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (error || !data) return <div className="p-8 text-center text-destructive">Shoot workspace could not be loaded.</div>;

  const stageLabel = {
    idle: "Ready",
    preparing: "Preparing image",
    uploading: "Uploading image",
    saving: "Saving take",
    ready: "Ready",
    error: "Upload needs attention",
  }[stage];

  return (
    <div className="-m-4 min-h-[calc(100vh-8rem)] bg-black md:-m-8">
      <div className="relative mx-auto flex min-h-[calc(100vh-8rem)] max-w-6xl flex-col">
        <header className="z-10 flex items-center justify-between gap-3 border-b border-white/10 bg-black/80 p-4 backdrop-blur">
          <Link href={`/shots/${shotId}`} className="flex h-11 w-11 items-center justify-center text-white" aria-label="Back to shot"><ArrowLeft className="h-5 w-5" /></Link>
          <div className="text-center"><div className="font-mono text-sm font-bold text-white">SC {data.scene.sceneNumber} • SHOT {data.shot.label}</div><div className="mt-1 text-[10px] font-mono text-white/50">{data.scene.slugline}</div></div>
          <Badge variant={reference ? "success" : "outline"} className="border-white/20 text-[9px]">{reference ? "REFERENCE READY" : "NO REFERENCE"}</Badge>
        </header>

        <main className="grid flex-1 gap-4 bg-[#080808] p-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div
            className={`relative flex min-h-[48vh] items-center justify-center overflow-hidden border border-white/10 bg-black transition-colors lg:min-h-0 ${dragActive ? "border-primary bg-primary/5" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { if (event.currentTarget === event.target) setDragActive(false); }}
            onDrop={handleDrop}
          >
            {previewUrl ? (
              <img src={previewUrl} alt="Selected image preview" className="h-full max-h-[68vh] w-full object-contain" />
            ) : reference?.mediaUrl ? (
              <>
                <img src={reference.mediaUrl} alt="Approved reference" className="h-full max-h-[68vh] w-full object-contain opacity-45" />
                <div className="absolute inset-0 grid place-items-center"><div className="border border-white/20 bg-black/70 px-5 py-3 text-center text-sm text-white"><ImagePlus className="mx-auto mb-2 h-5 w-5 text-primary" />Select a new take to continue</div></div>
              </>
            ) : (
              <div className="max-w-sm px-6 text-center text-white"><Camera className="mx-auto mb-4 h-10 w-10 text-primary" /><h1 className="text-xl font-semibold">Capture the setup you want future takes to match.</h1><p className="mt-2 text-sm text-white/55">Upload a still from your device or drag an image here. Camera access is optional.</p></div>
            )}
            {dragActive && <div className="absolute inset-0 grid place-items-center bg-black/70 text-sm font-medium text-white">Drop image to preview</div>}
          </div>

          <aside className="space-y-4 border border-white/10 bg-[#0d0d0e] p-4 text-white">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-white/45">Current reference</div>
              {reference?.mediaUrl ? <img src={reference.mediaUrl} alt={`Approved reference for ${data.shot.label}`} className="mt-2 aspect-video w-full bg-black object-contain" /> : <div className="mt-2 grid aspect-video place-items-center border border-dashed border-white/15 text-xs text-white/45">No approved reference</div>}
            </div>
            <div className="border-t border-white/10 pt-4 text-xs text-white/60">
              <div className="flex items-center justify-between"><span>Saved takes</span><span className="font-mono text-white">{data.takes.length}</span></div>
              {dimensions && <div className="mt-2 flex items-center justify-between"><span>Image size</span><span className="font-mono text-white">{dimensions.width} × {dimensions.height}</span></div>}
              <p className="mt-4 leading-relaxed">Images are uploaded to this project for continuity processing. You can remove project media from the production record.</p>
            </div>
          </aside>
        </main>

        <footer className="border-t border-white/10 bg-[#0d0d0e] p-4">
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={(event) => chooseFile(event.target.files?.[0])} />
          {previewUrl ? (
            <div className="mx-auto max-w-2xl space-y-3">
              <div className="flex items-center justify-between gap-3 text-xs text-white/60" aria-live="polite">
                <span className={stage === "error" ? "text-red-300" : stage === "ready" ? "text-emerald-300" : "text-white/70"}>{stage === "ready" ? <Check className="mr-1 inline h-3.5 w-3.5" /> : stage === "error" ? <X className="mr-1 inline h-3.5 w-3.5" /> : null}{stageLabel}</span>
                {stage !== "idle" && stage !== "error" && <span className="font-mono">{progress}%</span>}
              </div>
              {stage !== "idle" && <Progress value={progress} aria-label={`${stageLabel} ${progress}%`} className="bg-white/10" />}
              {errorText && <div className="border border-red-300/25 bg-red-400/10 px-3 py-2 text-xs text-red-100" role="alert">{errorText}</div>}
              <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Add take notes…" aria-label="Take notes" disabled={isBusy} className="border-white/15 bg-white/5 text-white placeholder:text-white/35" />
              <div className="grid gap-3 sm:grid-cols-2">
                <Button variant="outline" className="min-h-11 border-white/20 text-white hover:bg-white/10" onClick={() => resetCapture()} disabled={isBusy}><RotateCcw className="mr-2 h-4 w-4" /> Choose Another</Button>
                <Button className="min-h-11" onClick={stage === "error" ? () => void saveTake() : requestSave} disabled={isBusy || !dimensions}>
                  {isBusy && stage !== "ready" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  {stage === "error" ? "Retry Upload" : isReferenceFlow ? (reference ? "Use as New Reference" : "Use as Reference") : "Save New Take"}
                </Button>
              </div>
              {reference && stage === "idle" && <Button variant="ghost" size="sm" className="w-full text-white/60 hover:bg-white/5 hover:text-white" onClick={() => setMode(isReferenceFlow ? "take" : "reference")}>{isReferenceFlow ? "Save this image as a new take instead" : "Use this image to replace the reference instead"}</Button>}
            </div>
          ) : (
            <div className="mx-auto flex max-w-2xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-center">
              <Button size="lg" className="min-h-12 min-w-56" onClick={() => openPicker(reference ? "take" : "reference")}><Upload className="mr-2 h-5 w-5" />{reference ? "Upload New Take" : "Upload Reference"}</Button>
              {reference && <Button size="lg" variant="outline" className="min-h-12 border-white/20 text-white hover:bg-white/10" onClick={() => openPicker("reference")}><RotateCcw className="mr-2 h-5 w-5" /> Replace Reference</Button>}
              <Button variant="ghost" size="icon" className="self-center text-white" aria-label="Take notes after choosing an image" disabled><StickyNote className="h-5 w-5" /></Button>
            </div>
          )}
        </footer>
      </div>

      <AlertDialog open={replaceDialogOpen} onOpenChange={setReplaceDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace approved reference?</AlertDialogTitle>
            <AlertDialogDescription>Future continuity checks for this shot will use this image. The previous reference remains in take history.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current reference</AlertDialogCancel>
            <AlertDialogAction onClick={() => void saveTake()}>Replace reference</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
