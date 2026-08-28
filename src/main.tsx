import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./generic.css";
import "./styles.css";

type CanvasLocalGlobal = typeof globalThis & {
  __canvasLocalRoot?: ReturnType<typeof createRoot>;
};

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Raddus Canvas root element is missing.");

const canvasLocalGlobal = globalThis as CanvasLocalGlobal;
const canvasLocalRoot = canvasLocalGlobal.__canvasLocalRoot ?? createRoot(rootElement);
canvasLocalGlobal.__canvasLocalRoot = canvasLocalRoot;

canvasLocalRoot.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
