//! Guide Agent - Help users understand the system
//! Provides documentation-based guidance

const std = @import("std");
const AgentDefinition = @import("../agent_definition.zig").AgentDefinition;

/// Agent type identifier
pub const AGENT_TYPE = "guide";

/// When to use this agent
pub const WHEN_TO_USE =
    "Use this agent when the user asks questions about: features, configuration, " ++
    "commands, integrations, or usage. IMPORTANT: Before spawning a new agent, check " ++
    "if there is already a running or recently completed guide agent that you can continue.";

/// Allowed tools (normal)
var TOOLS_ARR = [_][]const u8{ "Bash", "Glob", "Grep", "FileRead", "WebFetch", "WebSearch" };

/// Tools for embedded search environments
var TOOLS_EMBEDDED_ARR = [_][]const u8{ "Bash", "FileRead", "WebFetch", "WebSearch" };

/// Base prompt for guide agent
pub fn getBasePrompt() []const u8 {
    return
        "You are the guide agent. Your primary responsibility is helping users " ++
        "understand and use the system effectively.\n" ++
        "\n" ++
        "**Your expertise spans:**\n" ++
        "\n" ++
        "1. **CLI Tool**: Installation, configuration, custom commands, IDE integrations, " ++
        "settings, and workflows.\n" ++
        "\n" ++
        "2. **Agent SDK**: A framework for building custom AI agents. Available for " ++
        "various programming languages.\n" ++
        "\n" ++
        "3. **API**: Direct API usage, tool use, and integrations.\n" ++
        "\n" ++
        "**Approach:**\n" ++
        "1. Determine which domain the user's question falls into\n" ++
        "2. Use WebFetch to fetch appropriate documentation\n" ++
        "3. Identify the most relevant documentation URLs\n" ++
        "4. Fetch specific documentation pages\n" ++
        "5. Provide clear, actionable guidance based on official documentation\n" ++
        "6. Use WebSearch if docs don't cover the topic\n" ++
        "7. Reference local project files when relevant\n" ++
        "\n" ++
        "**Guidelines:**\n" ++
        "- Always prioritize official documentation over assumptions\n" ++
        "- Keep responses concise and actionable\n" ++
        "- Include specific examples or code snippets when helpful\n" ++
        "- Reference exact documentation URLs in your responses\n" ++
        "- Help users discover features by proactively suggesting related capabilities";
}

/// Get feedback guideline based on environment
pub fn getFeedbackGuideline(is_third_party: bool) []const u8 {
    if (is_third_party) {
        return "- When you cannot find an answer, direct the user to the appropriate support channel";
    }
    return "- When you cannot find an answer, direct the user to use the feedback command";
}

/// Get local search hint based on environment
pub fn getLocalSearchHint(has_embedded_search: bool) []const u8 {
    if (has_embedded_search) {
        return "FileRead, `find`, and `grep`";
    }
    return "FileRead, Glob, and Grep";
}

/// Create the guide agent definition
pub fn createAgent(has_embedded_search: bool) AgentDefinition {
    _ = has_embedded_search;
    return .{
        .agent_type = AGENT_TYPE,
        .when_to_use = WHEN_TO_USE,
        .tools = TOOLS_ARR[0..],
        .source = .builtin,
        .base_dir = "built-in",
        .model = "fast",
        .permission_mode = .dont_ask,
    };
}

// =============================================================================
// Tests
// =============================================================================

test "getBasePrompt contains expected sections" {
    const prompt = getBasePrompt();
    try std.testing.expect(std.mem.indexOf(u8, prompt, "guide agent") != null);
    try std.testing.expect(std.mem.indexOf(u8, prompt, "CLI Tool") != null);
    try std.testing.expect(std.mem.indexOf(u8, prompt, "Agent SDK") != null);
    try std.testing.expect(std.mem.indexOf(u8, prompt, "WebFetch") != null);
}

test "getFeedbackGuideline variants" {
    const tp = getFeedbackGuideline(true);
    try std.testing.expect(std.mem.indexOf(u8, tp, "support channel") != null);

    const internal = getFeedbackGuideline(false);
    try std.testing.expect(std.mem.indexOf(u8, internal, "feedback command") != null);
}

test "getLocalSearchHint variants" {
    const embedded = getLocalSearchHint(true);
    try std.testing.expect(std.mem.indexOf(u8, embedded, "find`") != null);

    const normal = getLocalSearchHint(false);
    try std.testing.expect(std.mem.indexOf(u8, normal, "Glob") != null);
}

test "Agent constants" {
    try std.testing.expectEqualStrings("guide", AGENT_TYPE);
}
