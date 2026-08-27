import assert from "node:assert/strict";

const apiBase = process.env.TAKEKEEPER_API_URL ?? "http://127.0.0.1:8080/api";
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function json(response: Response) {
  const payload = await response.json();
  assert.ok(response.ok, `${response.status}: ${JSON.stringify(payload)}`);
  return payload as Record<string, any>;
}

async function waitForFailed(takeId: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await json(await fetch(`${apiBase}/takes/${takeId}/continuity-check`));
    if (result.status === "failed") return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Continuity check did not reach failed state");
}

const project = await json(await fetch(`${apiBase}/projects`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ title: `Phase 6 Failure ${suffix}`, type: "short_film" }),
}));
const projectId = String(project.id);

try {
  const scene = await json(await fetch(`${apiBase}/projects/${projectId}/scenes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sceneNumber: "1", slugline: "INT. TEST KITCHEN — NIGHT", location: "Kitchen", intExt: "INT", timeOfDay: "NIGHT", storyDay: "1" }),
  }));
  const shot = await json(await fetch(`${apiBase}/scenes/${scene.id}/shots`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: "1A", description: "Failure-state smoke test" }),
  }));
  const reference = await json(await fetch(`${apiBase}/shots/${shot.id}/takes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isReference: true, submissionKey: `reference-${suffix}` }),
  }));
  const take = await json(await fetch(`${apiBase}/shots/${shot.id}/takes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ submissionKey: `take-${suffix}` }),
  }));

  const started = await json(await fetch(`${apiBase}/takes/${take.id}/continuity-check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }));
  assert.ok(["pending", "analyzing"].includes(started.status));
  const failed = await waitForFailed(take.id);
  assert.equal(failed.takeId, take.id);
  assert.match(failed.errorMessage, /attached image/i);

  const retried = await json(await fetch(`${apiBase}/takes/${take.id}/continuity-check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ retry: true }),
  }));
  assert.notEqual(retried.checkId, started.checkId, "retry must create a new analysis run");
  await waitForFailed(take.id);

  const shotAfterFailure = await json(await fetch(`${apiBase}/shots/${shot.id}`));
  assert.equal(shotAfterFailure.takes.length, 2, "failed analysis must not remove the saved takes");
  assert.ok(shotAfterFailure.takes.some((item: any) => item.id === reference.id));
  assert.ok(shotAfterFailure.takes.some((item: any) => item.id === take.id));

  const activity = await json(await fetch(`${apiBase}/activity?limit=100`));
  const actions = Object.values(activity).map((event: any) => event.action);
  assert.ok(actions.includes("continuity_check"));
  console.log("Phase 6 failure/retry workflow checks passed");
} finally {
  await fetch(`${apiBase}/projects/${projectId}`, { method: "DELETE" }).catch(() => undefined);
}
