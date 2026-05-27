---
name: trellis
description: Control the Trellis development environment - check service status, view logs, restart services, run workflows, and switch worktrees
---

# Trellis Development Environment Control

Use `trellis-ctl` to interact with the running Trellis instance. It auto-discovers the API URL by walking up from the current directory looking for `trellis.hjson`. If `server.public_url` is set, it's used verbatim; otherwise the URL is built from `server.host`, `server.port`, and `server.tls_cert`/`tls_key`. Set `server.public_url` when bind address ≠ connect address — for example, binding to a Tailscale IP with a cert issued for the Tailscale hostname. In Trellis-managed terminal sessions, `TRELLIS_API` is set automatically (using the same resolution) and takes precedence over the config file. You can also pass `-config <path>` or set `TRELLIS_CONFIG` to point at a specific config file.

**Important:** Always use the `-json` flag for structured output that's easier to parse:
```bash
trellis-ctl -json status
trellis-ctl -json logs backend -n 50
trellis-ctl -json workflow list
```

## Available Commands

### Service Status
Check the status of all services or a specific service:
```bash
trellis-ctl status              # All services
trellis-ctl status backend      # Specific service
```

States: `running`, `stopped`, `crashed`, `starting`, `stopping`

### Service Logs
View logs from a service or log viewer:
```bash
trellis-ctl logs backend           # Last 100 lines from service
trellis-ctl logs backend -n 50     # Last 50 lines
trellis-ctl logs backend -f        # Follow/stream logs
trellis-ctl logs -viewer nginx     # View log viewer (remote logs)
trellis-ctl logs -list             # List available log viewers
```

**Service vs Log Viewer:**
- `trellis-ctl logs <service>` - Local service logs. If the service has `logging.parser` configured, logs are parsed for filtering by level/field.
- `trellis-ctl logs -viewer <name>` - Remote log viewers (SSH, file, command sources). Always parsed.

#### Filtering Options
```bash
trellis-ctl logs backend -since 1h           # Last hour
trellis-ctl logs backend -since 30m          # Last 30 minutes
trellis-ctl logs backend -since 6:30am       # Clock time (today)
trellis-ctl logs backend -since 14:00        # 24-hour format
trellis-ctl logs backend -until 7:00am       # End time for range
trellis-ctl logs backend -level error        # Errors only
trellis-ctl logs backend -level warn+        # Warn and above
trellis-ctl logs backend -level warn,error   # Specific levels
trellis-ctl logs backend -grep "timeout"     # Pattern match
trellis-ctl logs backend -grep "(?i)error"   # Case-insensitive regex
trellis-ctl logs backend -field host=prod1   # Filter by field
trellis-ctl logs backend -field status=5*    # Wildcard field match

# Context lines around grep matches (like grep -B/-A/-C)
trellis-ctl logs backend -grep "error" -B 5  # 5 lines before each match
trellis-ctl logs backend -grep "error" -A 10 # 10 lines after each match
trellis-ctl logs backend -grep "error" -C 3  # 3 lines before and after

# Combined example: find "started" with context in a time window
trellis-ctl logs -viewer api-logs -grep "started" -B 10 -since 6:00am -until 7:00am
```

#### Output Formats
```bash
trellis-ctl logs backend -json               # JSON array
trellis-ctl logs backend -jsonl              # JSON Lines (one per line)
trellis-ctl logs backend -csv                # CSV with header
trellis-ctl logs backend -raw                # Original log lines
trellis-ctl logs backend -format '{{.timestamp}} {{.level}}: {{.message}}'  # Custom template
```

#### Statistics and Management
```bash
trellis-ctl logs backend -stats              # Show log statistics
trellis-ctl logs backend -clear              # Clear service log buffer
trellis-ctl logs backend -open               # Open in browser
trellis-ctl logs backend -url                # Show browser URL
```

When debugging crashes, look for:
- Panic traces (goroutine stack)
- Fatal errors
- The last error message before exit

### Service Control
Start, stop, or restart services:
```bash
trellis-ctl start backend
trellis-ctl stop backend
trellis-ctl restart backend
```

### Workflows
List, describe, and run workflows:
```bash
trellis-ctl workflow list              # List all workflows with descriptions
trellis-ctl workflow describe <id>     # Show workflow inputs and validation rules
trellis-ctl workflow run <id>          # Run a workflow (waits for completion)
trellis-ctl workflow run <id> --arg=value  # Run with input arguments
trellis-ctl workflow status <id>       # Check workflow status
```

