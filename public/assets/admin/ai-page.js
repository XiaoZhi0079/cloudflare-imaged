import { createAdminApiClient, AdminUnauthorizedError } from "./api-client.js";
import { createAdminKeyStore } from "./auth.js";
import { createNotifier } from "./notifications.js";
import { buildImageVariantUrl } from "../image-variants.js";

const elements = {
  auth: document.querySelector("#admin-auth-view"), app: document.querySelector("#admin-app"),
  form: document.querySelector("#admin-login-form"), key: document.querySelector("#admin-key"),
  login: document.querySelector("#admin-login"), error: document.querySelector("#admin-login-error"),
  logout: document.querySelector("[data-admin-logout]"), status: document.querySelector("#ai-status"),
  pendingCount: document.querySelector("#ai-pending-count"), candidateCount: document.querySelector("#ai-candidate-count"),
  selectedCount: document.querySelector("#ai-selected-count"), candidates: document.querySelector("#ai-candidate-list"),
  proposals: document.querySelector("#ai-proposal-list"), loadMore: document.querySelector("#ai-load-more"),
  approve: document.querySelector("#ai-approve-selected"), reject: document.querySelector("#ai-reject-selected"),
  apply: document.querySelector("#ai-apply-selected"),
};
const keyStore = createAdminKeyStore();
const notifier = createNotifier(document.querySelector("#admin-toast-host"));
let proposals = [];
let selected = new Set();
let page = { offset: 0, nextOffset: 0, hasMore: false, loading: false };

const client = createAdminApiClient({
  getKey: () => keyStore.get(),
  onUnauthorized: () => { keyStore.clear(); showAuth("登录状态已失效，请重新输入管理密钥。"); },
});

function node(tag, attrs = {}, text = "") {
  const value = document.createElement(tag);
  for (const [key, current] of Object.entries(attrs)) {
    if (key === "className") value.className = current;
    else if (key === "checked") value.checked = Boolean(current);
    else if (key === "disabled") value.disabled = Boolean(current);
    else value.setAttribute(key, current);
  }
  if (text) value.textContent = text;
  return value;
}

function showAuth(message = "") {
  elements.app.hidden = true; elements.auth.hidden = false;
  elements.error.textContent = message; elements.key.value = keyStore.get();
}

function renderActions() {
  const chosen = proposals.filter((proposal) => selected.has(proposal.id));
  elements.selectedCount.textContent = String(chosen.length);
  elements.approve.disabled = !chosen.some((proposal) => proposal.status === "pending" || proposal.status === "rejected");
  elements.reject.disabled = !chosen.some((proposal) => proposal.status !== "applied");
  elements.apply.disabled = !chosen.some((proposal) => proposal.status === "approved");
}

function renderProposals() {
  elements.proposals.replaceChildren();
  for (const proposal of proposals) {
    const card = node("article", { className: `ai-proposal${selected.has(proposal.id) ? " is-selected" : ""}` });
    const checkbox = node("input", { className: "ai-proposal-select", type: "checkbox", checked: selected.has(proposal.id), "aria-label": `选择图片 ${proposal.imageId}` });
    checkbox.addEventListener("change", () => { if (checkbox.checked) selected.add(proposal.id); else selected.delete(proposal.id); renderProposals(); });
    const preview = node("div", { className: "ai-proposal-preview" });
    const image = node("img", { loading: "lazy", alt: "", src: buildImageVariantUrl(proposal.currentFileUrl, 640) || proposal.currentFileUrl });
    preview.append(image);
    const copy = node("div", { className: "ai-proposal-copy" });
    copy.append(node("h3", {}, proposal.proposedFileName));
    const changes = node("dl", { className: "ai-proposal-change" });
    const rows = [
      ["当前名称", proposal.currentFileName], ["当前目录", proposal.currentCategoryName || "未设置"],
      ["建议目录", proposal.proposedCategoryName], ["状态", proposal.status],
    ];
    for (const [label, value] of rows) changes.append(node("dt", {}, label), node("dd", {}, String(value ?? "")));
    copy.append(changes);
    const tags = node("div", { className: "ai-tag-list" });
    for (const tag of proposal.proposedTags ?? []) tags.append(node("span", {}, tag.name));
    for (const candidate of proposal.tagCandidates ?? []) tags.append(node("span", {}, `候选：${candidate.name}`));
    copy.append(tags);
    if (proposal.rationale) copy.append(node("p", {}, proposal.rationale));
    copy.append(node("div", { className: "ai-proposal-meta" }, `图片 #${proposal.imageId} · 批次 ${proposal.batchName}${proposal.confidence === null ? "" : ` · 置信度 ${Math.round(proposal.confidence * 100)}%`}`));
    if (proposal.errorMessage) copy.append(node("p", { className: "admin-field-error" }, `${proposal.errorCode || "失败"}：${proposal.errorMessage}`));
    card.append(checkbox, preview, copy); elements.proposals.append(card);
  }
  if (!proposals.length) elements.proposals.append(node("div", { className: "admin-empty" }, "当前没有符合条件的提案。"));
  elements.loadMore.hidden = !page.hasMore; elements.loadMore.disabled = page.loading;
  renderActions();
}

