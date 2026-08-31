import { type Api, getSupportedThinkingLevels, type Model, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem, AutocompleteProvider, EditorComponent } from "@earendil-works/pi-tui";

const COMMAND_NAME = "herdr-subagent";
const SKILL_COMMAND_NAME = "skill:herdr-subagent";
const SKILL_INVOCATION = `/${SKILL_COMMAND_NAME}`;

type ModelCandidate = {
  baseReference: string;
  efforts: ModelThinkingLevel[];
  model: Model<Api>;
  reference: string;
};

type ParsedInvocation = { childModel?: string; task: string } | { error: string };

function collectModelCandidates(ctx: ExtensionContext): ModelCandidate[] {
  const entries =
    ctx.scopedModels.length > 0
      ? ctx.scopedModels
      : ctx.modelRegistry.getAvailable().map((model) => ({ model, thinkingLevel: undefined }));
  const seen = new Set<string>();
  const candidates: ModelCandidate[] = [];

  for (const { model, thinkingLevel } of entries) {
    const baseReference = `${model.provider}/${model.id}`;
    const reference = thinkingLevel ? `${baseReference}:${thinkingLevel}` : baseReference;
    if (seen.has(reference)) continue;
    seen.add(reference);

    candidates.push({
      baseReference,
      efforts: thinkingLevel || !model.reasoning ? [] : getSupportedThinkingLevels(model),
      model,
      reference,
    });
  }

  return candidates.sort((left, right) => left.reference.localeCompare(right.reference));
}

function describeModel(candidate: ModelCandidate): string {
  const details: string[] = [];
  if (candidate.model.name !== candidate.model.id) details.push(candidate.model.name);
  if (candidate.reference !== candidate.baseReference) {
    details.push(`Scoped effort: ${candidate.reference.slice(candidate.baseReference.length + 1)}`);
  } else if (candidate.efforts.length > 0) {
    details.push("Optional effort available");
  }
  return details.join(" · ") || "Child model";
}

function modelCompletions(
  candidates: ModelCandidate[],
  query: string,
  includeDefault: boolean,
): AutocompleteItem[] | null {
  const normalizedQuery = query.toLowerCase();
  const items: AutocompleteItem[] = includeDefault
    ? [
        {
          value: "",
          label: "Use Pi default",
          description: "Start typing the task without selecting a model",
        },
      ]
    : [];
  items.push(
    ...candidates
      .filter((candidate) => {
        const searchable = `${candidate.reference} ${candidate.model.name}`.toLowerCase();
        return searchable.includes(normalizedQuery);
      })
      .map((candidate) => ({
        value: `#${candidate.reference} `,
        label: candidate.reference,
        description: describeModel(candidate),
      })),
  );
  return items.length > 0 ? items : null;
}

function effortCompletions(candidate: ModelCandidate, query: string): AutocompleteItem[] | null {
  const normalizedQuery = query.replace(/^:/u, "").toLowerCase();
  const items: AutocompleteItem[] = normalizedQuery
    ? []
    : [
        {
          value: `#${candidate.baseReference} `,
          label: "Use model default",
          description: "Start typing the task without selecting an effort",
        },
      ];
  items.push(
    ...candidate.efforts
      .filter((effort) => effort.startsWith(normalizedQuery))
      .map((effort) => ({
        value: `#${candidate.baseReference}:${effort} `,
        label: effort,
        description: `Use ${effort} effort for every Pi subagent`,
      })),
  );
  return items.length > 0 ? items : null;
}

function getArgumentCompletions(prefix: string, candidates: ModelCandidate[]): AutocompleteItem[] | null {
  const argument = prefix.trimStart();
  if (!argument) return modelCompletions(candidates, "", true);
  if (!argument.startsWith("#")) return null;

  const firstWhitespace = argument.search(/\s/u);
  const token = argument.slice(1, firstWhitespace === -1 ? undefined : firstWhitespace);
  const remainder = firstWhitespace === -1 ? undefined : argument.slice(firstWhitespace + 1);
  const exactCandidate = candidates.find((candidate) => candidate.reference === token);

  if (exactCandidate) {
    if (exactCandidate.efforts.length === 0) return null;
    if (remainder === undefined) return effortCompletions(exactCandidate, "");
    const effortQuery = remainder.trimStart();
    if (/\s/u.test(effortQuery)) return null;
    return effortCompletions(exactCandidate, effortQuery);
  }

  if (firstWhitespace !== -1) return null;

  const effortCandidate = [...candidates]
    .sort((left, right) => right.baseReference.length - left.baseReference.length)
    .find((candidate) => candidate.efforts.length > 0 && token.startsWith(`${candidate.baseReference}:`));
  if (effortCandidate) {
    return effortCompletions(effortCandidate, token.slice(effortCandidate.baseReference.length + 1));
  }

  return modelCompletions(candidates, token, false);
}

function getCommandArgument(text: string): string | undefined {
  const commandPrefix = `/${COMMAND_NAME} `;
  return text.startsWith(commandPrefix) ? text.slice(commandPrefix.length) : undefined;
}

function hasNextCompletionPhase(text: string, candidates: ModelCandidate[]): boolean {
  const commandPrefix = `/${COMMAND_NAME} `;
  if (text === commandPrefix) return true;
  if (!text.startsWith(commandPrefix)) return false;

  const argument = text.slice(commandPrefix.length);
  if (!argument.endsWith(" ")) return false;
  const selectedModel = argument.trim();
  const candidate = candidates.find((entry) => selectedModel === `#${entry.reference}`);
  return (candidate?.efforts.length ?? 0) > 0;
}

