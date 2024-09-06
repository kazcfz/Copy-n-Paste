if(document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', afterDOMLoaded);
else
  afterDOMLoaded();

// Global variables 
let clientX = 0;
let clientY = 0;

function afterDOMLoaded() {
  // Prep all input file elements
  document.addEventListener("click", event => {
    if (event.target.id != "cnp-overlay-file-input" && event.target.tagName.toLowerCase() === "input" && event.target.type === "file")
      event.target.addEventListener("click", handleFileInputClick);
  }, true);

  // Find and prep customized input file elements
  const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        // Checks if node is an input file element
        if (node.nodeType === Node.ELEMENT_NODE && node.matches("input[type='file']"))
          node.addEventListener("click", handleFileInputClick);
        // Checks if sub-nodes/child are input file elements
        else if (node.nodeType === Node.ELEMENT_NODE && node.hasChildNodes()) {
          const fileInputs = node.querySelectorAll("input[type='file']");
          fileInputs.forEach(fileInput => {
            if (fileInput.id != "cnp-overlay-file-input")
              fileInput.addEventListener("click", handleFileInputClick);
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
    if (ctrlVdata.files) {
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
function previewImage(event, blob) {
  const imagePreview = document.querySelector('#cnp-image-container');
  const img = imagePreview.querySelector('#cnp-image-preview');
  img.src = event.target.result;

  imagePreview.style.cursor = 'pointer';
  imagePreview.addEventListener('click', () => {
    // Convert blob into file object
    let fileName = blob.name;
    if (blob.name == 'image.png' || !blob.name)
      fileName = 'CnP_'+new Date().toLocaleString().replace(/, /g, '_').replace(/[\/: ]/g, '')+'.'+blob.type.split('/').pop()
    
    const file = new File([blob], fileName, { type: blob.type });
    const fileList = new DataTransfer();
    
    // Include previously selected files for multi-file
    for (const file of originalInput.files)
      fileList.items.add(file);
    fileList.items.add(file);
    originalInput.files = fileList.files;
    
    triggerChangeEvent(originalInput);
    closeOverlay();
  }, {once: true});
}

// Clones event objects
function cloneEvent(e) {
  if (e===undefined || e===null) return undefined;
  function ClonedEvent() {};  
  let clone=new ClonedEvent();
  for (let p in e) {
      let d=Object.getOwnPropertyDescriptor(e, p);
      if (d && (d.get || d.set)) Object.defineProperty(clone, p, d); else clone[p] = e[p];
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

  // Handle paste action
  document.addEventListener('paste', event => {
    const overlayContent = document.querySelector('.cnp-overlay-content');
    if (overlayContent) {
      /*const fileList = new DataTransfer();

      // Reattach previous files
      for (const file of originalInput.files)
        fileList.items.add(file);

      navigator.clipboard.read().then(clipboardItems => 
        clipboardItems.forEach(clipboardItem => 
          clipboardItem['types'].forEach(clipboardItemType =>
            clipboardItemType.startsWith('image/') && clipboardItem.getType('image/png').then(blob => {
                const reader = new FileReader();
                reader.onload = () => {
                  // Convert blob into file object
                  const file = new File([blob], 'CnP_'+new Date().toLocaleString().replace(/, /g, '_').replace(/[\/: ]/g, '')+'.png', { type: blob.type });
                  fileList.items.add(file);
                  originalInput.files = fileList.files;
                  closeOverlay();
                  triggerChangeEvent(originalInput);
                };
                reader.readAsDataURL(blob);
            })
          )
        )
      )*/

      // the cooler clipboard api
      const dataTransfer = event.clipboardData;
      if (dataTransfer.files) {
        // ctrlVdata = event.clipboardData;
        ctrlVdata = cloneEvent(event.clipboardData);
        Array.prototype.forEach.call(dataTransfer.files, file => {
          const reader = new FileReader();
          reader.onload = event => previewImage(event, file);
          reader.readAsDataURL(file);
        });
      }
    }
  }, { once: true });

  // Handle Ctrl+V action
  document.addEventListener('keydown', ctrlV);

  try {
    fetch(chrome.runtime.getURL('overlay.html'))
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

      if (tooMuchRight >= window.innerWidth)
        overlayLeftPos -= overlayContent.offsetWidth;
      if (tooMuchBottom >= window.innerHeight)
        overlayBottomPos -= overlayContent.offsetHeight;

      overlayContent.style.left = overlayLeftPos + 'px';
      overlayContent.style.top = overlayBottomPos + 'px';

      // Close overlay when clicked outside
      document.addEventListener('click', event => {
        let overlayContent = document.querySelector('.cnp-overlay-content');
        while (overlayContent && !overlayContent.contains(event.target)) {
          closeOverlay();
          overlayContent = document.querySelector('.cnp-overlay-content');
        }
      });

      // Overlay upload click listener
      const uploadBtn = overlay.querySelector('#cnp-upload-btn');
      uploadBtn.addEventListener('click', () => {
        overlayFileInput.click();
      });

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
      
      /*if (originalInput.multiple)
        overlayFileInput.multiple = true;
      else
        overlayFileInput.multiple = false;*/

      // Handle drag and drop
      const CNP_dropText = overlay.querySelector('#cnp-drop-text');
      overlay.addEventListener('dragover', event => {
        event.preventDefault();
        CNP_dropText.style.display = 'flex';
      });

      overlay.addEventListener('dragleave', event => {
        const isChild = overlay.contains(event.relatedTarget);
        if (!isChild)
          CNP_dropText.style.display = 'none';
      });

      overlay.addEventListener('drop', event => {
        event.preventDefault();
        CNP_dropText.style.display = 'none';
        const files = event.dataTransfer.files;
        handleDroppedFiles(files, originalInput);
        closeOverlay();
      });
      
      document.execCommand('paste')
      // Read and preview clipboard image (Legacy)
      /*const imagePreview = overlay.querySelector('#cnp-image-container');
      let noImg = overlay.querySelector('#cnp-not-image');

      navigator.clipboard.read().then(clipboardItems => {
        clipboardItems.forEach(clipboardItem => 
          clipboardItem['types'].forEach(clipboardItemType => {
            if (clipboardItemType.startsWith('image/')) {
              clipboardItem.getType('image/png').then(blob => {
                if (blob) {
                  const reader = new FileReader();
                  reader.onload = event => {
                    previewImage(event, blob);
                    navigatorClipboardStep = true;
                    console.log(navigatorClipboardStep)
                    // const img = imagePreview.querySelector('#cnp-image-preview');
                    // img.src = event.target.result;

                    // imagePreview.style.cursor = 'pointer';
                    // imagePreview.addEventListener('click', () => {
                    //   // Convert blob into file object
                    //   const file = new File([blob], 'CnP_'+new Date().toLocaleString().replace(/, /g, '_').replace(/[\/: ]/g, '')+'.png', { type: blob.type });
                    //   const fileList = new DataTransfer();
                      
                    //   // Include previously selected files for multi-file
                    //   for (const file of originalInput.files)
                    //     fileList.items.add(file);
                    //   fileList.items.add(file);
                    //   originalInput.files = fileList.files;
                      
                    //   triggerChangeEvent(originalInput);
                    //   closeOverlay();
                    // });
                  };
                  reader.readAsDataURL(blob);
                  // Remove noImage text since image is found
                  if (noImg)
                    noImg.parentNode.removeChild(noImg);
                } else {
                  // Check if noImage text exists
                  if (!noImg)
                    noImage(imagePreview);
                  noImg = overlay.querySelector('#cnp-not-image');
                }
              });
            } else {
              // Check if noImage text exists
              if (!noImg)
                noImage(imagePreview);
              noImg = overlay.querySelector('#cnp-not-image');
            }
          })
        );
      }).catch(error => {
        // Check if noImage text exists
        if (!noImg)
          noImage(imagePreview);
        noImg = overlay.querySelector('#cnp-not-image');
      });*/

    });
  } catch (error) {
    logging(error);
  }
}

// Console logging for errors and messages
function logging(message) {
  console.log('%c📋 Copy-n-Paste:\n', 'font-weight: bold; font-size: 1.3em;', message);
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
function noImage(imagePreview) {
  const CNP_notImage = document.createElement('span');
  CNP_notImage.id = 'cnp-not-image';
  CNP_notImage.textContent = 'Screenshot / Drop an image';

  imagePreview.style.cursor = 'default';
  imagePreview.appendChild(CNP_notImage);
}

// Trigger change event on original input to update value (like disabled buttons)
function triggerChangeEvent(originalInput) {
  const changeEvent = new Event('change', { bubbles: true });
  originalInput.dispatchEvent(changeEvent);
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
