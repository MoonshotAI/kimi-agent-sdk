import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

function syncTheme() {
  const isDark = document.body.classList.contains("vscode-dark");
  document.documentElement.classList.toggle("dark", isDark);
}

function syncThemeMode() {
  const themeMode = document.body.getAttribute("data-thememode") ?? "builtin";
  document.documentElement.classList.toggle("vscode-theme", themeMode === "vscode");
}

syncTheme();
syncThemeMode();

const observer = new MutationObserver(() => {
  syncTheme();
  syncThemeMode();
});
observer.observe(document.body, {
  attributes: true,
  attributeFilter: ["class", "data-thememode"],
});

const container = document.getElementById("root");

if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
