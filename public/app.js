"use strict";

const CHECKLIST = [
  { name: "Typography", icon: "clipboard", items: [
    "No default/browser fonts should be used.",
    "Use only 2–3 font families throughout the website.",
    "Post information fonts should be consistent.",
    "Submission success/error message font should match the website font.",
    "Comment section font should match the website typography."
  ]},
  { name: "Layout & Spacing", icon: "globe", items: [
    "Alignment should be consistent, especially in Loop Grid; verify with Figma if needed.",
    "No unnecessary large gaps or empty spaces.",
    "Placeholder spacing from the top should be visually balanced.",
    "No extra left or right spacing on any screen size.",
    "No gap below the footer, including null search pages.",
    "Placeholder text should have proper top spacing.",
    "Divider lines should have consistent thickness."
  ]},
  { name: "UI & Design", icon: "leaf", items: [
    "Date format should be consistent across the website.",
    "Hover effects should be consistent on all Loop Grid items.",
    "Border radius should be consistent across all components.",
    "Images should not appear blurred, pixelated or over-compressed.",
    "All icons and graphics should be visually consistent."
  ]},
  { name: "Functionality", icon: "rotate", items: [
    "No pagination or page limit errors; verify all posts are displayed correctly.",
    "Placeholder text should not contain dummy values such as Lorem Ipsum or Enter Text.",
    "Random search terms should return No Posts Found, not unrelated posts.",
    "Check fetch/loading issues such as API errors, infinite loading or missing content.",
    "Ensure the Table of Contents is activated and displays correctly where required.",
    "Verify pagination works correctly."
  ]},
  { name: "Content", icon: "edit", items: [
    "Category labels should be correct and consistent.",
    "H1 should appear only once per page.",
    "Headings should follow a proper hierarchy: H1, H2, H3 and so on.",
    "There should be no spelling or grammatical mistakes.",
    "There should be no dummy content anywhere on the website."
  ]},
  { name: "Forms", icon: "sign", items: [
    "Form placeholders should be meaningful.",
    "Form success and error messages should display correctly.",
    "Form spacing and alignment should be proper.",
    "Required field validation should work correctly."
  ]},
  { name: "Responsive", icon: "globe", items: [
    "No content should overflow on mobile or tablet.",
    "There should be no horizontal scrolling.",
    "There should be no unwanted spacing on any breakpoint.",
    "Images and sections should scale correctly."
  ]}
];

const TOTAL_CHECKS = CHECKLIST.reduce((sum, category) => sum + category.items.length, 0);
const THEME_KEY = "qagardenThemeV2";
const SELECTED_KEY = "qagardenSelectedProjectV2";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let bootstrap = { setupRequired: true, user: null };
let workspace = { user: null, manager: null, testers: [], projects: [] };
let currentView = "assignments";
let selectedProjectId = sessionStorage.getItem(SELECTED_KEY) || null;
let confirmResolver = null;

