import type { DailyReportFacts } from "@workspace/takekeeper-domain";
import { plannedToolInputs, type ApplicationTool } from "./index";
import { recordAgentEvent } from "../services/analytics";

type ReportToolDependencies = {
  projectId: string;
  facts: DailyReportFacts;
};

type ReportToolRuntime = {
  get_shoot_day_takes: ApplicationTool<{ projectId: string; shootDate: string }, unknown>;
  get_shoot_day_changes: ApplicationTool<{ projectId: string; shootDate: string }, unknown>;
  get_unresolved_issues: ApplicationTool<{ projectId: string; shootDate: string }, unknown>;
  get_circle_takes: ApplicationTool<{ projectId: string; shootDate: string }, unknown>;
  get_scene_activity: ApplicationTool<{ projectId: string; shootDate: string }, unknown>;
  generate_report: ApplicationTool<{ projectId: string; shootDate: string }, unknown>;
};

function errorType(error: unknown) {
  return error instanceof Error ? error.name : "UnknownError";
}

function makeTool<TInput, TOutput>(
  dependencies: ReportToolDependencies,
  name: string,
  input: ApplicationTool<TInput, TOutput>["input"],
  handler: (value: TInput) => Promise<TOutput>,
): ApplicationTool<TInput, TOutput> {
  return {
    name,
    description: `Validated application tool: ${name}.`,
    input,
    execute: async (rawInput) => {
      const startedAt = Date.now();
      await recordAgentEvent({
        projectId: dependencies.projectId,
        agent: "report-agent",
        action: `${name}:started`,
        toolName: name,
        status: "started",
        metadata: { validationRequired: true },
      });
      try {
        const parsed = input.parse(rawInput);
        const result = await handler(parsed);
        await recordAgentEvent({
          projectId: dependencies.projectId,
          agent: "report-agent",
          action: `${name}:completed`,
          toolName: name,
          status: "completed",
          latencyMs: Date.now() - startedAt,
        });
        return result;
      } catch (error) {
        await recordAgentEvent({
          projectId: dependencies.projectId,
          agent: "report-agent",
          action: `${name}:failed`,
          toolName: name,
          status: "failed",
          latencyMs: Date.now() - startedAt,
          metadata: { errorType: errorType(error) },
        });
        throw error;
      }
    },
  };
}

export function createReportToolRuntime(dependencies: ReportToolDependencies): ReportToolRuntime {
  return {
    get_shoot_day_takes: makeTool(dependencies, "get_shoot_day_takes", plannedToolInputs.get_shoot_day_takes, async () => ({
      scenesWorked: dependencies.facts.scenesWorked,
      shots: dependencies.facts.shots,
      takeCount: dependencies.facts.takeCount,
    })),
    get_shoot_day_changes: makeTool(dependencies, "get_shoot_day_changes", plannedToolInputs.get_shoot_day_changes, async () => dependencies.facts.intentionalChanges),
    get_unresolved_issues: makeTool(dependencies, "get_unresolved_issues", plannedToolInputs.get_unresolved_issues, async () => dependencies.facts.unresolvedIssues),
    get_circle_takes: makeTool(dependencies, "get_circle_takes", plannedToolInputs.get_circle_takes, async () => dependencies.facts.circleTakeDetails),
    get_scene_activity: makeTool(dependencies, "get_scene_activity", plannedToolInputs.get_scene_activity, async () => dependencies.facts.sceneSummaries),
    generate_report: makeTool(dependencies, "generate_report", plannedToolInputs.generate_report, async () => dependencies.facts),
  };
}

export async function collectReportToolContext(runtime: ReportToolRuntime, facts: DailyReportFacts) {
  const [takes, changes, unresolvedIssues, circleTakes, scenes] = await Promise.all([
    runtime.get_shoot_day_takes.execute({ ...inputFor(facts) }),
    runtime.get_shoot_day_changes.execute({ ...inputFor(facts) }),
    runtime.get_unresolved_issues.execute({ ...inputFor(facts) }),
    runtime.get_circle_takes.execute({ ...inputFor(facts) }),
    runtime.get_scene_activity.execute({ ...inputFor(facts) }),
  ]);
  await runtime.generate_report.execute(inputFor(facts));
  return { takes, changes, unresolvedIssues, circleTakes, scenes };
}

function inputFor(facts: DailyReportFacts) {
  return { projectId: facts.projectId, shootDate: facts.shootDate };
}
