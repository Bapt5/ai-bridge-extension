// AI Bridge — Background Script

browser.runtime.onInstalled.addListener(() => {
  console.log("AI Bridge installed.");
});

// Firefox ne permet pas navigator.clipboard dans les popups sans interaction directe.
// On passe par le background qui peut exécuter du JS dans la page active via executeScript.
browser.runtime.onMessage.addListener((request) => {
  if (request.action === 'copyToClipboard') {
    const text = request.text;
    // Inject a script into the active tab to copy via the page's clipboard API
    return browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (!tabs[0]) return { success: false, error: 'No active tab' };
      return browser.tabs.executeScript(tabs[0].id, {
        code: `
          (function() {
            try {
              const ta = document.createElement('textarea');
              ta.value = ${JSON.stringify(text)};
              ta.style.position = 'fixed';
              ta.style.opacity = '0';
              document.body.appendChild(ta);
              ta.focus();
              ta.select();
              const ok = document.execCommand('copy');
              document.body.removeChild(ta);
              return ok;
            } catch(e) { return false; }
          })()
        `
      }).then((results) => {
        return { success: !!(results && results[0]) };
      });
    }).catch((err) => {
      return { success: false, error: err.message };
    });
  }
});

