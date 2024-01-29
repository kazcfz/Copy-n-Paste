if(document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', afterDOMLoaded);
else
  afterDOMLoaded();

function afterDOMLoaded(){
  const fileInputs = document.querySelectorAll("input[type='file']");
  fileInputs.forEach((input) => {
    input.addEventListener('click', handleFileInputClick);
  });
  // console.log("File input elements found:", fileInputs.length);
}

// When input elements are clicked
function handleFileInputClick(event) {
  event.preventDefault();
  const originalInput = event.target;

  // Create overlay
  const overlay = document.createElement('div');
  overlay.classList.add('overlay');

  fetch(chrome.runtime.getURL('overlay.html'))
  .then(response => response.text())
  .then(html => {
    overlay.innerHTML = html;
    document.body.appendChild(overlay);

    // Position overlay's bottom-left to where cursor is
    const overlayContent = overlay.querySelector('.piu-overlay-content');
    overlayContent.style.left = event.clientX + window.scrollX + (overlayContent.offsetWidth / 2) + 5 + 'px';
    overlayContent.style.top = event.clientY + window.scrollY - (overlayContent.offsetHeight / 2) + 'px';

    // Add event listener to close overlay when clicking outside of overlay-content
    document.addEventListener('click', closeOverlayOnClickOutside);

    // Add event listener to handle file selection in overlay
    const overlayFileInput = overlay.querySelector('#piu-overlay-file-input');
    overlayFileInput.addEventListener('change', (event) => handleOverlayFileSelection(event, originalInput));
    overlayFileInput.setAttribute('accept', originalInput.getAttribute('accept'));

    // Read images from clipboard and display in overlay
    navigator.clipboard.read().then(clipboardItems => {
      clipboardItems.forEach(clipboardItem => {
        if (clipboardItems[0]['types'][0] == 'image/png') {
          clipboardItem.getType('image/png').then(blob => {
            const reader = new FileReader();

            reader.onload = function(event) {
              const imagePreview = overlay.querySelector('#piu-image-container');
              const img = document.createElement('img');
              img.src = event.target.result;
              img.id = 'piu-image-preview';

              imagePreview.addEventListener('click', () => {
                // Convert blob into file object
                const file = new File([blob], 'screenshot.png', { type: blob.type });

                const fileList = new DataTransfer();
                fileList.items.add(file);
                originalInput.files = fileList.files;
                
                // Trigger change event on original input to update its value
                const changeEvent = new Event('change', { bubbles: true });
                originalInput.dispatchEvent(changeEvent);
                
                closeOverlay()
              });

              imagePreview.appendChild(img);
            };
            reader.readAsDataURL(blob);
          });
        }
      });
    }).catch(error => {
      console.log('%c📋 Paste Image Uploader:', 'font-weight: bold; font-size: 1.3em;',
        '\nFailed to read clipboard');
    });
  }).catch(error => {
    console.log('%c📋 Paste Image Uploader:', 'font-weight: bold; font-size: 1.3em;',
      '\nFetching error: "overlay.html"');
  });;
}

// Convert blob to File object
function blobToFile(blob) {
    const file = new File([blob], 'clipboard-image.png', { type: blob.type });
    return file;
}

// Close overlay
function closeOverlay(){
  const overlay = document.querySelector('.overlay');
  overlay.remove();
  document.removeEventListener('click', closeOverlayOnClickOutside);
}

// Close overlay when clicking outside of overlay-content
function closeOverlayOnClickOutside(event) {
  const overlayContent = document.querySelector('.piu-overlay-content');
  if (!overlayContent.contains(event.target))
    closeOverlay()
}

// Pass image selected in overlay, to original input file element
function handleOverlayFileSelection(event, originalInput) {
  const file = event.target.files[0];
  originalInput.files = event.target.files;

  // Trigger change event on original input to update value (such as disabled buttons)
  const changeEvent = new Event('change', { bubbles: true });
  originalInput.dispatchEvent(changeEvent);

  closeOverlay()
}
