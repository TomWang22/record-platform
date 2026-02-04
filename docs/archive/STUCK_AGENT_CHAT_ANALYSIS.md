# Stuck Agent Chat (4 threads @ 100% CPU) – Analysis

## Summary

The agent chat with transcript ID `533b5ba1-4870-41ec-87e0-4489b9aa0713` is **not stuck because the agent is waiting** — it’s stuck because **Cursor’s UI is overloaded by the size of that single conversation**. When you focus that chat, Activity Monitor shows ~4 threads at 100% CPU; that’s Cursor (Electron/Code) working on this one huge transcript.

## Findings

### 1. Transcript size

- **File:** `~/.cursor/projects/Users-tom-record-platform/agent-transcripts/533b5ba1-4870-41ec-87e0-4489b9aa0713.txt`
- **Length:** ~163,000+ lines
- **Tool call/result lines:** 2,000+ (many `[Tool call]` / `[Tool result]` pairs)

So this is one very long “4-agent” style conversation with a lot of tool use and output.

### 2. No stuck agent response

- The transcript **ends with user messages** (repeated shopping/service/k6/redis requests and one truncated line: `chmod +x scripts/run-preflig`).
- There is **no incomplete agent reply** or pending `[Tool call]` at the end; the agent isn’t blocked waiting on a tool in the log.

### 3. No runaway test processes

- **Checked:** No processes for `run-final-test-suite.sh`, `run-preflight-scale-and-all-suites.sh`, or k6 test scripts.
- **Terminals folder:** Empty (no active terminal state files for that run).
- So the 100% CPU when you **click that chat** is not from a background test suite; it’s from Cursor rendering/processing that chat.

### 4. Why 4 threads at 100% when you open that chat

When you focus that conversation, Cursor has to:

- Load and parse ~163K lines.
- Build the chat UI (messages, code blocks, tool calls/results).
- Run syntax highlighting, markdown, and possibly search/indexing on a huge buffer.

That work can easily max out several threads (e.g. main thread + a few workers), which matches “4 rogue threads at 100% CPU” in Activity Monitor.

## Recommendations

### Immediate

1. **Avoid focusing that chat** when you don’t need it — use another chat or a new one for current work so Cursor isn’t constantly re-processing the 163K-line transcript.
2. **Confirm it’s Cursor:** In Activity Monitor, when the CPU spikes, check that the high-CPU process is **Cursor** (or “Electron”). That would confirm it’s the chat UI, not a script.

### If you need to keep the conversation

3. **Save important conclusions elsewhere** (e.g. a short doc or this repo’s Runbook) so you’re not dependent on reopening that chat.
4. **Consider archiving/closing that chat** in Cursor (if the product supports it) so it’s not loaded by default and doesn’t sit in the same “active” set as your main chats.

### Longer term

5. Prefer **shorter, focused agent chats** (e.g. one chat per big task or per suite) so no single transcript grows to 100K+ lines.
6. If you need to “keep that one working,” the way to do it is to **stop opening it** for routine work and only open it when you must reference it — and then close or switch away when done to stop the CPU spike.

## Test suite / other agent

- There are **no live processes** running `run-final-test-suite.sh` or `run-preflight-scale-and-all-suites.sh`; the other agent’s test run is not still running in the background.
- To re-run the suites, start them again from this (or another) chat or from a terminal; the previous run is no longer active.

---

*Generated from analysis of the transcript file and process/terminal checks.*
