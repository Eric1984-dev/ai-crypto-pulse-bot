const currentPath = window.location.pathname.replace(/\/+$/, "") || "/";
const currentPage = currentPath === "/"
  ? "/index.html"
  : currentPath.endsWith(".html")
    ? currentPath
    : `${currentPath}.html`;

for (const link of document.querySelectorAll("[data-nav-link]")) {
  if (link.pathname === currentPage) {
    link.setAttribute("aria-current", "page");
  }
}

const currentYear = document.querySelector("[data-current-year]");
if (currentYear) {
  currentYear.textContent = String(new Date().getFullYear());
}
