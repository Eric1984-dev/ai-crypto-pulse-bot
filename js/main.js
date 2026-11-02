const currentPath = window.location.pathname.replace(/\/+$/, "") || "/";
const currentPage = currentPath === "/"
  ? "/index.html"
  : currentPath.endsWith(".html")
    ? currentPath
    : `${currentPath}.html`;
const navigationScrollKey = "cryptopulse:navigation-target";

for (const link of document.querySelectorAll("[data-nav-link]")) {
  if (link.pathname === currentPage) {
    link.setAttribute("aria-current", "page");
  }
  link.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0
      || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || (link.target && link.target !== "_self")) {
      return;
    }

    const targetPath = link.pathname.replace(/\/+$/, "") || "/";
    if (targetPath === currentPage) {
      event.preventDefault();
      const dropdown = link.closest(".nav-dropdown");
      if (dropdown) {
        dropdown.open = false;
      }
      window.scrollTo(0, 0);
      return;
    }
    try {
      window.sessionStorage.setItem(navigationScrollKey, targetPath);
    } catch {
      return;
    }
  });
}

document.addEventListener("click", (event) => {
  for (const dropdown of document.querySelectorAll(".nav-dropdown[open]")) {
    if (!dropdown.contains(event.target)) {
      dropdown.open = false;
    }
  }
});

window.addEventListener("pageshow", () => {
  let targetPath;
  try {
    targetPath = window.sessionStorage.getItem(navigationScrollKey);
    window.sessionStorage.removeItem(navigationScrollKey);
  } catch {
    return;
  }
  if (targetPath !== currentPage) {
    return;
  }
  window.requestAnimationFrame(() => window.scrollTo(0, 0));
});

const currentYear = document.querySelector("[data-current-year]");
if (currentYear) {
  currentYear.textContent = String(new Date().getFullYear());
}
