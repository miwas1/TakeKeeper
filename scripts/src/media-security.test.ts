import assert from "node:assert/strict";

const apiBase = process.env.TAKEKEEPER_API_URL ?? "http://127.0.0.1:8080/api";
const apiOrigin = new URL(apiBase).origin;
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

async function createReadUrl(storageKey: string) {
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  assert.ok(privateDir, "PRIVATE_OBJECT_DIR is required");
  const [, bucketName, ...rootParts] = privateDir.replace(/^\/?/, "/").split("/");
  const response = await fetch("http://127.0.0.1:1106/object-storage/signed-object-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: `${rootParts.join("/").replace(/\/$/, "")}/${storageKey}`,
      method: "GET",
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    }),
  });
  assert.ok(response.ok, `Read URL signing failed with ${response.status}`);
  return String((await response.json() as { signed_url: string }).signed_url);
}

async function json(response: Response) {
  const payload = await response.json();
  assert.ok(response.ok, `${response.status}: ${JSON.stringify(payload)}`);
  return payload as Record<string, unknown>;
}

const project = await json(await fetch(`${apiBase}/projects`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ title: `Media Security ${suffix}`, type: "short_film" }),
}));
const projectId = String(project.id);
const foreignProject = await json(await fetch(`${apiBase}/projects`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ title: `Foreign Media Project ${suffix}`, type: "short_film" }),
}));
const foreignProjectId = String(foreignProject.id);
const foreignScene = await json(await fetch(`${apiBase}/projects/${foreignProjectId}/scenes`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sceneNumber: "X1", slugline: "INT. TEST LAB — DAY", location: "Lab", intExt: "INT", timeOfDay: "DAY", storyDay: "1" }),
}));

try {
  const unissued = await fetch(`${apiBase}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, storageKey: `uploads/unissued-${suffix}.png`, mediaType: "image/png" }),
  });
  assert.equal(unissued.status, 403, "Unissued storage keys must not be registered");

  const crossProjectReservation = await fetch(`${apiBase}/storage/uploads/request-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, sceneId: foreignScene.id, fileName: "foreign.png", contentType: "image/png", size: png.byteLength }),
  });
  assert.equal(crossProjectReservation.status, 404, "A reservation must not target another project's scene");

  const target = await json(await fetch(`${apiBase}/storage/uploads/request-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, fileName: "fixture.png", contentType: "image/png", size: png.byteLength }),
  }));

  const upload = await fetch(String(target.uploadUrl), {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: png,
  });
  assert.ok(upload.ok, `Fixture upload failed with ${upload.status}`);

  const media = await json(await fetch(`${apiBase}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, storageKey: target.storageKey, mediaType: "image/png" }),
  }));

  const mediaResponse = await fetch(`${apiOrigin}${media.mediaUrl}`, { redirect: "manual" });
  assert.equal(mediaResponse.status, 302, "Registered media should resolve through a protected redirect");
  const signedReadUrl = mediaResponse.headers.get("location");
  assert.ok(signedReadUrl, "Protected media redirect must provide a signed URL");
  const beforeDelete = await fetch(signedReadUrl);
  assert.ok(beforeDelete.ok, "Uploaded object should exist before project deletion");

  const abandonedTarget = await json(await fetch(`${apiBase}/storage/uploads/request-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, fileName: "abandoned.png", contentType: "image/png", size: png.byteLength }),
  }));
  const abandonedUpload = await fetch(String(abandonedTarget.uploadUrl), {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: png,
  });
  assert.ok(abandonedUpload.ok, "Unregistered fixture upload should succeed");
  const abandonedReadUrl = await createReadUrl(String(abandonedTarget.storageKey));
  assert.ok((await fetch(abandonedReadUrl)).ok, "Unregistered object should exist before project deletion");

  const deletion = await fetch(`${apiBase}/projects/${projectId}`, { method: "DELETE" });
  assert.equal(deletion.status, 204, "Project deletion should succeed after object cleanup");

  const afterDelete = await fetch(signedReadUrl);
  assert.ok(!afterDelete.ok, "Previously signed URL must no longer return object bytes after deletion");
  const abandonedAfterDelete = await fetch(abandonedReadUrl);
  assert.ok(!abandonedAfterDelete.ok, "Project deletion must remove unregistered reservation object bytes");
  console.log("Media security integration checks passed.");
} finally {
  await fetch(`${apiBase}/projects/${projectId}`, { method: "DELETE" }).catch(() => undefined);
  await fetch(`${apiBase}/projects/${foreignProjectId}`, { method: "DELETE" }).catch(() => undefined);
}