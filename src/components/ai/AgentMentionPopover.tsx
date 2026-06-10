import { useEffect, useMemo, useRef, useState } from "react";
import { Bot } from "lucide-react";
import type { ClientAgent } from "@/hooks/useClientAgents";

interface Props {
  /** Current textarea value */
  value: string;
  /** Caret position inside `value` */
  caret: number;
  agents: ClientAgent[];
  /** Called with the new full value + new caret position. */
  onInsert: (newValue: string, newCaret: number) => void;
  /** Anchor element (the textarea) — used to position the popover */
  anchorRef: React.RefObject<HTMLTextAreaElement>;
}

/**
 * Detects an `@partial` token immediately before the caret and renders a
 * floating list of matching agents. Selecting one replaces the token with
 * `@handle ` and moves the caret past it.
 *
 * Pure presentational — no state lives outside `value`/`caret` from the parent.
 */
export function AgentMentionPopover({ value, caret, agents, onInsert, anchorRef }: Props) {
  const [activeIdx, setActiveIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Find @token immediately before caret. Allow letters, numbers, _ and -.
  const token = useMemo(() => {
    if (caret <= 0) return null;
    const before = value.slice(0, caret);
    const match = before.match(/(?:^|\s)@([A-Za-z0-9_-]*)$/);
    if (!match) return null;
    const query = match[1] ?? "";
    const start = caret - query.length - 1; // position of '@'
    return { query, start, end: caret };
  }, [value, caret]);

  const matches = useMemo(() => {
    if (!token) return [] as ClientAgent[];
    const q = token.query.toLowerCase();
    const enabled = agents.filter((a) => a.enabled);
    return enabled
      .filter((a) =>
        !q ||
        a.handle.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [agents, token]);

  useEffect(() => {
    setActiveIdx(0);
  }, [token?.query]);

  // Hijack ArrowUp/Down/Enter/Tab while open
  useEffect(() => {
    const ta = anchorRef.current;
    if (!ta || !token || matches.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % matches.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + matches.length) % matches.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        commit(matches[activeIdx]);
      } else if (e.key === "Escape") {
        // let the parent close by clearing the token via space
      }
    };
    ta.addEventListener("keydown", handler, true);
    return () => ta.removeEventListener("keydown", handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, matches, activeIdx]);

  const commit = (agent: ClientAgent) => {
    if (!token) return;
    const insert = `@${agent.handle} `;
    const next = value.slice(0, token.start) + insert + value.slice(token.end);
    const newCaret = token.start + insert.length;
    onInsert(next, newCaret);
  };

  if (!token || matches.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute left-2 bottom-full mb-1 z-50 w-64 rounded-lg border bg-popover shadow-lg overflow-hidden"
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground border-b">
        Mention an agent
      </div>
      <div className="max-h-64 overflow-y-auto">
        {matches.map((a, i) => (
          <button
            key={a.id}
            type="button"
            onClick={() => commit(a)}
            onMouseEnter={() => setActiveIdx(i)}
            className={
              "w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted/60 " +
              (i === activeIdx ? "bg-muted/60" : "")
            }
          >
            <Bot className="h-3.5 w-3.5 text-primary shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">@{a.handle}</div>
              <div className="truncate text-[10px] text-muted-foreground">
                {a.name} · {a.agent_type}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}