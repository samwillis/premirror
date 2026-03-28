import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { buildPremirrorBanner } from "@premirror/core";

import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root element");
}

console.info(buildPremirrorBanner());

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
