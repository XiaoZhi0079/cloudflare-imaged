function focusableElements(root) {
  return [...root.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
}

export function createDialogHost(host) {
  let active = null;

  function close(value) {
    if (!active) return;
    const { resolve, opener, keydown } = active;
    document.removeEventListener("keydown", keydown);
    active = null;
    host.replaceChildren();
    opener?.focus();
    resolve(value);
  }

  function open({ title, body, confirmLabel, danger = false, valueReader, panelClass = "" }) {
    if (active) close(null);
    return new Promise((resolve) => {
      const opener = document.activeElement;
      host.innerHTML = `<div class="admin-dialog-backdrop"><section class="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-dialog-title"><header><h2 id="admin-dialog-title"></h2><button type="button" data-dialog-close aria-label="关闭" title="关闭">×</button></header><div class="admin-dialog-body"></div><footer><button type="button" data-dialog-cancel>取消</button><button type="button" data-dialog-confirm class="${danger ? "admin-button-danger" : "admin-button-primary"}"></button></footer></section></div>`;
      const backdrop = host.firstElementChild;
      const panel = backdrop.firstElementChild;
      if (panelClass) panel.classList.add(panelClass);
      panel.querySelector("h2").textContent = title;
      panel.querySelector(".admin-dialog-body").append(body);
      panel.querySelector("[data-dialog-confirm]").textContent = confirmLabel;
      const keydown = (event) => {
        if (event.key === "Escape") close(null);
        if (event.key === "Tab") {
          const focusable = focusableElements(panel);
          if (!focusable.length) return;
          const first = focusable[0];
          const last = focusable.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      };
      active = { resolve, opener, keydown };
      document.addEventListener("keydown", keydown);
      backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(null); });
      panel.querySelector("[data-dialog-close]").addEventListener("click", () => close(null));
      panel.querySelector("[data-dialog-cancel]").addEventListener("click", () => close(null));
      panel.querySelector("[data-dialog-confirm]").addEventListener("click", () => close(valueReader?.() ?? true));
      requestAnimationFrame(() => focusableElements(panel)[0]?.focus());
    });
  }

  return {
    open,
    confirm({ title, message, confirmLabel = "确认", danger = false }) {
      const body = document.createElement("p");
      body.textContent = message;
      return open({ title, body, confirmLabel, danger });
    },
    textInput({ title, label, value = "", helper = "", confirmLabel = "保存" }) {
      const body = document.createElement("label");
      body.className = "admin-field";
      const caption = document.createElement("span"); caption.textContent = label;
      const input = document.createElement("input"); input.value = value;
      body.append(caption, input);
      if (helper) { const note = document.createElement("small"); note.textContent = helper; body.append(note); }
      return open({ title, body, confirmLabel, valueReader: () => input.value.trim() });
    },
    destroy() { close(null); },
  };
}