function icon(name, className = "") {
  return `<svg class="${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function formatDateTime(value) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function initials(name = "QA") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "QA";
}

function itemKey(categoryIndex, itemIndex) {
  return `c${categoryIndex}_i${itemIndex}`;
}

function projectStats(project) {
  const values = Object.values(project?.checks || {});
  const checked = values.filter(Boolean).length;
  return {
    total: TOTAL_CHECKS,
    checked,
    unchecked: TOTAL_CHECKS - checked,
    percent: Math.round((checked / TOTAL_CHECKS) * 100)
  };
}

function categoryStats(project, categoryIndex) {
  const category = CHECKLIST[categoryIndex];
  const checked = category.items.filter((_, itemIndex) => Boolean(project?.checks?.[itemKey(categoryIndex, itemIndex)])).length;
  return { checked, total: category.items.length };
}

function isManager() {
  return workspace.user?.role === "manager";
}

function visibleProjects() {
  return workspace.projects || [];
}

function selectedProject() {
  return visibleProjects().find((project) => project.id === selectedProjectId) || null;
}

function ensureSelectedProject() {
  const projects = visibleProjects();
  if (!projects.some((project) => project.id === selectedProjectId)) {
    selectedProjectId = projects[0]?.id || null;
    if (selectedProjectId) sessionStorage.setItem(SELECTED_KEY, selectedProjectId);
    else sessionStorage.removeItem(SELECTED_KEY);
  }
}

function getTester(id) {
  return workspace.testers.find((tester) => tester.id === id) || null;
}

function getAssignee(project) {
  if (project.assigneeType === "manager") {
    return { name: workspace.manager?.name || "QA Manager", email: workspace.manager?.email || "", role: "QA Manager" };
  }
  const tester = getTester(project.testerId);
  return tester
    ? { name: tester.name, email: tester.email, role: "QA Tester" }
    : { name: "Unassigned", email: "", role: "QA Tester" };
}

function projectStatus(project) {
  const stats = projectStats(project);
  if (project.signoff) return { label: "Signed off", className: "complete", icon: "check" };
  if (stats.checked > 0) return { label: "In progress", className: "in-progress", icon: "rotate" };
  return { label: "Not started", className: "not-started", icon: "clipboard" };
}

function toast(message, type = "") {
  const element = document.createElement("div");
  element.className = `toast ${type}`;
  element.textContent = message;
  $("#toastRegion").append(element);
  setTimeout(() => element.remove(), 3400);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "same-origin"
  });

  if (response.status === 204) return null;
  let payload = {};
  try { payload = await response.json(); } catch { payload = {}; }

  if (!response.ok) {
    if (response.status === 401 && !path.includes("/login")) {
      workspace = { user: null, manager: null, testers: [], projects: [] };
      bootstrap.user = null;
      showAuth();
    }
    throw new Error(payload.error || "Something went wrong.");
  }
  return payload;
}

function applyTheme() {
  const theme = localStorage.getItem(THEME_KEY) || "light";
  document.body.classList.toggle("dark", theme === "dark");
  const button = $("#themeToggle");
  if (button) button.innerHTML = `${icon(theme === "dark" ? "sun" : "moon")}<span>${theme === "dark" ? "Light theme" : "Dark theme"}</span>`;
}

function toggleTheme() {
  const next = document.body.classList.contains("dark") ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme();
}

async function setupApp() {
  applyTheme();
  bindEvents();
  try {
    bootstrap = await api("/api/bootstrap");
    if (bootstrap.user) await showApp();
    else showAuth();
  } catch (error) {
    toast(error.message, "error");
    showAuth();
  }
}

function bindEvents() {
  $("#setupForm").addEventListener("submit", handleManagerSetup);
  $("#loginForm").addEventListener("submit", handleLogin);
  $("#logoutButton").addEventListener("click", handleLogout);
  $("#themeToggle").addEventListener("click", toggleTheme);
  $("#menuButton").addEventListener("click", () => $("#sidebar").classList.add("open"));
  $("#sidebarClose").addEventListener("click", () => $("#sidebar").classList.remove("open"));
  $("#projectForm").addEventListener("submit", saveProject);
  $("#testerForm").addEventListener("submit", saveTester);
  $("#signoffForm").addEventListener("submit", submitSignoff);
  $("#confirmDialog").addEventListener("close", () => {
    if (confirmResolver) {
      confirmResolver($("#confirmDialog").returnValue === "confirm");
      confirmResolver = null;
    }
  });
  document.addEventListener("click", handleClick);
  document.addEventListener("change", handleChange);
}

function showAuth() {
  $("#appShell").classList.add("is-hidden");
  $("#authScreen").classList.remove("is-hidden");
  const firstRun = Boolean(bootstrap.setupRequired);
  $("#setupView").classList.toggle("is-hidden", !firstRun);
  $("#loginView").classList.toggle("is-hidden", firstRun);
  setTimeout(() => $(firstRun ? "#setupName" : "#loginEmail")?.focus(), 120);
}

async function handleManagerSetup(event) {
  event.preventDefault();
  const password = $("#setupPassword").value;
  const confirmation = $("#setupConfirm").value;
  if (password !== confirmation) return toast("Passwords do not match.", "error");

  const submit = event.submitter;
  submit.disabled = true;
  submit.textContent = "Creating secure workspace…";
  try {
    const result = await api("/api/setup", {
      method: "POST",
      body: {
        name: $("#setupName").value.trim(),
        email: $("#setupEmail").value.trim(),
        password
      }
    });
    bootstrap = { setupRequired: false, user: result.user };
    currentView = "assignments";
    await showApp();
    toast("Manager workspace created successfully.", "success");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    submit.disabled = false;
    submit.innerHTML = `<span>Create manager workspace</span>${icon("arrow")}`;
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const submit = event.submitter;
  submit.disabled = true;
  submit.textContent = "Verifying account…";
  try {
    const result = await api("/api/login", {
      method: "POST",
      body: {
        email: $("#loginEmail").value.trim(),
        password: $("#loginPassword").value
      }
    });
    bootstrap = { setupRequired: false, user: result.user };
    currentView = result.user.role === "manager" ? "assignments" : "checklist";
    $("#loginForm").reset();
    await showApp();
    toast(`Welcome back, ${result.user.name}.`, "success");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    submit.disabled = false;
    submit.innerHTML = `<span>Enter QAGarden</span>${icon("arrow")}`;
  }
}

async function handleLogout() {
  try { await api("/api/logout", { method: "POST" }); } catch {}
  bootstrap.user = null;
  workspace = { user: null, manager: null, testers: [], projects: [] };
  $("#appShell").classList.add("is-hidden");
  showAuth();
}

async function loadWorkspace() {
  workspace = await api("/api/workspace");
  bootstrap.user = workspace.user;
  ensureSelectedProject();
}

async function showApp() {
  await loadWorkspace();
  const user = workspace.user;
  if (!user) return showAuth();

  $("#authScreen").classList.add("is-hidden");
  $("#appShell").classList.remove("is-hidden");
  $("#profileName").textContent = user.name;
  $("#profileRole").textContent = isManager() ? "QA Manager" : "QA Tester";
  $("#profileAvatar").textContent = initials(user.name);
  $("#topbarRoleBadge").innerHTML = `${icon(isManager() ? "shield" : "check")} ${isManager() ? "Manager access" : "Tester access"}`;
  if (!allowedViews().includes(currentView)) currentView = isManager() ? "assignments" : "checklist";
  renderView(currentView);
  applyTheme();
}

function allowedViews() {
  return isManager() ? ["assignments", "checklist", "signoff", "testers"] : ["checklist", "signoff"];
}

function renderNavigation() {
  const items = isManager()
    ? [
        { id: "assignments", icon: "clipboard", label: "Audit assignments" },
        { id: "checklist", icon: "check", label: "Test audits" },
        { id: "signoff", icon: "sign", label: "Manager sign-off" },
        { id: "testers", icon: "users", label: "Tester accounts" }
      ]
    : [
        { id: "checklist", icon: "check", label: "Checklist" },
        { id: "signoff", icon: "sign", label: "Sign-off" }
      ];

  $("#sidebarNav").innerHTML = items.map((item) => `
    <button class="nav-button ${currentView === item.id ? "active" : ""}" data-view="${item.id}">
      <span class="nav-icon">${icon(item.icon)}</span><span>${item.label}</span>
    </button>
  `).join("");
}

function renderView(view) {
  if (!allowedViews().includes(view)) view = allowedViews()[0];
  currentView = view;
  renderNavigation();

  const meta = {
    assignments: ["Management", "Audit assignments"],
    testers: ["Access control", "Tester accounts"],
    checklist: [isManager() ? "Manager testing" : "Testing", isManager() ? "Test website audits" : "Website checklist"],
    signoff: ["Approval", isManager() ? "Manager sign-off" : "Final sign-off"]
  }[view];
  $("#pageEyebrow").textContent = meta[0];
  $("#pageTitle").textContent = meta[1];

  if (view === "assignments") renderAssignments();
  if (view === "testers") renderTesters();
  if (view === "checklist") renderChecklist();
  if (view === "signoff") renderSignoff();
  renderSidebarProject();
}

function renderSidebarProject() {
  const container = $("#sidebarProject");
  if (!container || $("#appShell").classList.contains("is-hidden")) return;
  const project = selectedProject();
  if (!project) {
    container.innerHTML = `<div class="sidebar-card"><span class="mini-label">${isManager() ? "Manager testing" : "Assignment"}</span><strong>No audit selected</strong></div>`;
    return;
  }
  const stats = projectStats(project);
  container.innerHTML = `
    <div class="sidebar-card">
      <span class="mini-label">${isManager() ? "Selected audit" : "Current audit"}</span>
      <strong>${escapeHtml(project.name)}</strong>
      <div class="mini-progress"><span style="width:${stats.percent}%"></span></div>
      <span class="mini-label" style="display:block;margin-top:8px">${stats.checked}/${stats.total} checked</span>
    </div>`;
}

function renderAssignments() {
  const projects = workspace.projects;
  const signed = projects.filter((project) => project.signoff).length;
  const active = projects.length - signed;
  const average = projects.length
    ? Math.round(projects.reduce((sum, project) => sum + projectStats(project).percent, 0) / projects.length)
    : 0;

  $("#viewContainer").innerHTML = `
    <div class="view-head">
      <div><h2>Manage and test website audits</h2><p>Assign audits by tester email, monitor progress or open any audit and test it yourself.</p></div>
      <div class="view-actions">
        <button class="btn btn-muted" data-action="new-tester">${icon("users")} Add tester</button>
        <button class="btn btn-primary" data-action="new-project">${icon("plus")} Assign project</button>
      </div>
    </div>
    <div class="stats-grid">
      ${statCard("clipboard", projects.length, "Total assignments")}
      ${statCard("rotate", active, "In progress")}
      ${statCard("check", signed, "Signed off")}
      ${statCard("leaf", `${average}%`, "Average completion")}
    </div>
    ${projects.length ? `<div class="project-grid">${projects.map(managerProjectCard).join("")}</div>` : assignmentEmptyState()}
  `;
}

function statCard(iconName, value, label) {
  return `<article class="stat-card"><span class="stat-icon">${icon(iconName)}</span><strong>${value}</strong><span>${label}</span></article>`;
}

function managerProjectCard(project) {
  const assignee = getAssignee(project);
  const stats = projectStats(project);
  const status = projectStatus(project);
  return `
    <article class="project-card">
      <div class="project-card-head">
        <div class="project-title-wrap">
          <span class="project-icon">${icon("globe")}</span>
          <div><h3>${escapeHtml(project.name)}</h3><a class="project-url" href="${escapeHtml(project.url)}" target="_blank" rel="noopener">${escapeHtml(project.url)}</a></div>
        </div>
        <span class="status-pill ${status.className}">${icon(status.icon)} ${status.label}</span>
      </div>
      <div class="project-meta">
        <div class="meta-box"><span>${icon("users")} Assigned to</span><strong>${escapeHtml(assignee.name)}</strong><small>${escapeHtml(assignee.email || assignee.role)}</small></div>
        <div class="meta-box"><span>${icon("calendar")} Due date</span><strong>${formatDate(project.dueDate)}</strong></div>
      </div>
      <div class="progress-row"><span>Checklist progress</span><strong>${stats.checked}/${stats.total} · ${stats.percent}%</strong></div>
      <div class="progress-track"><span style="width:${stats.percent}%"></span></div>
      <div class="card-actions">
        <button class="btn btn-primary btn-small" data-action="test-project" data-id="${project.id}">${icon("check")} Test audit</button>
        <a class="btn btn-ghost btn-small" href="${escapeHtml(project.url)}" target="_blank" rel="noopener">${icon("link")} Open site</a>
        <button class="btn btn-ghost btn-small" data-action="edit-project" data-id="${project.id}">${icon("edit")} Edit</button>
        ${project.signoff ? `<button class="btn btn-ghost btn-small" data-action="reopen-project" data-id="${project.id}">${icon("rotate")} Reopen</button>` : ""}
        <button class="btn btn-ghost btn-small danger" data-action="delete-project" data-id="${project.id}">${icon("trash")} Delete</button>
      </div>
    </article>`;
}

function assignmentEmptyState() {
  return `
    <div class="empty-state">
      <span class="empty-art">${icon("clipboard")}</span>
      <h3>No audit assigned yet</h3>
      <p>Create a tester using an email address, or assign the first audit to yourself as manager.</p>
      <button class="btn btn-primary" data-action="new-project">${icon("plus")} Assign first project</button>
    </div>`;
}

function renderTesters() {
  const testers = workspace.testers;
  $("#viewContainer").innerHTML = `
    <div class="view-head">
      <div><h2>Tester email accounts</h2><p>Create tester access using a unique email address and temporary password.</p></div>
      <div class="view-actions"><button class="btn btn-primary" data-action="new-tester">${icon("plus")} Add tester</button></div>
    </div>
    ${testers.length ? `
      <div class="table-card">
        <table class="data-table">
          <thead><tr><th>Tester</th><th>Email address</th><th>Assigned audits</th><th>Created</th><th style="text-align:right">Actions</th></tr></thead>
          <tbody>${testers.map(testerRow).join("")}</tbody>
        </table>
      </div>` : testerEmptyState()}
  `;
}

function testerRow(tester) {
  const assignmentCount = workspace.projects.filter((project) => project.assigneeType === "tester" && project.testerId === tester.id).length;
  return `
    <tr>
      <td><div class="user-cell"><span class="avatar">${initials(tester.name)}</span><div><strong>${escapeHtml(tester.name)}</strong><small>QA Tester</small></div></div></td>
      <td><strong>${escapeHtml(tester.email)}</strong></td>
      <td>${assignmentCount}</td>
      <td>${formatDateTime(tester.createdAt)}</td>
      <td><div class="table-actions"><button class="table-icon" data-action="edit-tester" data-id="${tester.id}" aria-label="Edit tester">${icon("edit")}</button><button class="table-icon danger" data-action="delete-tester" data-id="${tester.id}" aria-label="Delete tester">${icon("trash")}</button></div></td>
    </tr>`;
}

function testerEmptyState() {
  return `
    <div class="empty-state">
      <span class="empty-art">${icon("users")}</span>
      <h3>No tester account yet</h3>
      <p>Add a tester with their email address. They will only see audits assigned to that account.</p>
      <button class="btn btn-primary" data-action="new-tester">${icon("plus")} Add tester</button>
    </div>`;
}

function renderChecklist() {
  const projects = visibleProjects();
  ensureSelectedProject();
  const project = selectedProject();
  if (!projects.length || !project) {
    $("#viewContainer").innerHTML = noProjectState();
    return;
  }

  const stats = projectStats(project);
  $("#viewContainer").innerHTML = `
    ${projects.length > 1 ? auditSwitcher(projects, project.id) : ""}
    <section class="audit-hero">
      <div>
        <span class="eyebrow">${isManager() ? "Manager testing mode" : "Assigned website audit"}</span>
        <h2>${escapeHtml(project.name)}</h2>
        <p>${escapeHtml(project.notes || "Check every point carefully before submitting final sign-off.")}</p>
        <div class="audit-hero-meta">
          <a class="hero-chip" href="${escapeHtml(project.url)}" target="_blank" rel="noopener">${icon("link")} Open website</a>
          <span class="hero-chip">${icon("calendar")} Due ${formatDate(project.dueDate)}</span>
          ${project.signoff ? `<span class="hero-chip">${icon("check")} Signed ${formatDateTime(project.signoff.signedAt)}</span>` : ""}
        </div>
      </div>
      <div class="progress-ring" data-progress-ring style="--progress:${stats.percent}"><div><strong data-progress-percent>${stats.percent}%</strong><small data-progress-count>${stats.checked}/${stats.total} checked</small></div></div>
    </section>
    <div class="checklist-layout">
      <nav class="category-nav" aria-label="Checklist categories">
        ${CHECKLIST.map((category, index) => {
          const progress = categoryStats(project, index);
          return `<button class="category-link" data-action="scroll-category" data-category="${index}"><span>${escapeHtml(category.name)}</span><span data-category-count="${index}">${progress.checked}/${progress.total}</span></button>`;
        }).join("")}
      </nav>
      <div class="checklist-content">
        ${CHECKLIST.map((category, categoryIndex) => checklistCategory(project, category, categoryIndex)).join("")}
      </div>
    </div>`;
}

function auditSwitcher(projects, activeId) {
  return `
    <div class="audit-switcher" aria-label="Website audits">
      ${projects.map((project) => {
        const stats = projectStats(project);
        return `<button class="audit-pill ${project.id === activeId ? "active" : ""}" data-action="select-project" data-id="${project.id}"><span class="audit-pill-icon">${icon("globe")}</span><span><strong>${escapeHtml(project.name)}</strong><small>${stats.percent}% complete</small></span></button>`;
      }).join("")}
    </div>`;
}

function checklistCategory(project, category, categoryIndex) {
  const progress = categoryStats(project, categoryIndex);
  let runningNumber = CHECKLIST.slice(0, categoryIndex).reduce((sum, item) => sum + item.items.length, 0);
  return `
    <section id="category-${categoryIndex}" class="check-category">
      <div class="category-head"><h3>${escapeHtml(category.name)}</h3><span data-category-heading-count="${categoryIndex}">${progress.checked}/${progress.total} checked</span></div>
      <div class="check-list">
        ${category.items.map((item, itemIndex) => {
          const key = itemKey(categoryIndex, itemIndex);
          const checked = Boolean(project.checks?.[key]);
          const meta = project.checkMeta?.[key];
          const locked = Boolean(project.signoff);
          runningNumber += 1;
          const detail = checked
            ? meta ? `Checked by ${escapeHtml(meta.name)} · ${meta.role === "manager" ? "Manager" : "Tester"}` : "Checked"
            : "Not checked";
          return `
            <label class="check-item ${checked ? "checked" : ""} ${locked ? "locked" : ""}" data-check-item="${key}">
              <span class="check-number">${String(runningNumber).padStart(2, "0")}</span>
              <span class="check-copy"><strong>${escapeHtml(item)}</strong><small>${detail}</small></span>
              <span class="check-control"><input type="checkbox" data-check-key="${key}" data-category-index="${categoryIndex}" ${checked ? "checked" : ""} ${locked ? "disabled" : ""} /><span class="check-toggle"></span></span>
            </label>`;
        }).join("")}
      </div>
    </section>`;
}

function noProjectState() {
  return `
    <div class="empty-state">
      <span class="empty-art">${icon("clipboard")}</span>
      <h3>${isManager() ? "No audit available" : "No audit assigned"}</h3>
      <p>${isManager() ? "Create an audit assignment, then open it here for manager testing." : "Your manager has not assigned a website audit to this email account yet."}</p>
      ${isManager() ? `<button class="btn btn-primary" data-action="new-project">${icon("plus")} Assign an audit</button>` : ""}
    </div>`;
}

function renderSignoff() {
  const projects = visibleProjects();
  ensureSelectedProject();
  const project = selectedProject();
  if (!projects.length || !project) {
    $("#viewContainer").innerHTML = noProjectState();
    return;
  }

  const stats = projectStats(project);
  const complete = stats.checked === stats.total;
  const actorLabel = isManager() ? "QA Manager" : "QA Tester";
  $("#viewContainer").innerHTML = `
    ${projects.length > 1 ? auditSwitcher(projects, project.id) : ""}
    <div class="signoff-grid">
      <section class="signoff-card">
        <span class="eyebrow">${isManager() ? "Manager QA confirmation" : "Final QA confirmation"}</span>
        <h2>${escapeHtml(project.name)}</h2>
        <p>Sign-off becomes available only after every checklist point has been checked.</p>
        <div class="requirement-list">
          <div class="requirement-item done"><span class="requirement-icon">${icon(isManager() ? "shield" : "users")}</span><div><strong>Signed-in reviewer</strong><small>${escapeHtml(workspace.user.name)} · ${actorLabel}</small></div></div>
          <div class="requirement-item ${complete ? "done" : ""}"><span class="requirement-icon">${icon(complete ? "check" : "clipboard")}</span><div><strong>All checklist points completed</strong><small>${stats.checked} of ${stats.total} checked</small></div></div>
          <div class="requirement-item ${project.signoff ? "done" : ""}"><span class="requirement-icon">${icon(project.signoff ? "check" : "sign")}</span><div><strong>Final confirmation</strong><small>${project.signoff ? `Submitted ${formatDateTime(project.signoff.signedAt)}` : "Not submitted"}</small></div></div>
        </div>
        ${project.signoff
          ? signedDetails(project)
          : complete
            ? `<div class="note-box">All checklist points are complete. Submit the final confirmation when your review is finished.</div>`
            : `<div class="note-box">Complete the remaining ${stats.unchecked} point${stats.unchecked === 1 ? "" : "s"} before signing off.</div>`}
      </section>
      <section class="signoff-card signoff-visual">
        <div>
          <div class="progress-ring big-ring" style="--progress:${stats.percent}"><div><strong>${stats.percent}%</strong><small>${stats.checked}/${stats.total} checked</small></div></div>
          <h3>${project.signoff ? "Audit signed off" : complete ? "Ready for sign-off" : "Checklist incomplete"}</h3>
          <p>${project.signoff ? "The checklist is locked. The manager can reopen it when another review is required." : complete ? "All checks are complete. Submit your final confirmation now." : "Return to the checklist and complete every remaining point."}</p>
          ${project.signoff ? "" : `<button class="btn btn-primary" data-action="open-signoff" ${complete ? "" : "disabled"}>${icon("sign")} Submit sign-off</button>`}
        </div>
      </section>
    </div>`;
}

function signedDetails(project) {
  const role = project.signoff.signedByRole === "manager" ? "QA Manager" : "QA Tester";
  return `
    <div class="signed-banner">
      <span class="signed-banner-icon">${icon("check")}</span>
      <div><h3>Signed by ${escapeHtml(project.signoff.signedByName)}</h3><p>${role} · ${formatDateTime(project.signoff.signedAt)}</p></div>
    </div>
    ${project.signoff.note ? `<div class="note-box"><strong>Final note:</strong><br>${escapeHtml(project.signoff.note)}</div>` : ""}`;
}

function handleClick(event) {
  const passwordToggle = event.target.closest("[data-toggle-password]");
  if (passwordToggle) return togglePassword(passwordToggle);

  const nav = event.target.closest("[data-view]");
  if (nav) {
    renderView(nav.dataset.view);
    $("#sidebar").classList.remove("open");
    return;
  }

  if (event.target.closest("[data-home]")) return renderView(isManager() ? "assignments" : "checklist");
  if (event.target.closest("[data-close-project]")) return $("#projectDialog").close();
  if (event.target.closest("[data-close-tester]")) return $("#testerDialog").close();
  if (event.target.closest("[data-close-signoff]")) return $("#signoffDialog").close();

  const action = event.target.closest("[data-action]");
  if (!action) return;
  const name = action.dataset.action;
  const id = action.dataset.id;

  if (name === "new-project") openProjectDialog();
  if (name === "edit-project") openProjectDialog(id);
  if (name === "delete-project") deleteProject(id);
  if (name === "reopen-project") reopenProject(id);
  if (name === "test-project") testProject(id);
  if (name === "new-tester") openTesterDialog();
  if (name === "edit-tester") openTesterDialog(id);
  if (name === "delete-tester") deleteTester(id);
  if (name === "select-project") selectProject(id);
  if (name === "scroll-category") document.getElementById(`category-${action.dataset.category}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  if (name === "open-signoff") openSignoffDialog();
}

