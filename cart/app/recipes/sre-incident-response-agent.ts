import type { RecipeDocument } from "./recipe-document";

export const recipe: RecipeDocument = {
  slug: "sre-incident-response-agent",
  title: "The SRE Incident Response Agent (ReactJIT port)",
  sourcePath: "cart/app/recipes/sre-incident-response-agent.md",
  instructions:
    "Adapt Anthropic's SRE incident response agent to ReactJIT — single useAssistant({ backend: 'claude_code' }) mount driving the claude CLI through the unified worker contract, no MCP, with built-in Bash/Read/Edit tools scoped by allowed_tools and the session's cwd.",
  sections: [
    {
      kind: "paragraph",
      title: "Premise",
      text:
        "The original recipe is a Python notebook talking to a 12-tool MCP server. We are dropping MCP. The agent runs in-process: framework/assistant/claude_sdk/ spawns one claude CLI subprocess in stream-json mode behind framework/assistant/worker_bindings.zig, and the cart consumes the normalized event stream through useAssistant. The agent acts through Claude Code's built-in tools (Bash, Read, Edit, Grep) confined to the session's cwd.",
    },
    {
      kind: "bullet-list",
      title: "What's preserved from the original",
      items: [
        "Workflow shape: investigate → diagnose → remediate → write post-mortem.",
        "Demo fault: misconfigured DB_POOL_SIZE causes connection-pool exhaustion.",
        "Separation of phases: read-only investigation first, writes only after confirmation.",
        "Safety lives at the tool boundary, not in prose instructions.",
      ],
    },
    {
      kind: "bullet-list",
      title: "What's dropped or replaced",
      items: [
        "MCP server subprocess — gone. Built-in Claude Code tools cover the entire SRE surface.",
        "Custom tool descriptions — gone. Bash/Read/Edit ship with their own.",
        "PreToolUse shell hooks — not yet wired in our SDK; flagged as a gap.",
        "Python claude-agent-sdk async loop — replaced by the useAssistant events array (or runOneTurn for batch).",
      ],
    },
    {
      kind: "code-block",
      title: "Concept-to-code mapping",
      language: "text",
      code: `Anthropic recipe                        ReactJIT
─────────────────────────────────────   ─────────────────────────────────────────
claude-agent-sdk (Python)               framework/assistant/claude_sdk/ (Zig)
query() async generator                 useAssistant().events array (reactive)
ClaudeAgentOptions                      claude_sdk.SessionOptions
mcp_servers={...}                       (dropped)
allowed_tools=["mcp__sre__..."]         allowed_tools = &.{ "Bash", "Read", "Edit", "Grep" }
permission_mode="acceptEdits"           permission_mode = .accept_edits
system_prompt / model                   same field names (Zig); useAssistant exposes model
PreToolUse hooks                        not yet wired (gap)
Python notebook driver                  cart .tsx with useAssistant({ backend: 'claude_code' })
AssistantMessage.content[]              WorkerEvent stream: assistant_message | reasoning | tool_call`,
    },
    {
      kind: "bullet-list",
      title: "What lives where in the repo",
      items: [
        "framework/assistant/claude_sdk/mod.zig — public surface (Session, SessionOptions, Message, ContentBlock, OwnedMessage, PermissionMode).",
        "framework/assistant/claude_sdk/session.zig — non-blocking subprocess; init() / send() / interrupt() / poll() / close() / deinit().",
        "framework/assistant/claude_sdk/options.zig — typed config: cwd, model, system_prompt, allowed_tools, disallowed_tools, permission_mode, max_turns, resume_session, add_dirs.",
        "framework/assistant/claude_sdk/argv.zig — emits CLI flags. --mcp-config is intentionally absent.",
        "framework/assistant/claude_sdk/types.zig — Message union (system | assistant | user | result), ContentBlock variants, Usage, ResultMsg with cost/duration.",
        "framework/assistant/worker_bindings.zig — V8 host fns __worker_start / _send / _poll / _respond / _set_tools / _close — the bridge useAssistant calls.",
        "framework/assistant/worker_contract.zig — normalized WorkerEvent emission: every backend funnels into the same event union.",
        "runtime/hooks/useAssistant.ts — React-side surface: opts in, { events, ask, phase, ready, close } out.",
      ],
    },
    {
      kind: "code-block",
      title: "Step 0: workspace layout (the agent's cwd)",
      language: "text",
      code: `~/sre-workspace/
├── config/
│   ├── api-server.env        # contains DB_POOL_SIZE
│   └── docker-compose.yml
├── services/
│   └── api_server.py
└── scripts/
    └── traffic_generator.py`,
    },
    {
      kind: "paragraph",
      text:
        "The agent's filesystem reach is bounded by SessionOptions.cwd. Anything outside is reachable only via add_dirs. This is the first line of defense — pick the directory carefully.",
    },
    {
      kind: "code-block",
      title: "Step 1: scope the tools (Zig side)",
      language: "text",
      code: `// Zig (framework/assistant/claude_sdk/options.zig fields)
const allowed:    []const []const u8 = &.{ "Bash", "Read", "Edit", "Grep" };
const disallowed: []const []const u8 = &.{ "Write", "WebFetch", "WebSearch" };

// Today these aren't surfaced through the worker opts JSON for claude_code —
// see Gaps. Carts that need full tool scoping drop to Zig until the worker
// bindings grow allowed_tools / disallowed_tools fields.`,
    },
    {
      kind: "bullet-list",
      title: "Why these four tools cover the SRE loop",
      items: [
        "Bash: curl Prometheus (http://localhost:9090/api/v1/query), docker-compose logs, docker-compose up -d <svc>.",
        "Read: config/api-server.env, config/docker-compose.yml, app log files.",
        "Edit: change DB_POOL_SIZE=1 → DB_POOL_SIZE=20 in api-server.env.",
        "Grep: scan logs for error patterns the agent forms hypotheses about.",
        "No Write means the agent cannot create new files — useful guardrail; post-mortems get appended to an existing file.",
      ],
    },
    {
      kind: "code-block",
      title: "Step 2: SRE system prompt",
      language: "text",
      code: `// Zig multi-line literal — passed verbatim as opts.system_prompt.
// (The Claude branch of the worker bindings doesn't yet pipe systemPrompt
// from the cart — see Gaps. Drive Zig directly to set it today.)
const SYSTEM_PROMPT =
    \\\\You are an SRE incident response bot.
    \\\\
    \\\\Investigation methodology:
    \\\\1. Probe service health (curl Prometheus's /api/v1/query for error rate, latency, db_connections_active).
    \\\\2. Drill into error rates per service.
    \\\\3. Check latency — high latency often precedes errors.
    \\\\4. Inspect resources — DB connections, CPU, memory.
    \\\\5. docker-compose logs for the suspect container.
    \\\\6. Read config files for misconfigurations.
    \\\\7. Correlate symptoms to root cause.
    \\\\
    \\\\Baseline noise: api-server has ~0.1–0.2 errors/sec normally. Focus on significant spikes.
    \\\\Be thorough but efficient. Always explain your reasoning.
;`,
    },
    {
      kind: "code-block",
      title: "Step 3: drive a session from Zig",
      language: "text",
      code: `// One-shot Zig driver — for a flight-check binary or a dev-shell sub-command.
const std = @import("std");
const claude_sdk = @import("framework/assistant/claude_sdk/mod.zig");

pub fn runIncident(allocator: std.mem.Allocator) !void {
    var sess = try claude_sdk.Session.init(allocator, .{
        .cwd = "/home/you/sre-workspace",
        .model = "claude-opus-4-7",
        .system_prompt = SYSTEM_PROMPT,
        .allowed_tools = &.{ "Bash", "Read", "Edit", "Grep" },
        .disallowed_tools = &.{ "Write", "WebFetch", "WebSearch" },
        .permission_mode = .accept_edits,
        .verbose = true,
        .inherit_stderr = true,
    });
    defer sess.deinit();

    try sess.send(
        \\\\Reports of API errors and timeouts. Investigate thoroughly:
        \\\\- service health and error rates (Prometheus on localhost:9090)
        \\\\- DB connections and latency
        \\\\- container logs for errors
        \\\\- config files for misconfigurations
        \\\\Identify the root cause. Do NOT apply any fixes yet.
    );

    while (true) {
        var maybe_msg = try sess.poll();
        if (maybe_msg == null) {
            std.time.sleep(50 * std.time.ns_per_ms);
            continue;
        }
        var owned = maybe_msg.?;
        defer owned.deinit();

        switch (owned.msg) {
            .assistant => |a| for (a.content) |block| switch (block) {
                .text => |t| std.debug.print("\\n{s}\\n", .{t.text}),
                .tool_use => |tu| std.debug.print("\\n[Tool] {s}\\n", .{tu.name}),
                .thinking => {},
            },
            .result => |r| {
                std.debug.print("\\n[done] turns={d} cost=\${d:.4} {d}ms\\n",
                    .{ r.num_turns, r.total_cost_usd, r.duration_ms });
                return;
            },
            else => {},
        }
    }
}`,
    },
    {
      kind: "paragraph",
      text:
        "Investigation is one send(). Remediation is a second send() on the same session — no re-init, the conversation continues.",
    },
    {
      kind: "code-block",
      title: "Step 4: drive a session from a cart",
      language: "tsx",
      code: `import { useEffect, useMemo, useState } from 'react';
import { useAssistant, WorkerEvent } from '@reactjit/runtime/hooks/useAssistant';
import { Col, Pressable, ScrollView, Text } from '@reactjit/runtime/primitives';

const INCIDENT_PROMPT =
  "Reports of API errors and timeouts. Investigate thoroughly:\\n" +
  "- service health and error rates (Prometheus on localhost:9090)\\n" +
  "- DB connections and latency\\n" +
  "- container logs for errors\\n" +
  "- config files for misconfigurations\\n" +
  "Identify the root cause. Do NOT apply any fixes yet.";

function reduceLog(events: WorkerEvent[]): string[] {
  const out: string[] = [];
  for (const ev of events) {
    if (ev.kind === 'assistant_message' && ev.text) out.push(ev.text);
    else if (ev.kind === 'tool_call' && ev.payload_json) {
      try {
        const parsed = JSON.parse(ev.payload_json);
        out.push(\`[\${parsed?.name ?? '?'}]\`);
      } catch {}
    } else if (ev.kind === 'completion') {
      const cost = ev.cost_usd_delta ?? 0;
      out.push(\`done — $\${cost.toFixed(4)}\`);
    }
  }
  return out;
}

export default function SreCart() {
  const { events, ask, ready } = useAssistant({
    backend: 'claude_code',
    cwd: '/home/you/sre-workspace',
    model: 'claude-opus-4-7',
  });

  const log = useMemo(() => reduceLog(events), [events]);

  return (
    <Col>
      <Pressable onPress={() => ready() && ask(INCIDENT_PROMPT)}>
        <Text>Investigate</Text>
      </Pressable>
      <ScrollView>
        {log.map((line, i) => <Text key={i}>{line}</Text>)}
      </ScrollView>
    </Col>
  );
}`,
    },
    {
      kind: "bullet-list",
      title: "Cart-side notes",
      items: [
        "useAssistant owns the worker lifecycle. There's no per-frame poll loop in the cart — events arrive on the events array as the worker drains them.",
        "The worker stays warm across renders. Bumping a load-bearing opt (cwd / model / sessionId) respawns it; unmounting tears it down.",
        "systemPrompt and allowed_tools are NOT yet exposed by the Claude branch of the worker opts JSON. For full SRE config from a cart today, drive Zig directly. See Gaps.",
      ],
    },
    {
      kind: "code-block",
      title: "Step 5: trigger the incident from a shell",
      language: "bash",
      code: `# Inject the fault.
sed -i 's/DB_POOL_SIZE=20/DB_POOL_SIZE=1/' ~/sre-workspace/config/api-server.env
docker-compose -f ~/sre-workspace/config/docker-compose.yml up -d api-server

# Wait ~30s for Prometheus to scrape and for the spike to register.
# Confirm at http://localhost:9090 :
#   rate(http_requests_total{status="500"}[1m])`,
    },
    {
      kind: "code-block",
      title: "Step 6: investigation prompt (read-only)",
      language: "text",
      code: `We're getting reports of API errors and timeouts.
Something is wrong with the api-server. Investigate thoroughly:
- check service health and error rates via Prometheus on localhost:9090
- look at DB connections and latency
- check container logs for errors
- look at the config files for any misconfigurations
- identify the root cause

Report your findings but do NOT apply any fixes yet.`,
    },
    {
      kind: "paragraph",
      text:
        "Expect the agent to chain Bash (curl Prometheus), Bash (docker-compose logs api-server), Read (config/api-server.env), and explain that DB_POOL_SIZE=1 is the misconfiguration causing pool exhaustion.",
    },
    {
      kind: "code-block",
      title: "Step 7: remediation prompt (writes)",
      language: "text",
      code: `Based on your investigation, the root cause is DB_POOL_SIZE=1 in config/api-server.env.
1. Edit config/api-server.env to set DB_POOL_SIZE back to 20
2. Redeploy with docker-compose
3. Wait, then verify with another Prometheus query
4. Append a short post-mortem to postmortems/<timestamp>.md describing what happened, the root cause, and the fix.`,
    },
    {
      kind: "paragraph",
      text:
        "permission_mode = .accept_edits keeps the Edit tool from prompting interactively. Without it the CLI would block waiting for human approval — fine in cockpit/sweatshop, fatal in a headless run.",
    },
    {
      kind: "bullet-list",
      title: "Gaps in framework/assistant/ relative to the original recipe",
      items: [
        "No PreToolUse hooks. SessionOptions has no hooks field; argv.zig emits no --settings flag. Today the only guardrails are cwd, allowed_tools, disallowed_tools.",
        "Worker opts for claude_code don't accept allowed_tools / disallowed_tools / systemPrompt yet. The fields exist in claude_sdk/options.zig — wire them through framework/assistant/worker_bindings.zig.",
        "Two simultaneous incident agents work — useAssistant gives each mount its own worker — but they don't share state. Cross-coordination needs an explicit shared store.",
        "tool_call payload_json is backend-shaped. Cart code parses it (and the inner input may itself be a JSON string).",
        "No in-process custom tools. We don't need them for the SRE flow (built-ins suffice). If we add them later, do it as a callback registry the parser hands tool_use blocks to before the next turn — still no MCP.",
      ],
    },
    {
      kind: "bullet-list",
      title: "What to take from this",
      items: [
        "MCP was a workaround for missing built-ins. We have Bash/Read/Edit/Grep — they cover the SRE workflow without a tool server.",
        "Safety = cwd + allowed_tools + disallowed_tools + permission_mode, all already in framework/assistant/claude_sdk/options.zig.",
        "The agentic loop is the useAssistant events array, exactly the pattern the other recipes use.",
        "Investigation methodology lives in the system prompt. Tool descriptions are inherited from the CLI.",
        "Next pass: extend the worker opts JSON so a cart can declare the full SRE configuration without dropping to Zig.",
      ],
    },
  ],
  scaffold: {
    body:
      `  // TODO: author scaffold — this recipe is a multi-tool agent loop\n` +
      `  // (investigate → diagnose → remediate → write post-mortem), not\n` +
      `  // a 2-node useIFTTT chain. A partial event-driven entry point:\n` +
      `  //   useIFTTT('event:incident.declared', 'spawn-worker:sre-agent');\n` +
      `  // — but the agent's behavior lives inside useAssistant + worker\n` +
      `  // bindings, not in the IFTTT graph itself. Needs composition-\n` +
      `  // shaped recipes that point at a long-running agent worker.\n`,
  },
};
