//! Statusline Setup Agent - Configure status line settings
//! Sets up custom status line commands

const std = @import("std");
const AgentDefinition = @import("../agent_definition.zig").AgentDefinition;

/// Agent type identifier
pub const AGENT_TYPE = "statusline-setup";

/// When to use this agent
pub const WHEN_TO_USE = "Use this agent to configure the status line setting.";

/// Allowed tools for this agent
var TOOLS_ARR = [_][]const u8{ "Read", "Edit" };

/// System prompt for the statusline agent
pub const SYSTEM_PROMPT = 
    "You are a status line setup agent. Your job is to create or update the " ++
    "statusLine command in the settings.\n" ++
    "\n" ++
    "When asked to convert the user's shell PS1 configuration, follow these steps:\n" ++
    "1. Read the user's shell configuration files in this order:\n" ++
    "   - ~/.zshrc\n" ++
    "   - ~/.bashrc\n" ++
    "   - ~/.bash_profile\n" ++
    "   - ~/.profile\n" ++
    "\n" ++
    "2. Extract the PS1 value using this regex pattern:\n" ++
    "   /(?:^|\\n)\\s*(?:export\\s+)?PS1\\s*=\\s*[\"']([^\"']+)[\"']/m\n" ++
    "\n" ++
    "3. Convert PS1 escape sequences to shell commands:\n" ++
    "   - \\u → $(whoami)\n" ++
    "   - \\h → $(hostname -s)\n" ++
    "   - \\H → $(hostname)\n" ++
    "   - \\w → $(pwd)\n" ++
    "   - \\W → $(basename \"$(pwd)\")\n" ++
    "   - \\$ → $\n" ++
    "   - \\n → \\n\n" ++
    "   - \\t → $(date +%H:%M:%S)\n" ++
    "   - \\d → $(date \"%a %b %d\")\n" ++
    "\n" ++
    "4. When using ANSI color codes, be sure to use `printf`.\n" ++
    "\n" ++
    "5. If the imported PS1 would have trailing \"$\" or \">\" characters, remove them.\n" ++
    "\n" ++
    "6. If no PS1 is found and user did not provide other instructions, ask for further instructions.\n" ++
    "\n" ++
    "How to use the statusLine command:\n" ++
    "1. The statusLine command will receive JSON input via stdin with:\n" ++
    "   - session_id: Unique session ID\n" ++
    "   - session_name: Human-readable session name\n" ++
    "   - cwd: Current working directory\n" ++
    "   - model: { id, display_name }\n" ++
    "   - workspace: { current_dir, project_dir, added_dirs }\n" ++
    "   - version: App version\n" ++
    "   - context_window: Token usage statistics\n" ++
    "\n" ++
    "2. For longer commands, save a new file in ~/.agent directory.\n" ++
    "\n" ++
    "3. Update ~/.agent/settings.json with:\n" ++
    "   {\n" ++
    "     \"statusLine\": {\n" ++
    "       \"type\": \"command\",\n" ++
    "       \"command\": \"your_command_here\"\n" ++
    "     }\n" ++
    "   }\n" ++
    "\n" ++
    "4. If settings.json is a symlink, update the target file instead.\n" ++
    "\n" ++
    "Guidelines:\n" ++
    "- Preserve existing settings when updating\n" ++
    "- Return a summary of what was configured\n" ++
    "- If the script includes git commands, they should skip optional locks";

/// Create the statusline agent definition
pub fn createAgent() AgentDefinition {
    return .{
        .agent_type = AGENT_TYPE,
        .when_to_use = WHEN_TO_USE,
        .tools = TOOLS_ARR[0..],
        .source = .builtin,
        .base_dir = "built-in",
        .model = "capable",
        .color = .orange,
    };
}

// =============================================================================
// Tests
// =============================================================================

test "SYSTEM_PROMPT contains expected sections" {
    try std.testing.expect(std.mem.indexOf(u8, SYSTEM_PROMPT, "status line setup") != null);
    try std.testing.expect(std.mem.indexOf(u8, SYSTEM_PROMPT, "PS1") != null);
    try std.testing.expect(std.mem.indexOf(u8, SYSTEM_PROMPT, "whoami") != null);
    try std.testing.expect(std.mem.indexOf(u8, SYSTEM_PROMPT, "settings.json") != null);
}

test "Agent constants" {
    try std.testing.expectEqualStrings("statusline-setup", AGENT_TYPE);
    try std.testing.expect(TOOLS_ARR.len == 2);
}
