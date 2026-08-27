import assert from "node:assert/strict";

const apiBase = process.env.TAKEKEEPER_API_URL ?? "http://127.0.0.1:8080/api";
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function absoluteUrl(value: unknown) {
  return new URL(String(value), apiBase).toString();
}

async function json(response: Response) {
  const payload = await response.json();
  assert.ok(response.ok, `${response.status}: ${JSON.stringify(payload)}`);
  return payload as Record<string, any>;
}

async function uploadMedia(projectId: string, sceneId: string, fileName: string) {
  const target = await json(await fetch(`${apiBase}/storage/uploads/request-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, sceneId, fileName, contentType: "image/png", size: png.byteLength }),
  }));
  const upload = await fetch(absoluteUrl(target.uploadUrl), { method: "PUT", headers: { "Content-Type": "image/png" }, body: png });
  assert.ok(upload.ok, `Fixture upload failed with ${upload.status}`);
  return json(await fetch(`${apiBase}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, sceneId, storageKey: target.storageKey, mediaType: "image/png" }),
  }));
}

const project = await json(await fetch(`${apiBase}/projects`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ title: `Phase 4 Workflow ${suffix}`, type: "short_film" }),
}));
const projectId = String(project.id);

try {
  const scene = await json(await fetch(`${apiBase}/projects/${projectId}/scenes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sceneNumber: "1", slugline: "INT. KITCHEN — NIGHT", location: "Kitchen", intExt: "INT", timeOfDay: "NIGHT", storyDay: "1" }),
  }));
  const sceneId = String(scene.id);
  const shot = await json(await fetch(`${apiBase}/scenes/${sceneId}/shots`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: "1A", description: "Test master" }),
  }));
  const shotId = String(shot.id);

  const referenceMedia = await uploadMedia(projectId, sceneId, "reference.png");
  const reference = await json(await fetch(`${apiBase}/shots/${shotId}/takes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mediaId: referenceMedia.id, isReference: true, submissionKey: `reference-${suffix}` }),
  }));
  const duplicateReference = await json(await fetch(`${apiBase}/shots/${shotId}/takes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mediaId: referenceMedia.id, isReference: true, submissionKey: `reference-${suffix}` }),
  }));
  assert.equal(duplicateReference.id, reference.id, "Retry must not create a duplicate reference take");

  const takeMedia = await uploadMedia(projectId, sceneId, "take-b.png");
  const take = await json(await fetch(`${apiBase}/shots/${shotId}/takes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mediaId: takeMedia.id, notes: "Take B note", submissionKey: `take-b-${suffix}` }),
  }));
  assert.equal(take.takeNumber, 2);

  const circled = await json(await fetch(`${apiBase}/takes/${take.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "circle", isCircle: true }),
  }));
  assert.equal(circled.isCircle, true);

  const replacementMedia = await uploadMedia(projectId, sceneId, "reference-replacement.png");
  const replacement = await json(await fetch(`${apiBase}/shots/${shotId}/takes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mediaId: replacementMedia.id, isReference: true, submissionKey: `replacement-${suffix}` }),
  }));
  assert.equal(replacement.takeNumber, 3);

  const reloaded = await json(await fetch(`${apiBase}/shots/${shotId}`));
  assert.equal(reloaded.takes.length, 3);
  assert.equal(reloaded.takes.filter((item: any) => item.isReference).length, 1);
  assert.equal(reloaded.takes.find((item: any) => item.id === reference.id).referenceStatus, "superseded");
  assert.equal(reloaded.takes.find((item: any) => item.id === take.id).notes, "Take B note");

  const shotWithNotes = await json(await fetch(`${apiBase}/shots/${shotId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes: "Keep eyeline consistent" }),
  }));
  assert.equal(shotWithNotes.notes, "Keep eyeline consistent");

  const activities = await json(await fetch(`${apiBase}/activity?limit=50`));
  const actions = Object.values(activities).map((event: any) => event.action);
  assert.ok(actions.includes("reference_captured"));
  assert.ok(actions.includes("reference_replaced"));
  assert.ok(actions.includes("take_circled"));
  console.log("Phase 4 media workflow checks passed.");
} finally {
  await fetch(`${apiBase}/projects/${projectId}`, { method: "DELETE" }).catch(() => undefined);
}