async function handleChange(event) {
  if (!event.target.matches("[data-check-key]")) return;
  const project = selectedProject();
  if (!project || project.signoff) return;

  const input = event.target;
  const original = !input.checked;
  input.disabled = true;
  try {
    const result = await api(`/api/projects/${encodeURIComponent(project.id)}/checks/${encodeURIComponent(input.dataset.checkKey)}`, {
      method: "PATCH",
      body: { checked: input.checked }
    });
    replaceProject(result.project);
    renderChecklist();
    const stats = projectStats(result.project);
    if (stats.checked === stats.total) toast("All checklist points are complete. Sign-off is now available.", "success");
  } catch (error) {
    input.checked = original;
    toast(error.message, "error");
  } finally {
    input.disabled = false;
  }
}

function togglePassword(button) {
  const input = document.getElementById(button.dataset.togglePassword);
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  button.innerHTML = icon(show ? "eye-off" : "eye");
  button.setAttribute("aria-label", show ? "Hide password" : "Show password");
}

function defaultDueDate() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date.toISOString().slice(0, 10);
}

function openProjectDialog(projectId = null) {
  const project = projectId ? workspace.projects.find((item) => item.id === projectId) : null;
  $("#projectDialogTitle").textContent = project ? "Edit assignment" : "Assign new project";
  $("#projectId").value = project?.id || "";
  $("#projectName").value = project?.name || "";
  $("#projectUrl").value = project?.url || "";
  $("#projectDueDate").value = project?.dueDate || defaultDueDate();
  $("#projectNotes").value = project?.notes || "";
  const managerSelected = project?.assigneeType === "manager" || (!project && workspace.testers.length === 0);
  $("#projectTester").innerHTML = `
    <option value="manager" ${managerSelected ? "selected" : ""}>${escapeHtml(workspace.manager?.name || "Manager")} · Manager self-testing</option>
    ${workspace.testers.map((tester) => `<option value="tester:${tester.id}" ${project?.assigneeType === "tester" && project.testerId === tester.id ? "selected" : ""}>${escapeHtml(tester.name)} · ${escapeHtml(tester.email)}</option>`).join("")}`;
  $("#projectDialog").showModal();
  setTimeout(() => $("#projectName").focus(), 80);
}

