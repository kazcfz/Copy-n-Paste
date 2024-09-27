if(document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', afterDOMLoaded);
else
  afterDOMLoaded();

// Global variables
let clientX = 0;
let clientY = 0;
let overlayHTML;

function afterDOMLoaded() {
  // Prep all input file elements
  document.addEventListener("click", event => {
    if (event.target.id != "cnp-overlay-file-input" && event.target.tagName.toLowerCase() === "input" && event.target.type === "file")
      event.target.addEventListener("click", handleFileInputClick);
  }, true);

  // Message listener between window.top and iframes
  window.addEventListener('message', event => {
    // Execute paste events from top level since iframes can't
    if (event.data.Type == 'paste') {
      try {
        document.getElementsByClassName(event.data.iframe)[0].contentDocument.execCommand('paste');
      } catch (error) {
        logging(error);
        try {noImage();} catch (error) {logging(error);}
      }
    }
  });

  // Check through entire DOM
  document.querySelectorAll('*').forEach((element, index) => {
    // Inject script into (raw) iframes
    if (element.tagName.toLowerCase() === 'iframe') {
      if (element.contentDocument) {
        const script = element.contentDocument.createElement('script');
        element.classList.add(`CnP-iframe-${index}`);
        script.id = `CnP-iframe-${index}`;
        script.src = chrome.runtime.getURL('content.js');
        script.setAttribute('overlayhtml', chrome.runtime.getURL('overlay.html'));
        element.contentDocument.head.appendChild(script);
      }
    }
  
    // Check for shadow roots
    if (element.shadowRoot) {
      element.shadowRoot.querySelectorAll("input[type='file']").forEach(fileInput => {
        if (fileInput.id !== "cnp-overlay-file-input")
          fileInput.addEventListener("click", handleFileInputClick);
      });
    }
  });

  // Find and prep customized input file elements, iframes
  const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach((node, index) => {
        // Checks if node is an input file element
        if (node.nodeType === Node.ELEMENT_NODE && node.matches("input[type='file']"))
          node.addEventListener("click", handleFileInputClick);
        // Checks if node is a shadow root
        else if (node.nodeType === Node.ELEMENT_NODE && node.shadowRoot) {
          const fileInputs = node.shadowRoot.querySelectorAll("input[type='file']");
          fileInputs.forEach(fileInput => {
            if (fileInput.id != "cnp-overlay-file-input")
              fileInput.addEventListener("click", handleFileInputClick);
          });
        }
        // Checks if node is an iframe
        else if (node.nodeType === Node.ELEMENT_NODE && node.matches("iframe"))
          if (node.contentDocument) {
            const script = node.contentDocument.createElement('script');
            node.classList.add(`CnP-mutatedIframe-${index}`);
            script.id = `CnP-mutatedIframe-${index}`;
            script.src = chrome.runtime.getURL('content.js');
            script.setAttribute('overlayhtml', chrome.runtime.getURL('overlay.html'));
            node.contentDocument.head.appendChild(script);
          }
        // Checks if sub-nodes/child are input file elements
        else if (node.nodeType === Node.ELEMENT_NODE && node.hasChildNodes()) {
          node.querySelectorAll("input[type='file']").forEach(fileInput => {
            if (fileInput.id != "cnp-overlay-file-input")
              fileInput.addEventListener("click", handleFileInputClick);
          });
        }
        // If the added node is a document fragment, it may contain shadow hosts
        else if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
          node.childNodes.forEach(childNode => {
            if (childNode.nodeType === Node.ELEMENT_NODE && childNode.shadowRoot) {
              childNode.shadowRoot.querySelectorAll("input[type='file']").forEach(fileInput => {
                if (fileInput.id != "cnp-overlay-file-input")
                  fileInput.addEventListener("click", handleFileInputClick);
              });
            }
          });
        }
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Record last know coord. Some pages report coords as 0,0
  document.addEventListener('mousemove', event => {
    clientX = event.clientX;
    clientY = event.clientY;
  });
}

// Ctrl + V listener
let ctrlVdata = null;
function ctrlV(event) {
  const overlayContent = document.querySelector('.cnp-overlay-content');
  if (overlayContent && event.ctrlKey && (event.key === 'v' || event.key === 'V')) {
    if (ctrlVdata && ctrlVdata.files) {
      Array.prototype.forEach.call(ctrlVdata.files, blob => {
        const reader = new FileReader();
        let fileName = blob.name;
        if (blob.name == 'image.png' || !blob.name)
          fileName = 'CnP_'+new Date().toLocaleString().replace(/, /g, '_').replace(/[\/: ]/g, '')+'.'+blob.type.split('/').pop()
        reader.onload = () => {
          // Convert blob into file object
          const file = new File([blob], fileName, { type: blob.type });
          const fileList = new DataTransfer();
          
          // Include previously selected files for multi-file
          for (const file of originalInput.files)
            fileList.items.add(file);
          fileList.items.add(file);
          originalInput.files = fileList.files;
          
          triggerChangeEvent(originalInput);
          closeOverlay();
        };
        reader.readAsDataURL(blob);
      });
    }
  }
}

// Preview copied image in overlay
function previewImage(webCopiedImgSrc, readerEvent, blob) {
  let imagePreview = document.querySelector('#cnp-image-preview');
  const imagePreviewContainer = document.querySelector('#cnp-preview-container');
  const spinner = document.querySelector('.cnp-spinner');
  const badge = document.querySelector('.cnp-preview-badge');

  let fileName = blob.name;

  badge.title += fileName + '\n';
  badge.innerText = parseInt(badge.innerText) + 1;

  if (!imagePreview) {
    // Preview image types
    if (blob.type.split('/')[0] == 'image') {
      imagePreview = document.createElement('img');
      imagePreview.id = 'cnp-image-preview';
      imagePreview.src = window.URL.createObjectURL(new Blob([new Uint8Array(readerEvent.target.result)], {type: blob.type}));
      try {imagePreviewContainer.appendChild(imagePreview);} catch (error) {logging(error);}
      imagePreview.onload = () => spinner.style.display = 'none';
    } 
    // Preview PDF type
    else if (blob.type.split('/').pop() == 'pdf') {
      spinner.style.display = 'none';
      imagePreview = document.createElement('iframe');
      imagePreview.id = 'cnp-image-preview';
      imagePreview.type = blob.type;
      imagePreview.src = window.URL.createObjectURL(new Blob([new Uint8Array(readerEvent.target.result)], {type: blob.type})) + '#scrollbar=0&view=FitH,top&page=1&toolbar=0&statusbar=0&navpanes=0';
      try {imagePreviewContainer.appendChild(imagePreview);} catch (error) {logging(error);}
      spinner.style.display = 'none';
    } 
    // Preview video types
    else if (blob.type.split('/')[0] == 'video') {
      spinner.style.display = 'none';
      imagePreview = document.createElement('video');
      imagePreview.id = 'cnp-image-preview';
      imagePreview.preload = "metadata";
      imagePreview.type = blob.type;
      imagePreview.src = window.URL.createObjectURL(new Blob([new Uint8Array(readerEvent.target.result)], {type: blob.type}));
      imagePreview.onloadedmetadata = () => {
        if (imagePreview.videoWidth == 0 || imagePreview.videoHeight == 0)
          previewGenericFile('audio_file');
        else
          try {imagePreviewContainer.appendChild(imagePreview);} catch (error) {logging(error);}
      }
      spinner.style.display = 'none';
    }
    // Preview audio type
    else if (blob.type.split('/')[0] == 'audio')
      previewGenericFile('audio_file');
    // Preview other file types
    else
      previewGenericFile('blank_file');
  }

  function previewGenericFile(fileTypeIcon) {
    imagePreview = document.createElement('img');
    imagePreview.id = 'cnp-image-preview';
    imagePreview.setAttribute('height', '50%');
    imagePreview.src = chrome.runtime.getURL(`media/${fileTypeIcon}.png`);
    try {imagePreviewContainer.appendChild(imagePreview);} catch (error) {logging(error);}

    let title = document.createElement('span');
    const extension = fileName.split('.').pop();
    let baseName = fileName.slice(0, -extension.length - 1);
    if (fileName.length > 25) {
      baseName = baseName.slice(0, 25);
      // Remove last character if it's a whitespace
      while (baseName[baseName.length - 1] === ' ')
        baseName = baseName.slice(0, -1);
      baseName += '..';
    }
    
    title.textContent = `${baseName}.${extension}`;
    title.id = 'cnp-image-title';
    imagePreviewContainer.appendChild(title);
    spinner.style.display = 'none';
  }
  
  // Preview GIF images (copied from web)
  // if (webCopiedImgSrc.endsWith('.gif')) {
  //   img.src = webCopiedImgSrc;
  // }
  
  // if (webCopiedImgSrc.endsWith('.gif'))
  //   fileName = fileName.replace('.png', '.gif');
}

// Clones event objects
function cloneEvent(e) {
  if (e===undefined || e===null)
    return undefined;

  function ClonedEvent() {};
  let clone=new ClonedEvent();
  for (let p in e) {
    let d=Object.getOwnPropertyDescriptor(e, p);
    if (d && (d.get || d.set))
      Object.defineProperty(clone, p, d);
    else
      clone[p] = e[p];
  }
  Object.setPrototypeOf(clone, e);
  return clone;
}

// When prepped input elements are clicked
function handleFileInputClick(event) {
  event.preventDefault();
  originalInput = event.target;

  // Create overlay
  const overlay = document.createElement('div');
  overlay.classList.add('cnp-overlay');

  // Handle Ctrl+V action
  document.addEventListener('keydown', ctrlV);

  try {
    overlayHTML = document.head.querySelector('script[overlayhtml]') !== null ? document.head.querySelector('script[overlayhtml]').getAttribute('overlayhtml') : null;
    const urlToFetch = overlayHTML || (typeof chrome.runtime !== 'undefined' ? chrome.runtime.getURL('overlay.html') : null);
    if (urlToFetch) {
      fetch(urlToFetch)
      .then(response => response.text())
      .then(html => {
        overlay.innerHTML = html;
        document.body.appendChild(overlay);

        // Position overlay to cursor coord
        const overlayContent = overlay.querySelector('.cnp-overlay-content');
        let overlayLeftPos = clientX + window.scrollX + (overlayContent.offsetWidth / 2);
        let overlayBottomPos = clientY + window.scrollY + (overlayContent.offsetHeight / 2);

        // Flip if overlay overshoots
        const tooMuchRight = overlayLeftPos + (overlayContent.offsetWidth / 2);
        const tooMuchBottom = overlayBottomPos + (overlayContent.offsetHeight / 2);

        if (tooMuchRight >= innerWidth)
          overlayLeftPos -= overlayContent.offsetWidth;
        if (tooMuchBottom >= innerHeight)
          overlayBottomPos -= overlayContent.offsetHeight;

        overlayContent.style.left = overlayLeftPos + 'px';
        overlayContent.style.top = overlayBottomPos + 'px';

        // Close overlay when clicked outside
        document.onclick = event => {
          let overlayContent = document.querySelector('.cnp-overlay-content');
          while (overlayContent && !overlayContent.contains(event.target)) {
            closeOverlay();
            overlayContent = document.querySelector('.cnp-overlay-content');
          }
        };

        // Overlay upload click listener
        const uploadBtn = overlay.querySelector('#cnp-upload-btn');
        uploadBtn.onclick = () => overlayFileInput.click();

        // Overlay handle file input
        const overlayFileInput = overlay.querySelector('#cnp-overlay-file-input');
        overlayFileInput.setAttribute('accept', originalInput.getAttribute('accept'));
        overlayFileInput.addEventListener('change', event => {
          const fileList = new DataTransfer();

          // Reattach previous files
          for (const file of originalInput.files)
            fileList.items.add(file);

          // Attach new files
          for (const file of event.target.files)
            fileList.items.add(file);

          originalInput.files = fileList.files;
          triggerChangeEvent(originalInput);
          closeOverlay();
        });

        // Follow multiple file rules of original input
        // overlayFileInput.multiple = originalInput.multiple;

        // Handle dragover event
        const CNP_dropText = overlay.querySelector('#cnp-drop-text');
        overlay.addEventListener('dragover', event => {
          event.stopPropagation();
          event.preventDefault();
          CNP_dropText.style.display = 'flex';
        });

        // Handle dragleave event
        overlay.addEventListener('dragleave', event => {
          const isChild = overlay.contains(event.relatedTarget);
          if (!isChild)
            CNP_dropText.style.display = 'none';
        });

        // Handle drop event
        overlay.addEventListener('drop', event => {
          event.preventDefault();
          CNP_dropText.style.display = 'none';
          const files = event.dataTransfer.files;
          handleDroppedFiles(files, originalInput);
          closeOverlay();
        });

        // Handle paste event
        document.addEventListener('paste', async event => {
          event.stopPropagation();
          event.preventDefault();
          
          const statusMap = new Map();
          statusMap.set('success', 0);
          statusMap.set('fail', 0);
          if (overlayFileInput) {
            // Access clipboard to display latest copied files to overlay
            const dataTransfer = event.clipboardData;
            if (dataTransfer.files.length > 0) {
              ctrlVdata = cloneEvent(event.clipboardData); // Separate paste listener using Ctrl+V

              // Function to handle the FileReader asynchronously
              const readFileAsDataURL = file => {
                return new Promise((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = readerEvent => {
                    let webCopiedImgSrc = '';
                    // try {webCopiedImgSrc = event.clipboardData.getData(event.clipboardData.types[0]).match(/<img\s+src="([^"]+)"/)[1];} catch (error) {logging(error);}
                    try {previewImage(webCopiedImgSrc, readerEvent, file);} catch (error) {logging(error);}
                    statusMap.set('success', statusMap.get('success') + 1);
                    resolve();
                  };
                  reader.onerror = () => {
                    statusMap.set('fail', statusMap.get('fail') + 1);
                    resolve();
                  };
                  reader.readAsArrayBuffer(file);
                });
              };
              
              // Include previously selected files for multi-file (continues in imagePreviewContainer click listener below)
              const fileList = new DataTransfer();
              for (const file of originalInput.files)
                fileList.items.add(file);

              // Array of promises to process each file
              const readPromises = Array.from(dataTransfer.files).map(file => {
                let filename = file.name;
                if (!filename || filename == 'image.png')
                  filename = 'CnP_'+new Date().toLocaleString('en-GB', {hour12: false}).replace(/, /g, '_').replace(/[\/: ]/g, '')+'.'+file.type.split('/').pop();
                fileList.items.add(new File([file], filename, { type: file.type }));
                return readFileAsDataURL(file);
              });
              await Promise.all(readPromises);

              if (statusMap.get('fail') >= 1 && statusMap.get('success') <= 0)
                noImage();
              else {
                const imagePreviewContainer = document.querySelector('#cnp-preview-container');
                imagePreviewContainer.style.cursor = 'pointer';
                imagePreviewContainer.addEventListener('click', () => {
                  originalInput.files = fileList.files;
                  triggerChangeEvent(originalInput);
                  closeOverlay();
                }, {once: true});
              }
            } else
              noImage();
          }
        }, { once: true, capture: true });
        
        // Trigger paste event
        overlay.contentEditable = true;
        overlay.focus();
        document.execCommand('paste');
        overlay.contentEditable = false;

        // Trigger paste event for iframe
        if (document.head.querySelector('script[id]') && (document.head.querySelector('script[id]').getAttribute('id').includes('CnP-iframe-') || document.head.querySelector('script[id]').getAttribute('id').includes('CnP-mutatedIframe-')))
          window.top.postMessage({'Type': 'paste', 'iframe': document.head.querySelector('script[id]').getAttribute('id')}, '*');
      });
    }
  } catch (error) { logging(error); }
}

// Console logging for errors and messages
function logging(message) {
  console.log('%c📋 Copy-n-Paste:\n', 'font-weight: bold; font-size: 1.3em;', message);
  window.top.postMessage(('%c📋 Copy-n-Paste:\n', 'font-weight: bold; font-size: 1.3em;', message), '*');
}

// Close overlay immediate
function closeOverlay() {
  let overlay = document.querySelector('.cnp-overlay');
  while (overlay) {
    overlay.remove();
    overlay = document.querySelector('.cnp-overlay');
  }
}

// Preview 'No image' message
function noImage() {
  const CNP_notImage = document.createElement('span');
  CNP_notImage.id = 'cnp-not-image';
  CNP_notImage.textContent = 'Screenshot / Drop an image';

  const overlay = document.querySelector('.cnp-overlay');
  const imagePreviewContainer = overlay.querySelector('#cnp-preview-container');
  imagePreviewContainer.style.cursor = 'default';
  imagePreviewContainer.appendChild(CNP_notImage);

  const spinner = document.querySelector('.cnp-spinner');
  spinner.style.display = 'none';

  const badge = document.querySelector('.cnp-preview-badge');
  badge.style.display = 'none';
}

// Trigger change event on original input to update value (like disabled buttons)
function triggerChangeEvent(originalInput) {
  originalInput.dispatchEvent(new Event('change', { bubbles: true }));
  originalInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Put dropped file into original input element
function handleDroppedFiles(files, originalInput) {
  const fileList = new DataTransfer();
  
  // Reattach previous files
  for (const file of originalInput.files)
    fileList.items.add(file);

  // Attach new files
  for (const file of files)
    fileList.items.add(file);

  originalInput.files = fileList.files;
  triggerChangeEvent(originalInput);
}
