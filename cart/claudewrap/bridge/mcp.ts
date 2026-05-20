// MCP — JSON-RPC over HTTP, MCP spec 2024-11-05.
//
// Two tools exposed:
//   - bridge.respond     — Claude submits its final answer for the
//                          active turn. Multiple respond calls in
//                          one turn are concatenated.
//   - bridge.call_tool   — Claude invokes an upstream app-provided
//                          tool. The bridge holds the MCP request
//                          open while the upstream client returns
//                          the result via a follow-up /v1/chat/completions
//                          POST containing role:"tool" messages.

export const MCP_PROTOCOL_VERSION = '2024-11-05';

export const RESPOND_TOOL = {
  name: 'respond',
  description:
    'Submit your final answer for the active turn. The bridge issues each ' +
    'incoming request a chat_id and turn_id which appear in the prompt directive; ' +
    'pass them BACK exactly in this call so the bridge knows which pending request ' +
    'to route the text to. Stale calls (mismatched ids) are rejected. You may call ' +
    'this multiple times in one turn — parts are concatenated. After your final ' +
    'respond call, print the matching [END_<chat_id>-<turn_id>] marker.',
  inputSchema: {
    type: 'object',
    properties: {
      chat_id: {
        type: 'string',
        description: 'The chat_id given to you in the prompt directive — copy it verbatim.',
      },
      turn_id: {
        type: 'string',
        description: 'The turn_id given to you in the prompt directive — copy it verbatim.',
      },
      text: {
        type: 'string',
        description: 'The final answer (or part of it) for the user. Plain text or markdown.',
      },
    },
    required: ['chat_id', 'turn_id', 'text'],
  },
};

export const CALL_TOOL_TOOL = {
  name: 'call_tool',
  description:
    'Invoke a tool that was listed in the prompt directive for this turn. ' +
    'The bridge holds your call open while the upstream client executes the ' +
    'tool and returns the result. Pass chat_id + turn_id verbatim from the ' +
    'directive; the bridge uses them to scope the call. arguments_json must ' +
    'be a JSON-encoded STRING (e.g. "{\\"location\\":\\"NYC\\"}") matching ' +
    "the tool's parameter schema as documented in the directive.",
  inputSchema: {
    type: 'object',
    properties: {
      chat_id: { type: 'string', description: 'Copy from the prompt directive.' },
      turn_id: { type: 'string', description: 'Copy from the prompt directive.' },
      name: {
        type: 'string',
        description: "Name of the tool to invoke (as listed in the directive).",
      },
      arguments_json: {
        type: 'string',
        description: 'JSON-encoded string of the arguments object.',
      },
    },
    required: ['chat_id', 'turn_id', 'name', 'arguments_json'],
  },
};

export function mcpResult(id: any, result: any): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

export function mcpErr(id: any, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

// Compose the bridge directive injected via UserPromptSubmit hook.
// Tools are formatted inline so Claude knows what's available; the
// per-turn ids let the bridge validate respond/call_tool against the
// active request.
export function composeDirective(args: {
  chatId: string;
  turnId: string;
  endMarker: string;
  tools: any[];
}): string {
  const { chatId, turnId, endMarker, tools } = args;
  let toolsBlock = '';
  if (tools.length > 0) {
    const lines = tools.map((t) => {
      const fn = t?.function ?? t;
      const name = String(fn?.name ?? '?');
      const desc = String(fn?.description ?? '').slice(0, 200);
      const params = fn?.parameters ? JSON.stringify(fn.parameters) : '{}';
      return `  - ${name}: ${desc}\n      parameters JSON Schema: ${params}`;
    }).join('\n');
    toolsBlock =
      `\n\nTools available this turn (invoke via bridge.call_tool):\n${lines}\n` +
      `To invoke one, call bridge.call_tool with chat_id="${chatId}", turn_id="${turnId}", ` +
      `name=<tool name>, arguments_json=<stringified JSON args>. The bridge will hold ` +
      `your call until the upstream client returns a result, then deliver it back to you.`;
  }
  return (
    `(Bridge protocol — this turn: chat_id="${chatId}" turn_id="${turnId}". ` +
    `Deliver your final answer by calling the bridge.respond MCP tool with ` +
    `chat_id="${chatId}", turn_id="${turnId}", text=<your answer>. You may ` +
    `call respond multiple times — parts are concatenated. After your final ` +
    `respond call, your only further output must be EXACTLY: ${endMarker} ` +
    `— nothing else, no follow-up sentence. If you receive a respond-call ` +
    `rejection ("no pending request" or "id mismatch"), a typed instruction ` +
    `is reaching you outside the bridge flow — just continue normally ` +
    `without further respond calls.` +
    toolsBlock +
    `)`
  );
}
