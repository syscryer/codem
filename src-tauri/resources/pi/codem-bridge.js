const SIDE_EFFECTING_TOOLS = new Set(["write", "edit", "bash"]);
const MAX_PATH_SUMMARY_CHARS = 240;
const MAX_COMMAND_SUMMARY_CHARS = 80;

function boundedSingleLine(value, limit) {
  if (typeof value !== "string") return "";
  return value.replace(/[\r\n\t]+/g, " ").trim().slice(0, limit);
}

function shellTokens(command) {
  const tokens = [];
  let token = "";
  let quote = "";
  let escaped = false;
  for (const character of command) {
    if (escaped) {
      token += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      else token += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (token) tokens.push(token);
      token = "";
      continue;
    }
    if (/[;&|]/.test(character)) return null;
    token += character;
  }
  if (escaped || quote) return null;
  if (token) tokens.push(token);
  return tokens;
}

function commandName(command) {
  const source = boundedSingleLine(command, 4096);
  if (!source) return "unknown";
  const tokens = shellTokens(source);
  if (!tokens?.length) return "shell command";
  let index = tokens[0].toLowerCase() === "env" ? 1 : 0;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? "")) index += 1;
  const token = tokens[index] ?? "shell command";
  const executable = token.split(/[\\/]/).pop() || "shell command";
  return boundedSingleLine(executable, MAX_COMMAND_SUMMARY_CHARS) || "shell command";
}

function confirmationCopy(event) {
  if (event.toolName === "bash") {
    return {
      title: "Run shell command",
      message: `Command: ${commandName(event.input?.command)}`,
    };
  }

  const path =
    boundedSingleLine(event.input?.path, MAX_PATH_SUMMARY_CHARS) ||
    "target path unavailable";
  return {
    title: event.toolName === "write" ? "Write file" : "Edit file",
    message: `Path: ${path}`,
  };
}

export default function codemBridge(pi) {
  pi.on("tool_call", async (event, ctx) => {
    const permissionMode = process.env.CODEM_PI_PERMISSION_MODE || "default";
    if (permissionMode === "auto" || permissionMode === "bypassPermissions") {
      return undefined;
    }
    if (!SIDE_EFFECTING_TOOLS.has(event.toolName)) return undefined;

    const copy = confirmationCopy(event);
    const confirmed = await ctx.ui.confirm(copy.title, copy.message);
    if (!confirmed) {
      return { block: true, reason: "Blocked by user" };
    }
    return undefined;
  });
}
