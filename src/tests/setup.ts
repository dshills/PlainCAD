import "@testing-library/jest-dom/vitest";

// jsdom has no top layer; real focus trapping/Escape are verified by Playwright.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
    this.querySelector<HTMLElement>(
      "[autofocus], button:not(:disabled), input",
    )?.focus();
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
}
