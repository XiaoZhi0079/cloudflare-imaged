import { createAdminApiClient, AdminUnauthorizedError } from "./api-client.js";
import { createAdminKeyStore } from "./auth.js";
import { createDialogHost } from "./dialogs.js";
import { createNotifier } from "./notifications.js";
import { createSiteSettingsController } from "./site-settings.js?v=20260716-admin-featured-navigation";

const elements = {
  authView: document.querySelector("#admin-auth-view"),
  app: document.querySelector("#admin-app"),
  loginForm: document.querySelector("#admin-login-form"),
  loginButton: document.querySelector("#admin-login"),
  loginError: document.querySelector("#admin-login-error"),
  keyInput: document.querySelector("#admin-key"),
  passwordToggle: document.querySelector("[data-toggle-password]"),
  logout: document.querySelector("[data-admin-logout]"),
  featuredPanel: document.querySelector("#featured-panel"),
};

const keyStore = createAdminKeyStore();
const dialogs = createDialogHost(document.querySelector("#admin-dialog-host"));
const notifier = createNotifier(document.querySelector("#admin-toast-host"));

function showAuth(message = "") {
  elements.app.hidden = true;
  elements.authView.hidden = false;
  elements.loginError.textContent = message;
  elements.keyInput.value = keyStore.get();
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

const featuredController = createSiteSettingsController({
  root: elements.featuredPanel,
  client,
  dialogs,
  notifier,
});
featuredController.bind();

async function authenticate(key) {
  keyStore.set(key);
  try {
    await featuredController.load();
    showApp();
  } catch (error) {
    if (error instanceof AdminUnauthorizedError) return;
    showApp();
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

elements.logout.addEventListener("click", () => {
  keyStore.clear();
  showAuth();
});

if (keyStore.get()) {
  authenticate(keyStore.get());
} else {
  showAuth();
}
