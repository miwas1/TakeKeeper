import type {
  ContinuityIssueDraft,
  VisualObservation,
} from "@workspace/takekeeper-domain";

export type ApprovedContinuityItem = {
  id: string | null;
  category: string;
  entity: string;
  expectedState: string;
  sourceType: string;
  confidence: number | null;
  active: boolean;
  sourceEvidence?: string | null;
  appliedChangeId?: string | null;
};

export type ComparisonCandidate = {
  item: ApprovedContinuityItem;
  observation: VisualObservation;
  entityScore: number;
};

const categoryAliases: Record<string, string> = {
  wardrobe: "wardrobe",
  clothing: "wardrobe",
  costume: "wardrobe",
  costumes: "wardrobe",
  prop: "props",
  props: "props",
  object: "props",
  objects: "props",
  "hair & makeup": "hair_makeup",
  "hair and makeup": "hair_makeup",
  "hair/makeup": "hair_makeup",
  "hair makeup": "hair_makeup",
  hair_makeup: "hair_makeup",
  hair: "hair_makeup",
  makeup: "hair_makeup",
  blocking: "blocking",
  movement: "blocking",
  set: "set",
  setting: "set",
  action: "action",
  other: "other",
};

const stateAliases: Array<[string, string[]]> = [
  ["open", ["open", "unzipped", "unzip", "unbuttoned", "unfastened", "zipper down"]],
  ["closed", ["closed", "zipped", "zippered", "fastened", "buttoned", "zipper up"]],
  ["face_down", ["face down", "face-down", "screen down", "screen-down"]],
  ["face_up", ["face up", "face-up", "screen up", "screen-up"]],
  ["actor_right", ["actor right", "actor_right", "right of actor", "right_of_actor", "maya's right", "mayas right", "performer's right", "performers right"]],
  ["actor_left", ["actor left", "actor_left", "left of actor", "left_of_actor", "maya's left", "mayas left", "performer's left", "performers left"]],
  ["next_to", ["next to", "beside", "by"]],
  ["behind", ["behind", "back of"]],
  ["in_front", ["in front", "in front of", "front of"]],
];

