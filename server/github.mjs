import { mkdir } from "node:fs/promises";
import { basename } from "node:path";
import { commandWorks, runProcess } from "./processUtils.mjs";

export async function githubStatus() {
  const available = await commandWorks("gh", ["--version"]);
  if (!available) return { available: false, authenticated: false, error: "GitHub CLI is not installed." };

  const auth = await runProcess("gh", ["auth", "status"], { timeoutMs: 15_000 });
  if (!auth.ok) {
    return {
      available: true,
      authenticated: false,
      error: cleanError(auth.stderr || auth.stdout || "GitHub CLI is not authenticated."),
    };
  }
  return { available: true, authenticated: true, error: null };
}

export async function listRepositories() {
  const status = await githubStatus();
  if (!status.available || !status.authenticated) return { ...status, repositories: [] };

  const result = await runProcess("gh", [
    "repo",
    "list",
    "--limit",
    "100",
    "--json",
    "nameWithOwner,url,defaultBranchRef,description,isPrivate",
  ], { timeoutMs: 30_000 });

  if (!result.ok) {
    return {
      available: true,
      authenticated: true,
      error: cleanError(result.stderr || result.stdout || "Could not list GitHub repositories."),
      repositories: [],
    };
  }

  const repositories = parseJsonArray(result.stdout).map((repository) => ({
    nameWithOwner: stringValue(repository.nameWithOwner),
    url: stringValue(repository.url),
    defaultBranch: stringValue(repository.defaultBranchRef?.name) || "main",
    description: stringValue(repository.description),
    isPrivate: Boolean(repository.isPrivate),
  })).filter((repository) => repository.nameWithOwner);

  return { available: true, authenticated: true, error: null, repositories };
}

export async function listBranches(nameWithOwner) {
  const status = await githubStatus();
  if (!status.available || !status.authenticated || !nameWithOwner) {
    return { ...status, branches: [] };
  }

  const result = await runProcess("gh", [
    "api",
    "--paginate",
    `repos/${nameWithOwner}/branches`,
    "--jq",
    ".[].name",
  ], { timeoutMs: 30_000 });

  if (!result.ok) {
    return {
      available: true,
      authenticated: true,
      error: cleanError(result.stderr || result.stdout || "Could not list GitHub branches."),
      branches: [],
    };
  }

  const branches = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return { available: true, authenticated: true, error: null, branches };
}

export async function cloneRepository({ nameWithOwner, branch, worktreePath }) {
  await mkdir(worktreePath, { recursive: true });
  const args = ["repo", "clone", nameWithOwner, worktreePath];
  if (branch) args.push("--", "--branch", branch, "--single-branch");
  const result = await runProcess("gh", args, { timeoutMs: 180_000 });
  if (!result.ok) {
    throw new Error(cleanError(result.stderr || result.stdout || `Could not clone ${nameWithOwner}.`));
  }
}

export async function publishSessionChanges({ cwd, sessionId, currentBranchName, prUrl, nodeName }) {
  const dirty = await runProcess("git", ["status", "--porcelain"], { cwd, timeoutMs: 15_000 });
  if (!dirty.ok || !dirty.stdout.trim()) {
    return { changed: false, branchName: currentBranchName, prUrl };
  }

  const branchName = currentBranchName || `raddus-graph/${sessionId}`;
  if (!currentBranchName) {
    await assertOk(runProcess("git", ["checkout", "-B", branchName], { cwd, timeoutMs: 30_000 }), "Could not create session branch.");
  }

  await assertOk(runProcess("git", ["add", "-A"], { cwd, timeoutMs: 30_000 }), "Could not stage session changes.");

  const commitMessage = `Raddus Graph ${sessionId}: ${nodeName || "agent changes"}`;
  const commit = await runProcess("git", ["commit", "-m", commitMessage], { cwd, timeoutMs: 60_000 });
  if (!commit.ok && !/nothing to commit|no changes added/i.test(`${commit.stdout}\n${commit.stderr}`)) {
    throw new Error(cleanError(commit.stderr || commit.stdout || "Could not commit session changes."));
  }

  await assertOk(runProcess("git", ["push", "-u", "origin", branchName], { cwd, timeoutMs: 180_000 }), "Could not push session branch.");

  if (prUrl) return { changed: true, branchName, prUrl };

  const title = `Raddus Graph session ${sessionId}`;
  const body = [
    `Graph session: ${sessionId}`,
    "",
    "This pull request was created by Raddus Graph after an agent changed files in the retained session workspace.",
  ].join("\n");
  const pr = await runProcess("gh", ["pr", "create", "--title", title, "--body", body, "--head", branchName], { cwd, timeoutMs: 120_000 });
  if (!pr.ok) throw new Error(cleanError(pr.stderr || pr.stdout || "Could not create pull request."));

  return { changed: true, branchName, prUrl: pr.stdout.trim().split(/\s+/).find((part) => part.startsWith("http")) ?? pr.stdout.trim() };
}

export function repositoryNameFromUrl(url) {
  return basename(String(url ?? "").replace(/\.git$/, "")) || "repository";
}

async function assertOk(promise, message) {
  const result = await promise;
  if (!result.ok) throw new Error(cleanError(result.stderr || result.stdout || message));
  return result;
}

function parseJsonArray(text) {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function cleanError(message) {
  return String(message).trim().split(/\r?\n/).filter(Boolean).slice(-4).join("\n");
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}