**Discovering and running workflows with inputs:**
```bash
# See what inputs a workflow expects
trellis-ctl workflow describe find-email

# Output shows:
#   --msgid    Email message ID (optional)
#              Pattern: ^[a-zA-Z0-9._@<>-]+$
#   --id       Database ID (optional)
#              Pattern: ^[0-9]+$
#   --date     Date to search (required)
#              Type: date (YYYY-MM-DD)

# Run with validated inputs
trellis-ctl workflow run find-email --date=2024-01-15 --id=12345
```

Workflow inputs are validated server-side against configured patterns and allowed values. Invalid inputs return an error without executing the workflow.

### Worktrees
List and switch git worktrees:
```bash
trellis-ctl worktree list           # List all worktrees
trellis-ctl worktree activate main  # Switch to a worktree
```

Switching worktrees will:
1. Stop all services
2. Re-expand config templates with new paths
3. Restart all services

### Events
View recent system events:
```bash
trellis-ctl events          # Last 50 events
trellis-ctl events -n 20    # Last 20 events
```

### Notifications
Send notification events to alert the user:
```bash
trellis-ctl notify "Task completed"                      # Done notification (default)
trellis-ctl notify "Need API credentials" -type blocked  # Blocked - waiting for user
trellis-ctl notify "Build failed" -type error            # Error notification
```

**When to notify:**
- `done` - Task completed successfully, user can review the results
- `blocked` - Stuck and need user input to continue
- `error` - Something failed that needs attention

Users can subscribe to these events via WebSocket (`/api/v1/events/ws?pattern=notify.*`) or view them with `trellis-ctl events`.

### Crash Reports
View crash reports that are automatically captured when services fail:
```bash
trellis-ctl crash list              # List all crash reports
trellis-ctl crash newest            # Get the most recent crash
trellis-ctl crash <id>              # Get a specific crash by ID
trellis-ctl crash delete <id>       # Delete a crash report
trellis-ctl crash clear             # Clear all crash reports
```

Each crash report contains:
- Service name and exit code
- Trace ID of the request that caused the crash (if detected)
- Worktree context (name, branch, path)
- Log entries from all services filtered by the trace ID
- Summary statistics (entry count by source and level)

The JSON output includes an `entries` array with parsed log entries:
```json
{
  "id": "20260117-143201.234",
  "service": "backend",
  "exit_code": 2,
  "trace_id": "req-abc123",
  "entries": [
    {
      "timestamp": "2026-01-17T14:32:01Z",
      "source": "backend",
      "level": "error",
      "message": "panic: nil pointer dereference",
      "fields": {...},
      "raw": "..."
    }
  ]
}
```

### Distributed Tracing

**Two separate commands** (note the hyphen difference):
- `trace` - Execute a new trace search
- `trace-report` - View/manage saved trace reports

#### Execute a Trace Search (`trace`)
```bash
trellis-ctl -json trace <id> <group>                # Search for ID in a trace group
trellis-ctl -json trace abc123 api-flow             # Example: search for "abc123"
trellis-ctl -json trace abc123 api-flow -since 1h   # Last hour only
trellis-ctl -json trace abc123 api-flow -since 10am -until 11am  # Time window
```

The JSON output includes an `entries` array with all matching log lines:
```json
{
  "name": "trace-abc123-20260117-103045",
  "trace_id": "abc123",
  "status": "completed",
  "entries": [
    {
      "timestamp": "2026-01-17T10:30:01Z",
      "source": "nginx-logs",
      "level": "info",
      "message": "GET /api/groups/123 200",
      "fields": {"request_id": "abc123", "path": "/api/groups/123"},
      "raw": "..."
    }
  ]
}
```

#### View Saved Trace Reports (`trace-report`)
```bash
trellis-ctl -json trace-report <name>         # Get a saved report by name
trellis-ctl -json trace-report -list          # List all saved reports
trellis-ctl -json trace-report -groups        # List configured trace groups
trellis-ctl trace-report -delete <name>       # Delete a report
```

**Time input formats:** `1h`, `30m` (duration), `6:00am`, `14:30` (clock time), `2025-01-10` (date), `2025-01-10 6:00am` (date+time), `today`, `yesterday`, `now`

**Date ranges are inclusive:** When using a date without a time, start means beginning of day (00:00:00) and end means end of day (23:59:59). To search only one day, use the same date for both `-since` and `-until`.

