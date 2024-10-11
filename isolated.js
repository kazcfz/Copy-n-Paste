/*
Scripts that (must) run within its isolated world,
which is the execution environment unique to this extension.
*/

if (document.readyState === 'loading') 
  document.addEventListener('DOMContentLoaded', afterDOMLoaded);
else 
  afterDOMLoaded();

// Global variables
var lastURL = location.href;

function afterDOMLoaded() {
  // Prep all input file elements
  if (!document.cnpClickListener)
    document.addEventListener("click", event => {
      document.cnpClickListener = true;
      if (event.target.matches("input[type='file']"))
        setupcreateOverlay(event.target);
    }, true);

  // Run through DOM to detect:
  document.querySelectorAll('*').forEach((element, index) => {
    // Raw input file elements
    if (element.matches("input[type='file']"))
      setupcreateOverlay(element);

    // Shadow roots
    else if (element.shadowRoot)
      element.shadowRoot.querySelectorAll("input[type='file']").forEach(fileInput => setupcreateOverlay(fileInput));

    // iframes
    else if (element.matches('iframe')) {
      if (element.contentDocument) {
        const initJS = element.contentDocument.createElement('script');
        initJS.id = `CnP-init-iframe-${index}`;
        initJS.src = chrome.runtime.getURL('init.js');
        element.contentDocument.head.appendChild(initJS);

        const mainJS = element.contentDocument.createElement('script');
        mainJS.id = `CnP-main-iframe-${index}`;
        mainJS.src = chrome.runtime.getURL('main.js');
        element.contentDocument.head.appendChild(mainJS);

        const contentJS = element.contentDocument.createElement('script');
        element.classList.add(`CnP-iframe-${index}`);
        contentJS.id = `CnP-iframe-${index}`;
        contentJS.src = chrome.runtime.getURL('isolated.js');
        contentJS.setAttribute('overlayhtml', chrome.runtime.getURL('overlay.html'));
        element.contentDocument.head.appendChild(contentJS);
      }
    }
  });

  // Find and prep customized input file elements, iframes
  if (!document.body.cnpMutationObserver) {
    const observer = new MutationObserver(mutations => {
      // 'Reload' extension when navigated to other pages within the website
      if (lastURL !== location.href) {
        lastURL = location.href;
        afterDOMLoaded();
      }

      // Watch the DOM to detect:
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach((node, index) => {
          // Input file elements
          if (node.nodeType === Node.ELEMENT_NODE && node.matches("input[type='file']"))
            setupcreateOverlay(node);

          // Shadow roots
          else if (node.nodeType === Node.ELEMENT_NODE && node.shadowRoot) {
            const fileInputs = node.shadowRoot.querySelectorAll("input[type='file']");
            fileInputs.forEach(fileInput => setupcreateOverlay(fileInput));
          }

          // iframes
          else if (node.nodeType === Node.ELEMENT_NODE && node.matches("iframe"))
            if (node.contentDocument) {
              // Append init.js, isolated.js, overlay.html
              const initJS = node.contentDocument.createElement('script');
              const mainJS = node.contentDocument.createElement('script');
              const isolatedJS = node.contentDocument.createElement('script');
              node.classList.add(`CnP-mutatedIframe-${index}`);
              isolatedJS.id = `CnP-mutatedIframe-${index}`;

              if (document.head.querySelector('script[id*="CnP-init-iframe"]'))
                initJS.src = document.head.querySelector('script[id*="CnP-init-iframe"]').getAttribute('src');
              else if (typeof chrome.runtime !== 'undefined')
                initJS.src = chrome.runtime.getURL('init.js');

              if (document.head.querySelector('script[id*="CnP-main-iframe"]'))
                mainJS.src = document.head.querySelector('script[id*="CnP-main-iframe"]').getAttribute('src');
              else if (typeof chrome.runtime !== 'undefined')
                mainJS.src = chrome.runtime.getURL('main.js');

              if (document.head.querySelector('script[overlayhtml]') !== null) {
                isolatedJS.src = document.head.querySelector('script[overlayhtml]').getAttribute('src');
                isolatedJS.setAttribute('overlayhtml', document.head.querySelector('script[overlayhtml]').getAttribute('overlayhtml'));
              }
              else if (typeof chrome.runtime !== 'undefined') {
                isolatedJS.src = chrome.runtime.getURL('isolated.js');
                isolatedJS.setAttribute('overlayhtml', chrome.runtime.getURL('overlay.html'));
              }

              try {
                node.contentDocument.head.appendChild(initJS);
                node.contentDocument.head.appendChild(mainJS);
                node.contentDocument.head.appendChild(isolatedJS);
              } catch (error) {logging(error)}
            }
          
          // Checks if sub-nodes/child are input file elements
          else if (node.nodeType === Node.ELEMENT_NODE && node.hasChildNodes())
            node.querySelectorAll("input[type='file']").forEach(fileInput => setupcreateOverlay(fileInput));
          
          // If the added node is a document fragment, it may contain shadow hosts
          else if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
            node.childNodes.forEach(childNode => {
              if (childNode.nodeType === Node.ELEMENT_NODE && childNode.shadowRoot)
                childNode.shadowRoot.querySelectorAll("input[type='file']").forEach(fileInput => setupcreateOverlay(fileInput));
            });
          }
        });
      });
    });
    try {
      observer.observe(document.body, { childList: true, subtree: true });
      document.body.cnpMutationObserver = true;
    } catch (error) {logging(error)}
  }

  // Message listener between window.top and iframes
  if (!window.cnpMessageListener)
    window.addEventListener('message', event => {
      window.cnpMessageListener = true;
      // Execute paste events from top level since iframes can't
      if (event.data.Type == 'paste') {
        try {
          document.getElementsByClassName(event.data.iframe)[0].contentDocument.execCommand('paste');
        } catch (error) {
          logging(error);
          try {noImage()} catch (error) {logging(error)}
        }
      } else if (event.data.Type == 'getURL')
        if (event.data.iframe)
          document.getElementsByClassName(event.data.iframe)[0].contentWindow.postMessage({'Type': 'getURL-response', 'URL': chrome.runtime.getURL(event.data.Path)}, '*');
        else
          window.top.postMessage({'Type': 'getURL-response', 'URL': chrome.runtime.getURL(event.data.Path)}, '*');
    });
}
