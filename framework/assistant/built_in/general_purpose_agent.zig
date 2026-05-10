//! General Purpose Agent - Default agent for complex tasks
//! Multi-purpose agent for research and implementation

const std = @import("std");
const AgentDefinition = @import("../agent_definition.zig").AgentDefinition;

/// Agent type identifier
pub const AGENT_TYPE = "general-purpose";

/// When to use this agent
pub const WHEN_TO_USE =
    "General-purpose agent for researching complex questions, searching for code, " ++
    "and executing multi-step tasks. When you are searching for a keyword or file " ++
    "and are not confident that you will find the right match in the first few " ++
    "tries use this agent to perform the search for you.";

/// Shared prefix for system prompts
const SHARED_PREFIX = 
    "You are an autonomous agent. Given the user's message, you should use the " ++
    "tools available to complete the task. Complete the task fully—don't gold-plate, " ++
    "but don't leave it half-done.";

/// Shared guidelines
const SHARED_GUIDELINES = 
    "Your strengths:\n" ++
    "- Searching for code, configurations, and patterns across large codebases\n" ++
    "- Analyzing multiple files to understand system architecture\n" ++
    "- Investigating complex questions that require exploring many files\n" ++
    "- Performing multi-step research tasks\n" ++
    "\n" ++
    "Guidelines:\n" ++
    "- For file searches: search broadly when you don't know where something lives. " ++
    "Use Read when you know the specific file path.\n" ++
    "- For analysis: Start broad and narrow down. Use multiple search strategies " ++
    "if the first doesn't yield results.\n" ++
    "- Be thorough: Check multiple locations, consider different naming conventions, " ++
    "look for related files.\n" ++
    "- NEVER create files unless they're absolutely necessary for achieving your goal. " ++
    "ALWAYS prefer editing an existing file to creating a new one.\n" ++
    "- NEVER proactively create documentation files (*.md) or README files. " ++
    "Only create documentation files if explicitly requested.";

/// Get the system prompt for the general purpose agent
pub fn getSystemPrompt() []const u8 {
    return SHARED_PREFIX ++ " When you complete the task, respond with a concise report " ++
        "covering what was done and any key findings—the caller will relay this to the user, " ++
        "so it only needs the essentials.\n" ++
        "\n" ++
        SHARED_GUIDELINES;
}

/// Create the general purpose agent definition
pub fn createAgent() AgentDefinition {
    var TOOLS_ARR = [_][]const u8{"*"};
    return .{
        .agent_type = AGENT_TYPE,
        .when_to_use = WHEN_TO_USE,
        .tools = TOOLS_ARR[0..],
        .source = .builtin,
        .base_dir = "built-in",
        .model = null,
    };
}

// =============================================================================
// Tests
// =============================================================================

test "getSystemPrompt contains expected sections" {
    const prompt = getSystemPrompt();
    try std.testing.expect(std.mem.indexOf(u8, prompt, "autonomous agent") != null);
    try std.testing.expect(std.mem.indexOf(u8, prompt, "Your strengths") != null);
    try std.testing.expect(std.mem.indexOf(u8, prompt, "Guidelines") != null);
    try std.testing.expect(std.mem.indexOf(u8, prompt, "NEVER create files") != null);
}

test "Agent constants" {
    try std.testing.expectEqualStrings("general-purpose", AGENT_TYPE);
}
