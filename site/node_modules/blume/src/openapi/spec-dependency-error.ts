/**
 * Reading a spec needs an optional package the project hasn't installed (the
 * AsyncAPI converter, for a pre-3.0 document). Carries its own suggestion —
 * the install command — because neither of the other spec failures fits: the
 * file is fine and so is the network.
 */
export class SpecDependencyError extends Error {
  readonly suggestion: string;

  constructor(message: string, suggestion: string) {
    super(message);
    this.name = "SpecDependencyError";
    this.suggestion = suggestion;
  }
}
