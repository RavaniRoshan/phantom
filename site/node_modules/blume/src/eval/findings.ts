import type { BlumeProject } from "../core/project-graph.ts";
import type { Diagnostic } from "../core/types.ts";
import { locateQuestion } from "./schema.ts";
import type { EvalQuestion } from "./schema.ts";

const DOCS_URL = "https://useblume.dev/docs/cli/evals";

/** Where a finding should anchor when no route hint matches a page. */
export interface EvalsAnchor {
  path: string;
  raw: string;
}

/** The manifest route a hint names, if any. */
const hintedRoute = (question: EvalQuestion, project: BlumeProject) => {
  for (const hint of question.routes) {
    const route = project.manifest.routes.find(
      (candidate) => candidate.path === hint
    );
    if (route) {
      return route;
    }
  }
};

/**
 * Warnings for route hints that name no manifest route — docs move, and a
 * finding that silently anchors to the evals file instead of the page it
 * used to name is a debugging session; a warning is a one-line fix.
 */
export const routeFindings = (
  question: EvalQuestion,
  project: BlumeProject,
  anchor: EvalsAnchor
): Diagnostic[] => {
  const known = new Set(project.manifest.routes.map((route) => route.path));
  return question.routes
    .filter((hint) => !known.has(hint))
    .map((hint) => ({
      code: "BLUME_EVAL_ROUTE_UNKNOWN",
      docsUrl: DOCS_URL,
      file: anchor.path,
      line: locateQuestion(anchor.raw, question.id),
      message: `Question "${question.id}" hints at route "${hint}", which matches no page.`,
      severity: "warning" as const,
      suggestion:
        "Update the question's `routes` to the page's current route, or remove the hint.",
    }));
};

/** What the finding needs to know about how the question went. */
export interface QuestionOutcome {
  /** Why the run errored, when it did. */
  detail?: string;
  /** The expected facts the judge found absent or contradicted. */
  missing: string[];
  status: "error" | "fail";
}

/**
 * The diagnostic for a failed or errored question. A failure is anchored to
 * the page that should have answered it (via the first matching route hint)
 * or, failing that, to the question's line in the evals file. An errored run —
 * the agent crashed, timed out, or answered in a shape Blume couldn't read —
 * says nothing about the docs, so it always points at the question instead of
 * a page there's nothing to fix in.
 */
export const questionFinding = (
  question: EvalQuestion,
  outcome: QuestionOutcome,
  project: BlumeProject,
  anchor: EvalsAnchor
): Diagnostic => {
  const questionSite = {
    file: anchor.path,
    line: locateQuestion(anchor.raw, question.id),
  };

  if (outcome.status === "error") {
    return {
      code: "BLUME_EVAL_QUESTION_ERROR",
      docsUrl: DOCS_URL,
      message: `The agent run failed for "${question.question}"${
        outcome.detail ? ` — ${outcome.detail}` : ""
      }, so the docs weren't graded.`,
      severity: question.severity,
      suggestion:
        "Rerun `blume eval`; if it persists, check the agent CLI installation and the failure detail.",
      ...questionSite,
    };
  }

  const route = hintedRoute(question, project);
  const site = route
    ? { file: route.sourcePath, url: route.path }
    : questionSite;

  const missing =
    outcome.missing.length > 0
      ? ` — missing: ${outcome.missing.join("; ")}`
      : "";
  return {
    code: "BLUME_EVAL_QUESTION_FAILED",
    docsUrl: DOCS_URL,
    message: `Docs could not answer: "${question.question}"${missing}`,
    severity: question.severity,
    suggestion:
      "State the missing facts on this page, then rerun `blume eval`.",
    ...site,
  };
};
