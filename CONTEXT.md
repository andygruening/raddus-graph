# Raddus Graph

Raddus Graph is a local canvas for designing agentic execution graphs. It describes how play nodes, graph sessions, agent sessions, declared results, and conditional routing relate inside a graph.

## Language

**Agent Spec**:
A reusable description of an agent that can be placed in a graph and run as a session. It consists of the agent's name, model, and system prompt.
_Avoid_: Hosted agent, Anthropic agent

**Agent Session**:
A single run of an agent from graph context and a prompt.
_Avoid_: Deployment, job

**Graph Session**:
A single execution of a graph started from a play node. It owns the agent sessions, node outcomes, and retained workspace for that run.
_Avoid_: Chat session, deployment run

**Play Node**:
A graph node that starts a graph session from a user-entered prompt.
_Avoid_: Trigger, automation trigger, API trigger

**Upstream Execution Context**:
The prior agent session context along the graph path that led to a node.
_Avoid_: Graph history, chat transcript

**Result Catalog**:
The graph-scoped set of result definitions that agent sessions can select from.
_Avoid_: Status list

**Result**:
A declared outcome that an agent session can select. It has a stable id and a description explaining the outcome.
_Avoid_: Status, label

**Terminal Outcome**:
The final outcome posted for an agent session after it has finished running.
_Avoid_: Progress status

**Expression Card**:
A graph card that routes execution by comparing an agent session result to a selected result.
_Avoid_: Automation, trigger rule

**Session Workspace**:
The retained working directory associated with a graph session.
_Avoid_: Scratch directory, temporary folder

**Session Pull Request**:
The pull request associated with a graph session when agent sessions publish code changes.
_Avoid_: Agent pull request