function cleanText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[_/]+/g, " ")
    .replace(/[^a-z0-9'\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function withoutPossessive(value: string): string {
  return value.replace(/\b([a-z0-9]+)'s\b/g, "$1").replace(/\b([a-z0-9]+)s'\b/g, "$1");
}

export function normalizeCategory(value: string): string {
  const cleaned = cleanText(value).replace(/\s+/g, " ");
  return categoryAliases[cleaned] ?? cleaned.replace(/\s+/g, "_");
}

export function normalizeEntity(value: string): string {
  const cleaned = withoutPossessive(cleanText(value))
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\b(visible|shown|present)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned;
}

export function normalizePosition(value: string): string {
  const cleaned = withoutPossessive(cleanText(value));
  if (
    /\b(actor|performer|subject|maya)\s+(right|stage right)\b/.test(cleaned) ||
    /\b(right|stage right)\s+(of|side of)\s+(the )?(actor|performer|subject|maya)\b/.test(cleaned) ||
    /\bright_of_actor\b/.test(cleaned)
  ) {
    return "actor_right";
  }
  if (
    /\b(actor|performer|subject|maya)\s+(left|stage left)\b/.test(cleaned) ||
    /\b(left|stage left)\s+(of|side of)\s+(the )?(actor|performer|subject|maya)\b/.test(cleaned) ||
    /\bleft_of_actor\b/.test(cleaned)
  ) {
    return "actor_left";
  }
  return cleaned;
}

export function normalizeState(category: string, entity: string, value: string): string {
  const normalizedCategory = normalizeCategory(category);
  const normalizedEntity = normalizeEntity(entity);
  const cleaned = normalizePosition(value)
    .replace(/\b(on|the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const [canonical, aliases] of stateAliases) {
    const matchedAlias = aliases.find((alias) => {
      const normalizedAlias = normalizePosition(alias);
      const aliasPattern = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      return new RegExp(`(?:^|\\s)${aliasPattern}(?:$|\\s)`).test(cleaned);
    });
    if (matchedAlias) {
      const normalizedAlias = normalizePosition(matchedAlias);
      const negated = new RegExp(`(?:^|\\s)(?:not|without|no)\\s+${normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}(?:$|\\s)`).test(cleaned);
      const effectiveCanonical = negated && (canonical === "open" || canonical === "closed")
        ? canonical === "open" ? "closed" : "open"
        : canonical;
      if (effectiveCanonical === "open" || effectiveCanonical === "closed") {
        if (normalizedCategory === "wardrobe" || /jacket|shirt|coat|zip|dress|hoodie/.test(normalizedEntity)) return effectiveCanonical;
      } else {
        return effectiveCanonical;
      }
    }
  }

  return cleaned;
}

export function inferObservationVisibility(observation: Pick<VisualObservation, "observedState" | "visibility">): VisualObservation["visibility"] {
  if (observation.visibility !== "visible") return observation.visibility;
  const state = cleanText(observation.observedState);
  if (/not visible|out of frame|outside frame|not in frame|cannot see|can't see/.test(state)) return "not_visible";
  if (/obscured|occluded|blocked|covered/.test(state)) return "obscured";
  if (/uncertain|unclear|cannot determine|can't determine|ambiguous/.test(state)) return "uncertain";
  if (/\babsent\b|not present/.test(state)) return "absent";
  return "visible";
}

export function areStatesEquivalent(category: string, entity: string, expected: string, observed: string): boolean {
  const normalizedExpected = normalizeState(category, entity, expected);
  const normalizedObserved = normalizeState(category, entity, observed);
  if (normalizedExpected === normalizedObserved) return true;
  if (!normalizedExpected || !normalizedObserved) return false;

  const expectedWords = new Set(normalizedExpected.split(" "));
  const observedWords = new Set(normalizedObserved.split(" "));
  if (expectedWords.size === observedWords.size && [...expectedWords].every((word) => observedWords.has(word))) return true;
  return false;
}

function entityTokens(value: string): Set<string> {
  return new Set(normalizeEntity(value).split(" ").filter((token) => token.length > 1));
}

export function entitySimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeEntity(left);
  const normalizedRight = normalizeEntity(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) return 0.9;
  const leftTokens = entityTokens(left);
  const rightTokens = entityTokens(right);
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  if (intersection === 0) return 0;
  return intersection / Math.min(leftTokens.size, rightTokens.size);
}

export function isComparableObservation(observation: VisualObservation): boolean {
  return inferObservationVisibility(observation) === "visible";
}

export function findMatchingObservation(
  item: Pick<ApprovedContinuityItem, "category" | "entity">,
  observations: VisualObservation[],
  usedObservationIndexes = new Set<number>(),
  includeNonComparable = false,
): { observation: VisualObservation; entityScore: number; index: number } | null {
  let best: { observation: VisualObservation; entityScore: number; index: number } | null = null;
  observations.forEach((observation, index) => {
    if (usedObservationIndexes.has(index) || (!includeNonComparable && !isComparableObservation(observation))) return;
    if (normalizeCategory(observation.category) !== normalizeCategory(item.category)) return;
    const score = entitySimilarity(item.entity, observation.entity);
    if (score < 0.66 || (best && best.entityScore >= score)) return;
    best = { observation, entityScore: score, index };
  });
  return best;
}

export function buildComparisonCandidates(
  approvedItems: ApprovedContinuityItem[],
  observations: VisualObservation[],
): ComparisonCandidate[] {
  const usedObservationIndexes = new Set<number>();
  const candidates: ComparisonCandidate[] = [];
  for (const item of approvedItems) {
    if (!item.active) continue;
    const match = findMatchingObservation(item, observations, usedObservationIndexes);
    if (!match) continue;
    usedObservationIndexes.add(match.index);
    if (areStatesEquivalent(item.category, item.entity, item.expectedState, match.observation.observedState)) continue;
    candidates.push({ item, observation: match.observation, entityScore: match.entityScore });
  }
  return candidates;
}

export function makeIssueKey(input: { category: string; entity: string; expectedState: string; observedState: string }): string {
  return [
    normalizeCategory(input.category),
    normalizeEntity(input.entity),
    normalizeState(input.category, input.entity, input.expectedState),
    normalizeState(input.category, input.entity, input.observedState),
  ].join("|");
}

export function findMatchingCandidate(
  issue: Pick<ContinuityIssueDraft, "category" | "entity" | "expectedState" | "observedState">,
  candidates: ComparisonCandidate[],
): ComparisonCandidate | null {
  let best: ComparisonCandidate | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    if (normalizeCategory(candidate.item.category) !== normalizeCategory(issue.category)) continue;
    const score = entitySimilarity(candidate.item.entity, issue.entity);
    if (score < 0.66) continue;
    const expectedMatches = areStatesEquivalent(candidate.item.category, candidate.item.entity, candidate.item.expectedState, issue.expectedState);
    const observedMatches = areStatesEquivalent(candidate.item.category, candidate.item.entity, candidate.observation.observedState, issue.observedState);
    if (!expectedMatches && !observedMatches) continue;
    const total = score + (expectedMatches ? 0.5 : 0) + (observedMatches ? 0.5 : 0);
    if (total > bestScore) {
      best = candidate;
      bestScore = total;
    }
  }
  return best;
}

export function confidenceBand(confidence: number): "normal" | "likely_mismatch" | "worth_checking" {
  if (confidence >= 0.85) return "normal";
  if (confidence >= 0.6) return "likely_mismatch";
  return "worth_checking";
}

export function calibrateSeverity(
  requested: ContinuityIssueDraft["severity"],
  confidence: number,
  candidate: ComparisonCandidate,
): ContinuityIssueDraft["severity"] {
  if (confidence < 0.6) return "low";
  const sourceIsExplicit = ["script", "manual", "approved_change"].includes(candidate.item.sourceType);
  const regionArea = candidate.observation.region
    ? candidate.observation.region.width * candidate.observation.region.height
    : 0;
  const visuallyProminent = regionArea >= 0.18 || ["wardrobe", "action"].includes(normalizeCategory(candidate.item.category));
  if (requested === "high" && confidence >= 0.85 && (sourceIsExplicit || visuallyProminent)) return "high";
  if (requested === "high") return "medium";
  return requested;
}
