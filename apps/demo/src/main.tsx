import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "prosemirror-view/style/prosemirror.css";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root element");
}
const rootElement = root;

function bootstrap(): void {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

bootstrap();