Trace groups are configured in `trellis.hjson` under `trace_groups`, defining which log viewers to search together. Example:
```hjson
trace_groups: [
  { name: "api-flow", log_viewers: ["nginx-logs", "api-logs", "db-logs"] }
]
```

#### Service Tracing (Dev Environment)

When services have `logging.parser` configured (directly or via `logging_defaults`), a `services` trace group is auto-generated that searches all service log buffers:
```bash
trellis-ctl -json trace "req-123" services -since 1h   # Search all dev service logs
trellis-ctl -json trace-report -groups                  # See the auto-generated "services" group
```

This requires no configuration — `svc:<name>` log viewers are created automatically from each service's in-memory ring buffer.

## Common Workflows

### After Making Code Changes
1. Build the code (your normal build process)
2. Check if service auto-restarted: `trellis-ctl status`
3. If crashed, check logs: `trellis-ctl logs <service> -n 100`

### Debugging a Crash
1. **Check service status**: `trellis-ctl status <service>`
2. **View crash report**: `trellis-ctl -json crash newest` - includes trace ID and filtered logs
3. **View recent logs**: `trellis-ctl logs <service> -n 200`
4. **Check AI context file** (if configured) for crash details and trace info
5. Fix the issue and rebuild
6. Verify: `trellis-ctl status <service>`

### Switching to a Different Branch
1. List worktrees: `trellis-ctl worktree list`
2. Activate: `trellis-ctl worktree activate <name>`
3. Wait for services to restart
4. Verify: `trellis-ctl status`

### Debugging Across Dev Services

When a request touches multiple services locally:
```bash
# Search all service log buffers for a trace/request ID
trellis-ctl -json trace "req-abc123" services -since 1h

# The result shows the request flow across all services with parsers configured
```

### Investigating a Production Error

When asked to investigate an error seen in production logs:

1. **Run a trace** to gather all related log entries:
   ```bash
   trellis-ctl -json trace <trace_id> <group> -since <time>
   ```
   Example: `trellis-ctl -json trace XXXX-XXXX-12345 web -since 10am`

2. **Parse the JSON output** - The trace returns entries with:
   - `timestamp` - When it occurred
   - `source` - Which log viewer (nginx, api, db, etc.)
   - `level` - Log level (error, warn, info)
   - `message` - The log message
   - `fields` - Parsed fields (request path, user ID, etc.)
   - `raw` - Original log line

3. **Analyze the request flow** - Entries are sorted by timestamp, showing the request path through the system. Look for:
   - The initial request (often from nginx/load balancer)
   - Application processing steps
   - Database queries
   - The error and where it occurred
   - Any context from surrounding log lines

4. **Read the relevant source code** - Use file paths and function names from the logs to find the code that generated the error.

5. **Notify when done**:
   ```bash
   trellis-ctl notify "Investigation complete - found the issue in handler.go:142"
   ```

**Example investigation:**
```bash
# Step 1: Run trace for the error around 10am
trellis-ctl -json trace req-abc123 web -since 9:30am -until 10:30am

# Step 2: Parse output, identify the error source
# Look for entries with level="error" and examine the request flow

# Step 3: Read the source files mentioned in the trace
# e.g., if trace shows error in /api/groups endpoint, read the handler

# Step 4: Notify the user
trellis-ctl notify "Found issue: group lookup fails when ID contains special chars"
```

### Querying Production Data

When you need to fetch data from production databases to understand an issue:

1. **Discover available workflows** that can query production:
   ```bash
   trellis-ctl workflow list
   trellis-ctl workflow describe <workflow-id>
   ```

2. **Run the workflow with validated inputs**:
   ```bash
   trellis-ctl -json workflow run db-fetch --table=users --id=12345
   ```

Workflow inputs are validated against configured patterns and allowed values before execution, ensuring safe queries. For example, a workflow configured with:
- `allowed_values: ["users", "groups", "messages"]` for table
- `pattern: "^[0-9]+$"` for ID

Will reject attempts to query unauthorized tables or pass malformed IDs.

**Example: Investigating a user issue**
```bash
# 1. Run trace to find the error
trellis-ctl -json trace req-abc123 api-flow -since 1h

# 2. Trace shows user_id=12345 had an error - fetch the user record
trellis-ctl -json workflow run db-fetch --table=users --id=12345

# 3. Examine the returned JSON to understand the user's state
# 4. Read relevant source code to understand the bug
# 5. Notify with findings
trellis-ctl notify "User 12345 has invalid subscription_tier causing the error"
```
