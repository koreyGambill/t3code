import type {
  DevelopmentEnvironmentCheckoutChoice,
  XwingEnvironmentSummary,
  XwingRepositorySummary,
} from "@t3tools/contracts";

/** `#1100 loads-panel-testing`, or the name alone for environments without a number. */
export function xwingEnvironmentLabel(environment: {
  readonly number?: number | undefined;
  readonly name: string;
}): string {
  return environment.number === undefined
    ? environment.name
    : `#${environment.number} ${environment.name}`;
}

function matchesQuery(
  environment: XwingEnvironmentSummary,
  repositories: ReadonlyArray<XwingRepositorySummary>,
  terms: ReadonlyArray<string>,
): boolean {
  const haystack = [
    environment.number === undefined ? "" : `#${environment.number}`,
    environment.name,
    environment.ticket ?? "",
    environment.status,
    ...repositories.flatMap((repository) => [repository.name, repository.branch]),
  ]
    .join("\n")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

const queryTerms = (query: string) => query.trim().toLowerCase().split(/\s+/).filter(Boolean);

/**
 * Every term must match the number, name, ticket, status, or a repository's
 * name or branch. Active environments come before archived ones.
 */
export function filterXwingEnvironments(
  environments: ReadonlyArray<XwingEnvironmentSummary>,
  query: string,
): ReadonlyArray<XwingEnvironmentSummary> {
  const terms = queryTerms(query);
  const matches = environments.filter((environment) =>
    matchesQuery(environment, environment.repositories, terms),
  );
  return [
    ...matches.filter((environment) => environment.status === "active"),
    ...matches.filter((environment) => environment.status === "archived"),
  ];
}

/** Every term must match the environment's number, name, ticket, repository or branch. */
export function filterXwingCheckoutChoices(
  choices: ReadonlyArray<DevelopmentEnvironmentCheckoutChoice>,
  query: string,
): ReadonlyArray<DevelopmentEnvironmentCheckoutChoice> {
  const terms = queryTerms(query);
  return choices.filter((choice) => {
    const haystack = [
      choice.number === undefined ? "" : `#${choice.number}`,
      choice.name,
      choice.ticket ?? "",
      choice.repositoryName,
      choice.branch,
    ]
      .join("\n")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
