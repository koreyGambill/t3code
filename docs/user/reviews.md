# Thread workspace

Open **Workspace** in a started conversation or search for **Open workspace** in
the command palette. It keeps questions, action items, design explanations, and
catch-up notes beside the conversation. Groups can nest, and an item's short
reference stays the same when it moves.

Ask the agent to **workspace this for later** when you want something saved.
The agent can organize and update the board without stopping its other work.
Ordinary chat does not populate the board automatically.

## Questions and action items

Questions can offer one choice, several choices, or a written answer. A recommended
choice shows the agent's advice. It is never selected on your behalf.

Your answers and action notes save as you work and stay private from the agent
until you choose **Add to chat**. Add one response or all ready responses. The
message includes readable answers and a reference back to the workspace item.
If saving or sending fails, your draft remains available to retry. A conflicting
edit from another device needs resolving before you send.

Action items hold outstanding needs and future work. Mark one done or reopen it
without starting an agent run. Add it to chat when you want the agent to act on
its status or your notes.

## Design and summary

Design holds the agent's explanations, context, diagrams, and documents. Ask for
changes in chat. Summary covers the whole conversation so you can catch up on
what happened, what changed, and the current state. Future work belongs in Action
items.

## Marks and related threads

Marks collects links from chat, keeping each URL's first appearance. Search,
filter, sort, and choose columns before copying. **Copy all** produces plain-text
rows using your visible columns and current results. The agent can add a link
description when useful.

Threads shows related conversations and why they matter. The clock in the chat
header opens **Recent Threads**. Back and Forward follow your navigation path.

## Personal notes

Personal notes are yours. Choose a notes directory for each environment to save
thread notes as Markdown files. Notes remain private until you select text and
add it to chat. You can include the T3 thread ID in the file. The note includes a
terminal resume command when the provider has a resumable session.

Workspace is available in web and desktop builds with workspace support. An
older connected environment needs a build with support before it can serve the
panel.

## Loads and token usage

Loads shows file reads, skill loads, and related tool activity observed in the
conversation. Use Refresh to update these views while an agent is working. Reported events and events inferred from command text are labeled
separately. A command mentioning a file does not prove every byte reached the
model, and an unavailable tool result has no invented token count.

Tokens shows the usage the provider reported for each turn, including cache
accounting when available. Instruction sizes are a separate estimate from the
actual application payload prepared for a turn. They break down T3 instructions
by section, application context, and custom prompt additions. Estimates use
UTF-8 bytes divided by four. They are not billed token counts, and they should
not be added to the provider's totals.

Hidden provider harness instructions remain unknown. Earlier turns without an
instruction snapshot stay unavailable rather than inheriting today's prompt.
