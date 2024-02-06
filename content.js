if(document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', afterDOMLoaded);
else
  afterDOMLoaded();

// Global variables 
let clientX = 0;
let clientY = 0;

function afterDOMLoaded(){
  // Prep all input file elements
  const fileInputs = document.querySelectorAll("input[type='file']");
  fileInputs.forEach(input => input.addEventListener('click', handleFileInputClick));

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

// When prepped input elements are clicked
function handleFileInputClick(event) {
  event.preventDefault();
  const originalInput = event.target;

  // Create overlay
  const overlay = document.createElement('div');
  overlay.classList.add('overlay');

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
      document.addEventListener('click', closeOverlayOnClickOutside);

      // Overlay upload click listener
      const uploadBtn = overlay.querySelector('#cnp-upload-btn');
      uploadBtn.addEventListener('click', () => {
        const fileInput = overlay.querySelector('#cnp-overlay-file-input');
        fileInput.click();
      });

      // Overlay handle file input
      const overlayFileInput = overlay.querySelector('#cnp-overlay-file-input');
      overlayFileInput.setAttribute('accept', originalInput.getAttribute('accept'));
      overlayFileInput.addEventListener('change', (event) => {
        originalInput.files = event.target.files;
        triggerChangeEvent(originalInput);
        closeOverlay();
      });

      // Handle drag and drop
      const CNP_dropText = overlay.querySelector('#cnp-drop-text');
      overlay.addEventListener('dragover', (event) => {
        event.preventDefault();
        CNP_dropText.style.display = 'flex';
      });

      overlay.addEventListener('dragleave', (event) => {
        const isChild = overlay.contains(event.relatedTarget);
        if (!isChild)
          CNP_dropText.style.display = 'none';
      });

      overlay.addEventListener('drop', (event) => {
        event.preventDefault();
        CNP_dropText.style.display = 'none';
        const files = event.dataTransfer.files;
        handleDroppedFiles(files, originalInput);
        closeOverlay();
      });
      
      // Read and preview clipboard image
      const imagePreview = overlay.querySelector('#cnp-image-container');
      let noImg = overlay.querySelector('#cnp-not-image');
      navigator.clipboard.read().then(clipboardItems => {
        console.log(clipboardItems)
        clipboardItems.forEach(clipboardItem => {
          clipboardItem['types'].forEach(clipboardItemType => {

            if (clipboardItemType.startsWith('image/')) {
              clipboardItem.getType('image/png').then(blob => {
                if (blob) {
                  const reader = new FileReader();
                  reader.onload = (event) => {
                    const img = document.createElement('img');
                    img.src = event.target.result;
                    img.id = 'cnp-image-preview';

                    imagePreview.style.cursor = 'pointer';
                    imagePreview.appendChild(img);
                    imagePreview.addEventListener('click', () => {
                      // Convert blob into file object
                      const file = new File([blob], 'pasted.png', { type: blob.type });
                      const fileList = new DataTransfer();
                      fileList.items.add(file);
                      originalInput.files = fileList.files;
                      
                      triggerChangeEvent(originalInput);
                      closeOverlay();
                    });
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
        });
      }).catch(error => {
        // Check if noImage text exists
        if (!noImg)
          noImage(imagePreview);
        noImg = overlay.querySelector('#cnp-not-image');
      });
    });
  } catch (error) {
    logging(error);
  }
}

// Console logging for errors and messages
function logging(message) {
  console.log('%c📋 Paste Image Uploader:\n', 'font-weight: bold; font-size: 1.3em;', message);
}

// Close overlay immediate
function closeOverlay() {
  const overlay = document.querySelector('.overlay');
  overlay.remove();
}

// Close overlay when clicked outside
function closeOverlayOnClickOutside(event) {
  let overlayContent = document.querySelector('.cnp-overlay-content');
  while (overlayContent && !overlayContent.contains(event.target)) {
    closeOverlay();
    overlayContent = document.querySelector('.cnp-overlay-content');
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
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.type.startsWith('image/')) {
      const fileList = new DataTransfer();
      fileList.items.add(file);
      originalInput.files = fileList.files;

      triggerChangeEvent(originalInput);
    }
  }
}
