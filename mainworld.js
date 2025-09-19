(() => {
    if (window.__cnp_main_hook_installed) return;
    window.__cnp_main_hook_installed = true;

    // Track last user gesture
    let lastClickTarget = null;
    let lastClickTime = 0;
    document.addEventListener("pointerdown", e => {
        lastClickTarget = e.target;
        lastClickTime = Date.now();
    }, true);

    // Utility: mark an input with a token
    function markInput(input) {
        const token = "cnp_" + Math.random().toString(36).slice(2, 9);
        input.setAttribute("data-cnp-ext", token);
        setTimeout(() => {
            if (input.getAttribute("data-cnp-ext") === token) {
                input.removeAttribute("data-cnp-ext");
            }
        }, 5000);
        return token;
    }

    // Try to find a nearby <input type=file>
    function findNearbyInput() {
        if (!lastClickTarget) return null;
        let el = lastClickTarget;
        for (let i = 0; i < 4 && el; i++) {
            const found = el.querySelector?.("input[type=file]");
            if (found) return found;
            el = el.parentElement;
        }
        return null;
    }

    // Intercept File System Access API
    ["showOpenFilePicker", "showSaveFilePicker", "showDirectoryPicker"]
        .forEach(name => {
            if (!(name in window)) return;
            const orig = window[name];
            window[name] = async function (...args) {
                try {
                    // only react if called shortly after a user gesture
                    if (Date.now() - lastClickTime < 1000) {
                        const input = findNearbyInput() ||
                            document.querySelector("input[type=file]");
                        if (input) {
                            const token = markInput(input);
                            window.dispatchEvent(new CustomEvent("overlay-request", { detail: { tempAttr: "data-cnp-ext", token } }));
                            // block the native picker
                            return Promise.resolve([]);
                            // return Promise.reject(new DOMException("📋 Copy-n-Paste: Default file picker blocked.", "NotAllowedError"));
                        }
                    }
                } catch (e) {
                    console.warn("[MAIN] picker hook error", e);
                }
                return orig.apply(this, args);
            };
        });

    console.log("[MAIN] file picker hooks installed");
})();