async function saveProject(event) {
  event.preventDefault();
  const id = $("#projectId").value;
  const assigneeValue = $("#projectTester").value;
  const payload = {
    name: $("#projectName").value.trim(),
    url: $("#projectUrl").value.trim(),
    dueDate: $("#projectDueDate").value,
    notes: $("#projectNotes").value.trim(),
    assigneeType: assigneeValue === "manager" ? "manager" : "tester",
    testerId: assigneeValue.startsWith("tester:") ? assigneeValue.slice(7) : null
  };

  const submit = event.submitter;
  submit.disabled = true;
  submit.textContent = "Saving…";
  try {
    const result = await api(id ? `/api/projects/${encodeURIComponent(id)}` : "/api/projects", {
      method: id ? "PUT" : "POST",
      body: payload
    });
    if (id) replaceProject(result.project);
    else workspace.projects.unshift(result.project);
    selectedProjectId = result.project.id;
    sessionStorage.setItem(SELECTED_KEY, selectedProjectId);
    $("#projectDialog").close();
    renderView("assignments");
    toast(id ? "Assignment updated." : "Project assigned successfully.", "success");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    submit.disabled = false;
    submit.textContent = "Save assignment";
  }
}

async function deleteProject(projectId) {
  const project = workspace.projects.find((item) => item.id === projectId);
  if (!project) return;
  const confirmed = await askConfirm("Delete assignment?", `This will permanently remove “${project.name}” and all checklist progress.`, "Delete assignment");
  if (!confirmed) return;
  try {
    await api(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
    workspace.projects = workspace.projects.filter((item) => item.id !== projectId);
    if (selectedProjectId === projectId) {
      selectedProjectId = workspace.projects[0]?.id || null;
      if (selectedProjectId) sessionStorage.setItem(SELECTED_KEY, selectedProjectId);
      else sessionStorage.removeItem(SELECTED_KEY);
    }
    renderView("assignments");
    toast("Assignment deleted.", "success");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function reopenProject(projectId) {
  const project = workspace.projects.find((item) => item.id === projectId);
  if (!project?.signoff) return;
  const confirmed = await askConfirm("Reopen signed audit?", "The checklist will become editable again. Existing checked points will remain selected.", "Reopen audit");
  if (!confirmed) return;
  try {
    const result = await api(`/api/projects/${encodeURIComponent(projectId)}/reopen`, { method: "POST" });
    replaceProject(result.project);
    renderView(currentView);
    toast("Audit reopened.", "success");
  } catch (error) {
    toast(error.message, "error");
  }
}

function testProject(projectId) {
  selectProject(projectId, false);
  renderView("checklist");
}

function openTesterDialog(testerId = null) {
  const tester = testerId ? workspace.testers.find((item) => item.id === testerId) : null;
  $("#testerDialogTitle").textContent = tester ? "Edit tester access" : "Add tester account";
  $("#testerId").value = tester?.id || "";
  $("#testerName").value = tester?.name || "";
  $("#testerEmail").value = tester?.email || "";
  $("#testerPassword").value = "";
  $("#testerPassword").required = !tester;
  $("#testerPasswordLabel").textContent = tester ? "New password (optional)" : "Temporary password";
  $("#testerPasswordHelp").textContent = tester ? "Leave blank to keep the existing password." : "Required for a new tester. Minimum 8 characters.";
  $("#testerDialog").showModal();
  setTimeout(() => $("#testerName").focus(), 80);
}

async function saveTester(event) {
  event.preventDefault();
  const id = $("#testerId").value;
  const payload = {
    name: $("#testerName").value.trim(),
    email: $("#testerEmail").value.trim(),
    password: $("#testerPassword").value
  };
  const submit = event.submitter;
  submit.disabled = true;
  submit.textContent = "Saving…";
  try {
    const result = await api(id ? `/api/testers/${encodeURIComponent(id)}` : "/api/testers", {
      method: id ? "PUT" : "POST",
      body: payload
    });
    const tester = result.tester;
    const index = workspace.testers.findIndex((item) => item.id === tester.id);
    if (index >= 0) workspace.testers[index] = tester;
    else workspace.testers.push(tester);
    $("#testerDialog").close();
    renderView("testers");
    toast(id ? "Tester access updated." : "Tester account created. Share the temporary password securely.", "success");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    submit.disabled = false;
    submit.textContent = "Save tester";
  }
}

async function deleteTester(testerId) {
  const tester = getTester(testerId);
  if (!tester) return;
  const confirmed = await askConfirm("Delete tester account?", `This will remove login access for ${tester.name}.`, "Delete tester");
  if (!confirmed) return;
  try {
    await api(`/api/testers/${encodeURIComponent(testerId)}`, { method: "DELETE" });
    workspace.testers = workspace.testers.filter((item) => item.id !== testerId);
    renderView("testers");
    toast("Tester account deleted.", "success");
  } catch (error) {
    toast(error.message, "error");
  }
}

function selectProject(projectId, rerender = true) {
  if (!visibleProjects().some((project) => project.id === projectId)) return;
  selectedProjectId = projectId;
  sessionStorage.setItem(SELECTED_KEY, projectId);
  if (rerender) renderView(currentView);
}

function replaceProject(project) {
  const index = workspace.projects.findIndex((item) => item.id === project.id);
  if (index >= 0) workspace.projects[index] = project;
  else workspace.projects.unshift(project);
}

function openSignoffDialog() {
  const project = selectedProject();
  if (!project) return;
  const stats = projectStats(project);
  if (project.signoff) return toast("This audit is already signed off.", "error");
  if (stats.checked !== stats.total) return toast("Complete every checklist point before sign-off.", "error");
  $("#signoffSummary").innerHTML = `<strong>${escapeHtml(project.name)}</strong><small>${stats.checked}/${stats.total} checks completed · ${escapeHtml(project.url)}</small>`;
  $("#signoffNote").value = "";
  $("#signoffConfirm").checked = false;
  $("#signoffDialog").showModal();
}

async function submitSignoff(event) {
  event.preventDefault();
  const project = selectedProject();
  if (!project) return;
  if (!$("#signoffConfirm").checked) return toast("Please confirm the sign-off statement.", "error");
  const submit = event.submitter;
  submit.disabled = true;
  submit.textContent = "Submitting…";
  try {
    const result = await api(`/api/projects/${encodeURIComponent(project.id)}/signoff`, {
      method: "POST",
      body: { note: $("#signoffNote").value.trim() }
    });
    replaceProject(result.project);
    $("#signoffDialog").close();
    renderView("signoff");
    toast("QA sign-off submitted successfully.", "success");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    submit.disabled = false;
    submit.textContent = "Complete sign-off";
  }
}

function askConfirm(title, message, buttonText) {
  $("#confirmTitle").textContent = title;
  $("#confirmMessage").textContent = message;
  $("#confirmAction").textContent = buttonText;
  $("#confirmDialog").showModal();
  return new Promise((resolve) => { confirmResolver = resolve; });
}

setupApp();