function createChainedAutocompleteProvider(
  current: AutocompleteProvider,
  getCandidates: () => ModelCandidate[],
): AutocompleteProvider {
  return {
    triggerCharacters: [...new Set([...(current.triggerCharacters ?? []), "#"])],
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const textBeforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
      const argument = getCommandArgument(textBeforeCursor);
      if (argument !== undefined) {
        // Forced Tab completion skips slash arguments in Pi's combined provider,
        // so return Herdr's model phases before delegating to file completion.
        const items = getArgumentCompletions(argument, getCandidates());
        if (items) return { items, prefix: argument };
      }
      return current.getSuggestions(lines, cursorLine, cursorCol, options);
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    },
    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      const textBeforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
      // Pi trims the trailing command space before its file-completion gate, which
      // otherwise blocks the replayed Tab before argument completions can run.
      if (hasNextCompletionPhase(textBeforeCursor, getCandidates())) return true;
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  };
}

function shouldChainCompletion(before: string, after: string, candidates: ModelCandidate[]): boolean {
  return before !== after && hasNextCompletionPhase(after, candidates);
}

function wrapEditorForChainedCompletion(
  baseEditor: EditorComponent,
  isTab: (data: string) => boolean,
  getCandidates: () => ModelCandidate[],
): EditorComponent {
  return new Proxy(baseEditor, {
    get(target, property) {
      if (property === "handleInput") {
        return (data: string) => {
          if (!isTab(data)) {
            target.handleInput(data);
            return;
          }

          const before = target.getText();
          target.handleInput(data);
          const after = target.getText();
          // Pi closes autocomplete after applying a Tab completion. Replay Tab only at
          // the two known phase transitions so the next argument menu opens immediately.
          if (shouldChainCompletion(before, after, getCandidates())) target.handleInput(data);
        };
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, property, value) {
      return Reflect.set(target, property, value, target);
    },
  });
}

function parseInvocation(args: string, candidates: ModelCandidate[]): ParsedInvocation {
  const invocation = args.trim();
  if (!invocation) return { task: "" };

  const match = invocation.match(/^(\S+)(?:\s+([\s\S]*))?$/u);
  const firstToken = match?.[1] ?? invocation;
  if (!firstToken.startsWith("#")) return { task: invocation };

  const modelToken = firstToken.slice(1);
  const task = match?.[2]?.trim() ?? "";
  const exactCandidate = candidates.find((candidate) => candidate.reference === modelToken);
  if (exactCandidate) return { childModel: exactCandidate.reference, task };

  const baseCandidate = candidates.find((candidate) => candidate.baseReference === modelToken);
  if (baseCandidate) return { childModel: baseCandidate.reference, task };

  const effortCandidate = [...candidates]
    .sort((left, right) => right.baseReference.length - left.baseReference.length)
    .find((candidate) => modelToken.startsWith(`${candidate.baseReference}:`));
  if (!effortCandidate) return { task: invocation };

  const effort = modelToken.slice(effortCandidate.baseReference.length + 1);
  if (!effortCandidate.efforts.includes(effort as ModelThinkingLevel)) {
    return {
      error: `Unsupported effort "${effort}" for ${effortCandidate.baseReference}.`,
    };
  }

  return {
    childModel: `${effortCandidate.baseReference}:${effort}`,
    task,
  };
}

function buildSkillInvocation({ childModel, task }: Exclude<ParsedInvocation, { error: string }>): string {
  const instructions: string[] = [];
  if (childModel) instructions.push(`Use ${childModel} for every Pi subagent in this run.`);
  if (task) instructions.push(task);
  return instructions.length > 0 ? `${SKILL_INVOCATION} ${instructions.join("\n\n")}` : SKILL_INVOCATION;
}

function hasUnshadowedSkill(pi: ExtensionAPI): boolean {
  const matches = pi.getCommands().filter((command) => command.name === SKILL_COMMAND_NAME);
  return matches.length === 1 && matches[0]?.source === "skill";
}

export default function herdrSubagentExtension(pi: ExtensionAPI) {
  let candidates: ModelCandidate[] = [];

  const refreshCandidates = (ctx: ExtensionContext) => {
    candidates = collectModelCandidates(ctx);
  };

  pi.on("session_start", (_event, ctx) => {
    refreshCandidates(ctx);
    if (ctx.mode !== "tui") return;

    ctx.ui.addAutocompleteProvider((current) =>
      createChainedAutocompleteProvider(current, () => candidates),
    );

    const previousEditorFactory = ctx.ui.getEditorComponent();
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const baseEditor = previousEditorFactory?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
      return wrapEditorForChainedCompletion(
        baseEditor,
        (data) => keybindings.matches(data, "tui.input.tab"),
        () => candidates,
      );
    });
  });

  pi.on("model_select", (_event, ctx) => {
    refreshCandidates(ctx);
  });

  pi.registerCommand(COMMAND_NAME, {
    description: "Run Herdr with an optional #provider/model[:effort], followed directly by the task",
    getArgumentCompletions: (prefix) => getArgumentCompletions(prefix, candidates),
    handler: async (args, ctx) => {
      if (!ctx.isIdle()) {
        ctx.ui.notify("The coordinator is busy. Run /herdr-subagent again when it is idle.", "warning");
        return;
      }

      if (!hasUnshadowedSkill(pi)) {
        ctx.ui.notify("The native /skill:herdr-subagent command is unavailable or shadowed.", "warning");
        return;
      }

      refreshCandidates(ctx);
      const parsed = parseInvocation(args, candidates);
      if ("error" in parsed) {
        ctx.ui.notify(parsed.error, "warning");
        return;
      }

      pi.sendUserMessage(buildSkillInvocation(parsed), {
        expandPromptTemplates: true,
      });
    },
  });
}
