import { createAdminApiClient, AdminUnauthorizedError } from "./api-client.js";
import { createAdminKeyStore } from "./auth.js";
import { createDialogHost } from "./dialogs.js";
import { createNotifier } from "./notifications.js";
import { createAlbumManagementController } from "./album-management.js?v=20260717-albums-gallery-redesign";

const elements = {
  authView: document.querySelector("#admin-auth-view"),
  app: document.querySelector("#admin-app"),
  loginForm: document.querySelector("#admin-login-form"),
  loginButton: document.querySelector("#admin-login"),
  loginError: document.querySelector("#admin-login-error"),
  keyInput: document.querySelector("#admin-key"),
  passwordToggle: document.querySelector("[data-toggle-password]"),
  logout: document.querySelector("[data-admin-logout]"),
  retry: document.querySelector("#featured-retry"),
  albumPanel: document.querySelector("#album-panel"),
};

const keyStore = createAdminKeyStore();
const dialogs = createDialogHost(document.querySelector("#admin-dialog-host"));
const notifier = createNotifier(document.querySelector("#admin-toast-host"));
let authAttempt = 0;

function showAuth(message = "") {
  elements.app.hidden = true;
  elements.authView.hidden = false;
  elements.loginError.textContent = message;
  elements.keyInput.value = keyStore.get();
  elements.retry.hidden = true;
  elements.retry.disabled = false;
  elements.logout.disabled = false;
  requestAnimationFrame(() => elements.keyInput.focus());
}

function showApp() {
  elements.authView.hidden = true;
  elements.app.hidden = false;
}

function messageFor(error) {
  return error?.message || "操作失败，请稍后重试。";
}

const client = createAdminApiClient({
  getKey: () => keyStore.get(),
  onUnauthorized: () => {
    keyStore.clear();
    showAuth("登录状态已失效，请重新输入管理密钥。");
  },
});

const albumController = createAlbumManagementController({
  root: elements.albumPanel,
  client,
  dialogs,
  notifier,
});
albumController.bind();

async function authenticate(key) {
  const attempt = ++authAttempt;
  keyStore.set(key);
  elements.retry.disabled = true;
  elements.logout.disabled = true;
  try {
    await albumController.load();
    if (attempt !== authAttempt) return;
    elements.retry.hidden = true;
    elements.retry.disabled = false;
    elements.logout.disabled = false;
    showApp();
  } catch (error) {
    if (attempt !== authAttempt) return;
    if (error instanceof AdminUnauthorizedError) return;
    showApp();
    elements.retry.hidden = false;
    elements.retry.disabled = false;
    elements.logout.disabled = false;
    notifier.error(messageFor(error));
  }
}

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const key = elements.keyInput.value.trim();
  if (!key) {
    elements.loginError.textContent = "请输入管理密钥。";
    return;
  }
  elements.loginButton.disabled = true;
  elements.loginError.textContent = "";
  try {
    await authenticate(key);
  } finally {
    elements.loginButton.disabled = false;
  }
});

elements.passwordToggle.addEventListener("click", () => {
  const visible = elements.keyInput.type === "text";
  elements.keyInput.type = visible ? "password" : "text";
  elements.passwordToggle.textContent = visible ? "显示" : "隐藏";
  elements.passwordToggle.setAttribute("aria-label", visible ? "显示管理密钥" : "隐藏管理密钥");
});

elements.retry.addEventListener("click", () => {
  if (!elements.retry.disabled) authenticate(keyStore.get());
});

elements.logout.addEventListener("click", () => {
  authAttempt += 1;
  keyStore.clear();
  showAuth();
});

if (keyStore.get()) {
  authenticate(keyStore.get());
} else {
  showAuth();
}
