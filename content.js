if(document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', afterDOMLoaded);
else
  afterDOMLoaded();

function afterDOMLoaded(){
  // Prepare input file elements for extension use
  const fileInputs = document.querySelectorAll("input[type='file']");
  fileInputs.forEach(input => input.addEventListener('click', handleFileInputClick) );
}


// When input elements are clicked
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

      // Position overlay's bottom-left to cursor position
      const overlayContent = overlay.querySelector('.piu-overlay-content');
      overlayContent.style.left = event.clientX + window.scrollX + (overlayContent.offsetWidth / 2) + 5 + 'px';
      overlayContent.style.top = event.clientY + window.scrollY - (overlayContent.offsetHeight / 2) + 'px';

      // Close overlay when clicking outside of overlay-content
      document.addEventListener('click', closeOverlayOnClickOutside);

      // Handle file input in overlay
      const overlayFileInput = overlay.querySelector('#piu-overlay-file-input');
      overlayFileInput.setAttribute('accept', originalInput.getAttribute('accept'));
      overlayFileInput.addEventListener('change', (event) => {
        originalInput.files = event.target.files;
        triggerChangeEvent(originalInput);
        closeOverlay();
      });

      // Handle drag and drop
      const PIU_dropText = overlay.querySelector('#piu-drop-text');
      overlay.addEventListener('dragover', (event) => {
        event.preventDefault();
        PIU_dropText.style.display = 'flex';
      });

      overlay.addEventListener('dragleave', (event) => {
        const isChild = overlay.contains(event.relatedTarget);
        if (!isChild) {
          PIU_dropText.style.display = 'none';
        }
      });

      overlay.addEventListener('drop', (event) => {
        event.preventDefault();
        PIU_dropText.style.display = 'none';
        const files = event.dataTransfer.files;
        handleDroppedFiles(files, originalInput);
        closeOverlay();
      });
      
      // Read images from clipboard and display in overlay
      const imagePreview = overlay.querySelector('#piu-image-container');
      navigator.clipboard.read().then(clipboardItems => {
        clipboardItems.forEach(clipboardItem => {
          clipboardItem['types'].forEach(clipboardItemType => {

            if (clipboardItemType.startsWith('image/')) {
              clipboardItem.getType('image/png').then(blob => {
                const reader = new FileReader();
                reader.onload = (event) => {
                  const img = document.createElement('img');
                  img.src = event.target.result;
                  img.id = 'piu-image-preview';

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
              });
            } else {
              // Remove noImage text since image is found
              const noImg = overlay.querySelector('#piu-not-image');
              if (noImg) noImg.parentNode.removeChild(noImg);
              noImage(imagePreview);
            }
          })
        });
      }).catch(error => {
        noImage(imagePreview);
        logging("Is your clipboard empty?");
      });
    });
  } catch (error) {
    noImage(imagePreview);
    logging(error);
  }
}


// Console logging for errors and messages
function logging(message) {
  console.log('%c📋 Paste Image Uploader:\n', 'font-weight: bold; font-size: 1.3em;', message);
}

// Close overlay
function closeOverlay() {
  const overlay = document.querySelector('.overlay');
  overlay.remove();
  document.removeEventListener('click', closeOverlayOnClickOutside);
}

// Close overlay when clicking outside of overlay-content
function closeOverlayOnClickOutside(event) {
  const overlayContent = document.querySelector('.piu-overlay-content');
  if (!overlayContent.contains(event.target))
    closeOverlay();
}

// Preview 'No image' message
function noImage(imagePreview) {
  const noImg = document.createElement('span');
  noImg.id = 'piu-not-image';
  noImg.textContent = 'Screenshot / Drop an image';

  imagePreview.style.cursor = 'default';
  imagePreview.appendChild(noImg);
}

// Trigger change event on original input to update value (such as disabled buttons)
function triggerChangeEvent(originalInput) {
  const changeEvent = new Event('change', { bubbles: true });
  originalInput.dispatchEvent(changeEvent);
}

// Select dropped file into input element
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