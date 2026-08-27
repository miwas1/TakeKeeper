import type { z } from "zod";
import { GoogleGenAI, Type } from "@google/genai";
import {
  continuitySupervisorOutputSchema,
  dailyReportSchema,
  screenplayBreakdownSchema,
  sceneBreakdownSchema,
  visualStateResultSchema,
  type ContinuityIssueDraft,
  type VisualObservation,
} from "@workspace/takekeeper-domain";
import { env } from "../../config/env";
import type { ApprovedContinuityState } from "../continuity/approved-state";

export type AgentDefinition<TOutput> = {
  name: string;
  purpose: string;
  outputSchema: z.ZodType<TOutput>;
};

export const takeKeeperAgents = {
  scriptBreakdown: {
    name: "script-breakdown-agent",
    purpose: "Extract scene structure and continuity items from script text.",
    outputSchema: sceneBreakdownSchema,
  },
  visualState: {
    name: "visual-state-agent",
    purpose: "Describe visible state from approved media without mutating application data.",
    outputSchema: visualStateResultSchema,
  },
  continuitySupervisor: {
    name: "continuity-supervisor-agent",
    purpose: "Compare validated visual state against approved continuity state.",
    outputSchema: continuitySupervisorOutputSchema,
  },
  report: {
    name: "report-agent",
    purpose: "Compile validated production activity into a daily continuity report.",
    outputSchema: dailyReportSchema,
  },
} satisfies Record<string, AgentDefinition<unknown>>;

export const googleAiConfig = {
  provider: "google",
  runtime: "google-adk",
  deploymentTarget: "agent-engine",
  model: env.GEMINI_MODEL,
  cloudProject: env.GOOGLE_CLOUD_PROJECT,
  location: env.GOOGLE_CLOUD_LOCATION,
  agentEngineId: env.AGENT_ENGINE_ID,
} as const;

const continuityItemJsonSchema = {
  type: Type.OBJECT,
  properties: {
    category: { type: Type.STRING, description: "One of wardrobe, props, hair_makeup, blocking, set, action, other." },
    entity: { type: Type.STRING },
    expectedState: { type: Type.STRING },
    sourceType: { type: Type.STRING, enum: ["script"] },
    confidence: { type: Type.NUMBER, description: "0 to 1 confidence based only on explicit script evidence." },
    active: { type: Type.BOOLEAN },
    sourceEvidence: { type: Type.STRING, description: "Short exact or close screenplay evidence; never hidden reasoning." },
  },
  required: ["category", "entity", "expectedState", "sourceType", "confidence", "active", "sourceEvidence"],
} as const;

const screenplayResponseSchema = {
  type: Type.OBJECT,
  properties: {
    scenes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          segmentIndex: { type: Type.INTEGER, description: "The exact numeric segment index supplied in the prompt." },
          sceneNumber: { type: Type.STRING },
          slugline: { type: Type.STRING },
          location: { type: Type.STRING },
          intExt: { type: Type.STRING, enum: ["INT", "EXT", "INT/EXT", "UNKNOWN"] },
          timeOfDay: { type: Type.STRING },
          storyDay: { type: Type.STRING },
          characters: { type: Type.ARRAY, items: { type: Type.STRING } },
          continuityItems: { type: Type.ARRAY, maxItems: 20, items: continuityItemJsonSchema },
        },
        required: ["segmentIndex", "sceneNumber", "slugline", "location", "intExt", "timeOfDay", "storyDay", "characters", "continuityItems"],
      },
    },
  },
  required: ["scenes"],
} as const;

const breakdownPrompt = `You are TakeKeeper's Script Breakdown Agent. Extract only facts explicitly supported by the screenplay.
You will receive numbered screenplay scene segments. Return exactly one scene object for every supplied segment, in the same order, and copy its SEGMENT_INDEX exactly.
Use UNKNOWN for an unknown INT/EXT value, empty strings for other unknown scene metadata, and an empty array for unknown characters or continuity.
Continuity items must be production-observable expectations supported by the script, such as wardrobe, props, hair_makeup, blocking, set, action, or other. Do not infer facts, motivations, camera coverage, or visual details that are not stated.
Deduplicate repeated mentions of the same observable state within a scene and return at most 20 distinct continuity items per scene.
For each continuity item include a concise evidence quote or close excerpt and confidence from 0 to 1. Never include chain-of-thought.
Return JSON matching the supplied schema exactly.`;

