// Loaded first by every test page. Plays the role of a hostile page script: it records every channel
// through which clipboard data or the extension's overlay could leak to the page.
window.leaks = [];
window.changes = [];
window.focusLog = null;
window.addedNodes = [];

const leak = (what, detail = '') => window.leaks.push(`${what}: ${detail}`);

for (const type of ['paste', 'beforeinput', 'copy', 'cut']) {
    window.addEventListener(type, event => leak(`${type} on window`, event.clipboardData ? [...event.clipboardData.types].join(',') : event.inputType), true);
    document.addEventListener(type, () => leak(`${type} on document`), true);
}

// v1.6.3 answered these with the extension URL
window.addEventListener('message', event => {
    if (event.data && (event.data.Type === 'getURL-response' || /extension:\/\//.test(JSON.stringify(event.data))))
        leak('message', JSON.stringify(event.data));
});

// Focus changes caused by the extension (after watchFocus() is called)
for (const type of ['focusin', 'focusout', 'blur', 'focus'])
    window.addEventListener(type, event => window.focusLog?.push(`${type} ${event.target === window ? 'window' : event.target.nodeName}`), true);
window.watchFocus = () => { window.focusLog = []; };

window.addEventListener('change', event => {
    const input = event.composedPath()[0];
    if (input.type === 'file')
        window.changes.push({ id: input.id, files: [...input.files].map(file => file.name) });
}, true);

new MutationObserver(records => {
    for (const record of records)
        for (const node of record.addedNodes)
            window.addedNodes.push(`${node.nodeName} in ${record.target.nodeName}`);
}).observe(document, { childList: true, subtree: true });

window.overlayHost = () => [...document.querySelectorAll(':popover-open')].pop();

// Everything a page could try in order to read the overlay's contents
window.probe = () => {
    const host = window.overlayHost();
    return {
        hostShadowRoot: host ? String(host.shadowRoot) : 'no overlay',
        hostChildren: host ? host.childNodes.length : -1,
        hostText: host ? host.textContent + host.innerText : '',
        blobImages: [...document.querySelectorAll('img, video, iframe')].map(el => el.src).filter(src => src.startsWith('blob:')),
        blobResources: performance.getEntriesByType('resource').map(entry => entry.name).filter(name => name.startsWith('blob:')),
        frames: window.length,
    };
};

// Tries to hide, move or cover the overlay (click-jacking prerequisites)
window.tamper = () => {
    const host = window.overlayHost();
    host.style.setProperty('opacity', '0', 'important');
    host.style.setProperty('transform', 'translateX(-5000px)', 'important');
    host.style.setProperty('pointer-events', 'auto', 'important');
    const style = document.createElement('style');
    style.textContent = `
        :popover-open, div { opacity: 0 !important; visibility: hidden !important; filter: opacity(0) !important; }
        :popover-open::after { content: "decoy" !important; position: fixed; inset: 0; background: red; }`;
    document.head.append(style);
    const computed = getComputedStyle(host);
    return {
        opacity: computed.opacity,
        visibility: computed.visibility,
        transform: computed.transform,
        filter: computed.filter,
        pointerEvents: computed.pointerEvents,
        after: getComputedStyle(host, '::after').content,
    };
};
