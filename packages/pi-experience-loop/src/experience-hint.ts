import { frictionReasons, type SessionFriction } from "./session-friction.ts";

export function frictionHint(friction: SessionFriction): string {
  const reason = frictionReasons(friction).join(" and ") || "friction";
  return `This session contained ${reason} after substantive work. Run /skill:capture-learning to preserve the reusable lesson.`;
}

export function hintWidgetLines(friction: SessionFriction): string[] {
  const reason = frictionReasons(friction).join(" and ") || "friction";
  return [`Capturable experience (${reason}): run /skill:capture-learning`];
}