const ai = env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: env.GEMINI_API_KEY }) : null;

export const googleAiAvailable = Boolean(ai);

type ScriptSegment = {
  index: number;
  scriptText: string;
};

const sceneHeadingPattern = /^(?:\s*\d+\s+)?(?:INT\.?|EXT\.?|INT\/EXT\.?|I\/E\.?|EST\.?)\s+.+$/gim;

function splitScreenplay(content: string): ScriptSegment[] {
  const matches = [...content.matchAll(sceneHeadingPattern)];
  if (matches.length === 0) return [{ index: 0, scriptText: content }];
  return matches.map((match, index) => {
    const start = index === 0 ? 0 : match.index!;
    const end = matches[index + 1]?.index ?? content.length;
    return { index, scriptText: content.slice(start, end).trim() };
  });
}

function batchSegments(segments: ScriptSegment[]) {
  const batches: ScriptSegment[][] = [];
  let current: ScriptSegment[] = [];
  let characters = 0;
  for (const segment of segments) {
    if (current.length > 0 && (current.length >= 6 || characters + segment.scriptText.length > 7_000)) {
      batches.push(current);
      current = [];
      characters = 0;
    }
    current.push(segment);
    characters += segment.scriptText.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function analyzeBatch(batch: ScriptSegment[]) {
  if (!ai) throw new Error("Gemini API key is not configured");
  const batchText = batch
    .map((segment) => `<<<SEGMENT_INDEX:${segment.index}>>>\n${segment.scriptText}`)
    .join("\n\n");
  const response = await ai.models.generateContent({
    model: env.GEMINI_MODEL,
    contents: [{ role: "user", parts: [{ text: `${breakdownPrompt}\n\nSCREENPLAY SEGMENTS:\n${batchText}` }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: screenplayResponseSchema,
      maxOutputTokens: 8192,
      temperature: 0.1,
    },
  });
  const text = response.text?.trim();
  if (!text) throw new Error("Gemini returned an empty breakdown");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini returned invalid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || !("scenes" in parsed) || !Array.isArray(parsed.scenes)) {
    throw new Error("Gemini returned an invalid screenplay breakdown");
  }
  const byIndex = new Map(batch.map((segment) => [segment.index, segment]));
  const scenes = parsed.scenes.map((scene) => {
    if (typeof scene !== "object" || scene === null || !("segmentIndex" in scene) || typeof scene.segmentIndex !== "number") {
      throw new Error("Gemini omitted a screenplay segment index");
    }
    const segment = byIndex.get(scene.segmentIndex);
    if (!segment) throw new Error("Gemini returned an unknown screenplay segment index");
    const { segmentIndex: _segmentIndex, ...values } = scene;
    return {
      ...values,
      scriptText: segment.scriptText,
      sceneNumber: "sceneNumber" in values && typeof values.sceneNumber === "string" && values.sceneNumber.trim()
        ? values.sceneNumber.trim()
        : String(segment.index + 1),
      ...("intExt" in values && values.intExt === "UNKNOWN" ? { intExt: "" } : {}),
    };
  });
  if (scenes.length !== batch.length || new Set(parsed.scenes.map((scene) =>
    typeof scene === "object" && scene !== null && "segmentIndex" in scene ? scene.segmentIndex : null
  )).size !== batch.length) {
    throw new Error("Gemini did not return every screenplay segment exactly once");
  }
  return scenes;
}

export async function analyzeScreenplay(content: string) {
  if (!ai) throw new Error("Gemini API key is not configured");
  const scenes: Array<Record<string, unknown> & { sceneNumber: string }> = [];
  const batches = batchSegments(splitScreenplay(content));
  for (let index = 0; index < batches.length; index += 3) {
    const results = await Promise.all(batches.slice(index, index + 3).map(analyzeBatch));
    for (const result of results) scenes.push(...result);
  }
  const sceneNumbers = scenes.map((scene) => scene.sceneNumber);
  const hasDuplicates = new Set(sceneNumbers).size !== sceneNumbers.length;
  return screenplayBreakdownSchema.parse({
    scenes: scenes.map((scene, index) => ({
      ...scene,
      sceneNumber: hasDuplicates ? String(index + 1) : scene.sceneNumber,
    })),
  });
}

const visualObservationJsonSchema = {
  type: Type.OBJECT,
  properties: {
    category: { type: Type.STRING, enum: ["wardrobe", "props", "hair_makeup", "blocking", "set", "action", "other"] },
    entity: { type: Type.STRING },
    observedState: { type: Type.STRING },
    visibility: { type: Type.STRING, enum: ["visible", "not_visible", "obscured", "absent", "uncertain"] },
    confidence: { type: Type.NUMBER, description: "0 to 1 confidence in the visible observation." },
    region: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        x: { type: Type.NUMBER },
        y: { type: Type.NUMBER },
        width: { type: Type.NUMBER },
        height: { type: Type.NUMBER },
      },
      required: ["x", "y", "width", "height"],
    },
  },
  required: ["category", "entity", "observedState", "visibility", "confidence", "region"],
} as const;

const visualStateResponseSchema = {
  type: Type.OBJECT,
  properties: {
    observations: { type: Type.ARRAY, items: visualObservationJsonSchema, maxItems: 40 },
    warnings: { type: Type.ARRAY, items: { type: Type.STRING }, maxItems: 10 },
  },
  required: ["observations", "warnings"],
} as const;

const visualStatePrompt = `You are TakeKeeper's Visual State Agent. Answer only: what is visible in this image?
Describe production-observable state for wardrobe, props, hair_makeup, blocking, set, action, or other. Do not compare against another image, screenplay, or continuity expectation. Do not infer anything outside the frame.
Inspect the known continuity entities first, but report only what the image supports. You may include another clearly visible production-relevant entity when it is useful, but do not invent one. Use a stable entity name when a person or prop is identifiable. State visibility explicitly: visible, not_visible, obscured, absent, or uncertain. A not_visible, obscured, absent, or uncertain entity is not evidence that it changed. Use a normalized relative position such as actor_right or actor_left when appropriate. Use null for region when a useful bounding region cannot be identified. Confidence must reflect only the certainty of this visual observation. Return JSON matching the supplied schema exactly and never include hidden reasoning.`;

function parseGeminiJson(text: string | undefined, emptyMessage: string): unknown {
  const trimmed = text?.trim();
  if (!trimmed) throw new Error(emptyMessage);
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error("Gemini returned invalid JSON");
  }
}

