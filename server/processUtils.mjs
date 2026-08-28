import { spawn } from "node:child_process";

export function runProcess(command, args = [], options = {}) {
  const {
    cwd,
    env,
    input,
    onChild,
    timeoutMs = 120_000,
    maxOutputBytes = 512_000,
  } = options;

  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    onChild?.(child);
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const append = (current, chunk) => {
      const next = `${current}${chunk}`;
      return next.length > maxOutputBytes ? next.slice(-maxOutputBytes) : next;
    };

    const timer = timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 5_000).unref?.();
      }, timeoutMs)
      : null;
    timer?.unref?.();

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdin.on("error", () => undefined);
    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      resolveRun({ ok: false, code: null, stdout, stderr: error.message, timedOut: false, error });
    });
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      resolveRun({ ok: code === 0 && !timedOut, code, signal, stdout, stderr, timedOut });
    });

    if (input !== undefined) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

export async function commandWorks(command, args = ["--version"], options = {}) {
  const result = await runProcess(command, args, { ...options, timeoutMs: options.timeoutMs ?? 10_000 });
  return result.ok;
}
