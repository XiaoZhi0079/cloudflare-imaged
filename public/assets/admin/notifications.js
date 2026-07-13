export function createNotifier(host) {
  const timers = new Map();
  function dismiss(element) { clearTimeout(timers.get(element)); timers.delete(element); element.remove(); }
  function show(message, type, timeout) {
    const item = document.createElement("div");
    item.className = `admin-toast is-${type}`;
    item.setAttribute("role", type === "error" ? "alert" : "status");
    const text = document.createElement("span"); text.textContent = message;
    const close = document.createElement("button"); close.type = "button"; close.textContent = "×"; close.title = "关闭"; close.setAttribute("aria-label", "关闭通知");
    close.addEventListener("click", () => dismiss(item));
    item.append(text, close); host.append(item);
    if (timeout) timers.set(item, setTimeout(() => dismiss(item), timeout));
    return item;
  }
  return { success: (message) => show(message, "success", 3000), error: (message) => show(message, "error", 0), dismiss };
}
