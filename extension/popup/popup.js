document.getElementById("open-demo")?.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL("demo/index.html") });
});