export type VisualStateInput = {
  takeId: string;
  mediaType: string;
  bytes: Uint8Array;
  project: { id: string; title: string; type: string };
  scene: { id: string; sceneNumber: string; slugline: string; location: string; timeOfDay: string; storyDay: string };
  shot: { id: string; label: string; description: string | null; notes: string | null };
  take: { id: string; takeNumber: number; isReference: boolean };
  knownEntities: Array<{
    category: string;
    entity: string;
    expectedState: string;
    sourceType: string;
    confidence: number | null;
  }>;
};

export async function analyzeVisualState(input: VisualStateInput): Promise<{ takeId: string; observations: VisualObservation[]; warnings: string[]; model: string }> {
  if (!ai) throw new Error("Gemini API key is not configured");
  const structuredContext = {
    project: input.project,
    scene: input.scene,
    shot: input.shot,
    take: input.take,
    knownContinuityEntities: input.knownEntities,
  };
  const response = await ai.models.generateContent({
    model: env.GEMINI_MODEL,
    contents: [{
      role: "user",
      parts: [
        { text: `${visualStatePrompt}\n\nSTRUCTURED TAKE CONTEXT:\n${JSON.stringify(structuredContext)}` },
        { inlineData: { mimeType: input.mediaType, data: Buffer.from(input.bytes).toString("base64") } },
      ],
    }],
    config: {
      responseMimeType: "application/json",
      responseSchema: visualStateResponseSchema,
      maxOutputTokens: 8192,
      temperature: 0.1,
    },
  });
  const parsed = parseGeminiJson(response.text, "Gemini returned an empty visual state");
  const result = visualStateResultSchema.parse({
    takeId: input.takeId,
    observations: typeof parsed === "object" && parsed !== null && "observations" in parsed ? parsed.observations : [],
    warnings: typeof parsed === "object" && parsed !== null && "warnings" in parsed ? parsed.warnings : [],
    model: env.GEMINI_MODEL,
  });
  return result;
}

