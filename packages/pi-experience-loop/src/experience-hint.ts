import type { EntryRenderer } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { frictionReasons, type SessionFriction } from "./session-friction.ts";

/** Data persisted in the visible hint entry rendered inside the transcript. */
export type ExperienceHintEntry = {
  friction: SessionFriction;
};

export function frictionHint(friction: SessionFriction): string {
  const reason = frictionReasons(friction).join(" and ") || "friction";
  return `This branch contained ${reason} after substantive work. Run /skill:capture-learning to preserve the reusable lesson.`;
}

export function hintWidgetLines(friction: SessionFriction): string[] {
  const reason = frictionReasons(friction).join(" and ") || "friction";
  return [`Capturable experience (${reason}): run /skill:capture-learning`];
}

export const renderExperienceHint: EntryRenderer<ExperienceHintEntry> = (entry, { expanded }, theme) => {
  const friction = entry.data?.friction;
  if (!friction || typeof friction.score !== "number") return undefined;
  const reason = frictionReasons(friction).join(" and ") || "friction";
  const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
  box.addChild(
    new Text(
      `${theme.fg("customMessageLabel", theme.bold("Experience worth capturing"))} ${theme.fg(
        "dim",
        `(friction score ${friction.score})`,
      )}`,
      0,
      0,
    ),
  );
  box.addChild(
    new Text(theme.fg("customMessageText", `This branch contained ${reason} after substantive work.`), 0, 0),
  );
  box.addChild(
    new Text(theme.fg("customMessageText", "Run /skill:capture-learning to preserve the reusable lesson."), 0, 0),
  );
  if (expanded) {
    box.addChild(
      new Text(
        theme.fg(
          "dim",
          `tool calls ${friction.toolCount}; tool errors ${friction.toolError}; interrupts ${friction.interrupt}; corrections ${friction.correction}; unique tools ${friction.uniqueTools}`,
        ),
        0,
        0,
      ),
    );
  }
  return box;
};