function renderCandidates(candidates) {
  elements.candidates.replaceChildren(); elements.candidateCount.textContent = String(candidates.length);
  for (const candidate of candidates) {
    const item = node("article", { className: "ai-candidate" });
    item.append(node("strong", {}, candidate.name), node("small", {}, `${candidate.groupName} · ${candidate.occurrenceCount} 张图片命中`));
    const actions = node("div", { className: "ai-candidate-actions" });
    const reject = node("button", { type: "button" }, "拒绝"); const approve = node("button", { type: "button", className: "admin-button-primary" }, "创建标签");
    reject.addEventListener("click", () => reviewCandidate(candidate.id, "rejected")); approve.addEventListener("click", () => reviewCandidate(candidate.id, "approved"));
    actions.append(reject, approve); item.append(actions); elements.candidates.append(item);
  }
  if (!candidates.length) elements.candidates.append(node("span", { className: "admin-muted" }, "没有待审核的新标签候选。"));
}

async function loadCandidates() {
  const payload = await client.request("/api/admin/ai/candidates?status=pending&limit=100&offset=0");
  renderCandidates(payload.candidates ?? []);
}

async function loadProposals({ reset = false } = {}) {
  if (page.loading) return; page.loading = true;
  if (reset) { proposals = []; selected.clear(); page.offset = 0; elements.proposals.innerHTML = '<div class="admin-skeleton">正在加载提案...</div>'; }
  try {
    const offset = reset ? 0 : page.nextOffset;
    const payload = await client.request(`/api/admin/ai/proposals?status=${encodeURIComponent(elements.status.value)}&limit=50&offset=${offset}`);
    proposals = [...proposals, ...(payload.proposals ?? [])];
    page = { offset, nextOffset: Number(payload.nextOffset ?? offset + (payload.count ?? 0)), hasMore: Boolean(payload.hasMore), loading: false };
    elements.pendingCount.textContent = String(payload.totalCount ?? proposals.length); renderProposals();
  } catch (error) { page.loading = false; elements.proposals.innerHTML = `<div class="admin-error">${error.message}</div>`; }
}

async function reviewCandidate(candidateId, status) {
  try {
    await client.request("/api/admin/ai/candidates", { method: "PATCH", body: JSON.stringify({ candidateId, status }) });
    notifier.success(status === "approved" ? "标签已创建并关联候选" : "候选已拒绝");
    await Promise.all([loadCandidates(), loadProposals({ reset: true })]);
  } catch (error) { notifier.error(error.message); }
}

async function reviewSelected(status) {
  const ids = proposals.filter((proposal) => selected.has(proposal.id) && proposal.status !== "applied").map((proposal) => proposal.id);
  if (!ids.length) return;
  try {
    await client.request("/api/admin/ai/proposals", { method: "PATCH", body: JSON.stringify({ proposalIds: ids, status }) });
    notifier.success(status === "approved" ? `已通过 ${ids.length} 条提案` : `已拒绝 ${ids.length} 条提案`);
    await loadProposals({ reset: true });
  } catch (error) { notifier.error(error.message); }
}

async function applySelected() {
  const ids = proposals.filter((proposal) => selected.has(proposal.id) && proposal.status === "approved").map((proposal) => proposal.id).slice(0, 20);
  if (!ids.length) return;
  elements.apply.disabled = true;
  try {
    const payload = await client.request("/api/admin/ai/apply", { method: "POST", timeoutMs: 120000, body: JSON.stringify({ proposalIds: ids }) });
    if (payload.failedCount) notifier.error(`${payload.appliedCount} 条已应用，${payload.failedCount} 条失败`);
    else notifier.success(`已原子应用 ${payload.appliedCount} 条提案`);
    await loadProposals({ reset: true });
  } catch (error) { notifier.error(error.message); } finally { renderActions(); }
}

async function authenticate(key) {
  keyStore.set(key); await client.request("/api/admin/tags");
  elements.auth.hidden = true; elements.app.hidden = false;
  await Promise.all([loadCandidates(), loadProposals({ reset: true })]);
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault(); elements.login.disabled = true; elements.error.textContent = "";
  try { await authenticate(elements.key.value.trim()); }
  catch (error) { if (!(error instanceof AdminUnauthorizedError)) showAuth(error.message); }
  finally { elements.login.disabled = false; }
});
elements.logout.addEventListener("click", () => { keyStore.clear(); showAuth(); });
elements.status.addEventListener("change", () => void loadProposals({ reset: true }));
elements.loadMore.addEventListener("click", () => void loadProposals());
elements.approve.addEventListener("click", () => void reviewSelected("approved"));
elements.reject.addEventListener("click", () => void reviewSelected("rejected"));
elements.apply.addEventListener("click", () => void applySelected());

if (keyStore.get()) authenticate(keyStore.get()).catch((error) => { if (!(error instanceof AdminUnauthorizedError)) showAuth(error.message); });
else showAuth();
