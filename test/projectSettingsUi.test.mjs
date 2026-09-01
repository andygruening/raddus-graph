import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("settings can delete projects while protecting the last project", async () => {
  const [app, css] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  ]);

  assert.ok(app.includes("function deleteProject(projectId: string)"), "App should define a project deletion mutation.");
  assert.ok(app.includes("function requestDeleteProject(projectId: string)"), "Project deletion should go through confirmation.");
  assert.ok(app.includes("onDeleteProject={requestDeleteProject}"), "Settings dialog should receive the delete handler.");
  assert.ok(app.includes("Delete Project"), "Settings should render a project delete button.");
  assert.ok(app.includes("projects.length <= 1"), "The delete control should guard against deleting the last project.");
  assert.ok(app.includes("Create another project before deleting this one."), "Last-project deletion should explain the guard.");
  assert.ok(app.includes("latestSessionForProject(nextState.sessions, nextSelectedProjectId)"), "Deleting the selected project should follow the next project's latest session.");
  assert.ok(css.includes(".settings-project-actions"), "Settings project actions should have a stable layout hook.");
});
