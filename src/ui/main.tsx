import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Dashboard } from "./Dashboard.js";
import "./styles.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("root element missing");
}
createRoot(container).render(
  <StrictMode>
    <Dashboard />
  </StrictMode>,
);