export type ContinuitySupervisorInput = {
  project: {
    id: string;
    title: string;
    type: string;
  };
  scene: {
    id: string;
    sceneNumber: string;
    slugline: string;
    location: string;
    timeOfDay: string;
    storyDay: string;
  };
  shot: {
    id: string;
    label: string;
    description: string | null;
    notes: string | null;
  };
  take: {
    id: string;
    takeNumber: number;
  };
  approvedState: ApprovedContinuityState;
  currentObservations: VisualObservation[];
};

const continuityIssueJsonSchema = {
  type: Type.OBJECT,
  properties: {
    category: { type: Type.STRING, enum: ["wardrobe", "props", "hair_makeup", "blocking", "set", "action", "other"] },
    entity: { type: Type.STRING },
    expectedState: { type: Type.STRING },
    observedState: { type: Type.STRING },
    severity: { type: Type.STRING, enum: ["low", "medium", "high"] },
    confidence: { type: Type.NUMBER, description: "0 to 1 confidence that this is a meaningful continuity mismatch." },
    explanation: { type: Type.STRING },
    suggestedFix: { type: Type.STRING, nullable: true },
  },
  required: ["category", "entity", "expectedState", "observedState", "severity", "confidence", "explanation", "suggestedFix"],
} as const;

const continuitySupervisorResponseSchema = {
  type: Type.OBJECT,
  properties: {
    issues: { type: Type.ARRAY, items: continuityIssueJsonSchema, maxItems: 40 },
  },
  required: ["issues"],
} as const;

const continuitySupervisorPrompt = `You are TakeKeeper's Continuity Supervisor Agent. Decide whether the current take conflicts with the approved continuity state.
The input is structured data produced by application services. The approved state is authoritative: do not rewrite it, silently apply a new state, or treat model preference as an override.
Compare only an approved item with a matching current observation. Do not create an issue when the current entity is not_visible, obscured, absent, or uncertain. Do not create an issue for missing visibility. Treat normalized equivalents such as unzipped/open, zipped/closed, face-down/face down, actor_right/right_of_actor/Maya's right, and next_to/beside as equal where the category and entity make that reliable.
Return one issue per logical mismatch, never multiple phrasings of the same mismatch. Do not report extra observed entities unless an approved state explicitly requires their absence. Confidence must reflect both the underlying observation confidence and the confidence that the difference matters. Use low, medium, or high severity; reserve high for clear, prominent, or explicitly required contradictions. Return JSON matching the supplied schema exactly. Never include hidden reasoning.`;

export async function runContinuitySupervisor(input: ContinuitySupervisorInput): Promise<{ issues: ContinuityIssueDraft[]; model: string }> {
  if (!ai) throw new Error("Gemini API key is not configured");
  const structuredContext = {
    project: input.project,
    scene: input.scene,
    shot: input.shot,
    currentTake: input.take,
    approvedContinuityState: input.approvedState.items.map(({ id, category, entity, expectedState, sourceType, confidence, appliedChangeId }) => ({
      id,
      category,
      entity,
      expectedState,
      sourceType,
      confidence,
      appliedChangeId: appliedChangeId ?? null,
    })),
    approvedReferenceObservations: input.approvedState.referenceObservations,
    currentTakeObservations: input.currentObservations,
    scriptRequirements: input.approvedState.scriptRequirements,
    previousApprovedChanges: input.approvedState.previousApprovedChanges.map(({ id, continuityItemId, previousState, newState, effectiveScope, effectiveFromTakeId, sourceTakeId }) => ({
      id,
      continuityItemId,
      previousState,
      newState,
      effectiveScope,
      effectiveFromTakeId,
      sourceTakeId,
    })),
  };
  const response = await ai.models.generateContent({
    model: env.GEMINI_MODEL,
    contents: [{ role: "user", parts: [{ text: `${continuitySupervisorPrompt}\n\nSTRUCTURED COMPARISON CONTEXT:\n${JSON.stringify(structuredContext)}` }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: continuitySupervisorResponseSchema,
      maxOutputTokens: 8192,
      temperature: 0.1,
    },
  });
  const parsed = parseGeminiJson(response.text, "Gemini returned an empty continuity decision");
  const validated = continuitySupervisorOutputSchema.parse({
    issues: typeof parsed === "object" && parsed !== null && "issues" in parsed ? parsed.issues : [],
  });
  return { issues: validated.issues, model: env.GEMINI_MODEL };
}
