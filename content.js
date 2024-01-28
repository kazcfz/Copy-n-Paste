if(document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', afterDOMLoaded);
else
  afterDOMLoaded();

function afterDOMLoaded(){
  const fileInputs = document.querySelectorAll("input[type='file']");
  fileInputs.forEach((input) => {
    input.addEventListener('click', handleFileInputClick);
  });
  console.log("File input elements found:", fileInputs.length); //test
}

// Function to handle click event on file input element
function handleFileInputClick(event) {
  event.preventDefault();
  console.log('Input file clicked success');
  const originalInput = event.target;

  // Create overlay
  const overlay = document.createElement('div');
  overlay.classList.add('overlay');

  // Load overlay content
  fetch(chrome.runtime.getURL('overlay.html'))
  .then(response => response.text())
  .then(html => {
    overlay.innerHTML = html;
    document.body.appendChild(overlay);

    // Position overlay's bottom-left to where cursor is
    const overlayContent = overlay.querySelector('.overlay-content');
    overlayContent.style.left = event.clientX + window.scrollX + (overlayContent.offsetWidth / 2) + 5 + 'px';
    overlayContent.style.top = event.clientY + window.scrollY - (overlayContent.offsetHeight / 2) + 'px';

    // Add event listener to close overlay when clicking outside of overlay-content
    document.addEventListener('click', closeOverlayOnClickOutside);

    // Add event listener to handle file selection in overlay
    const overlayFileInput = overlay.querySelector('#overlay-file-input');
    overlayFileInput.addEventListener('change', (event) => {
        handleOverlayFileSelection(event, originalInput);
    });

    // Read images from clipboard and display in overlay
    navigator.clipboard.read().then(clipboardItems => {
      clipboardItems.forEach(clipboardItem => {
        if (clipboardItems[0]['types'][0] == 'image/png') {
          clipboardItem.getType('image/png').then(blob => {
            const reader = new FileReader();
            reader.onload = function(event) {
              const imagePreview = overlay.querySelector('#image-preview');
              const img = document.createElement('img');
              img.src = event.target.result;
              img.style.maxWidth = '200px';
              img.style.maxHeight = '200px';

              img.addEventListener('click', () => {
                // Convert the blob into a file object
                const file = new File([blob], 'screenshot.png', { type: blob.type });

                // Create a new FormData object
                const fileList = new DataTransfer();
                fileList.items.add(file);

                originalInput.files = fileList.files;
                
                // // Trigger change event on original input to update its value
                const changeEvent = new Event('change', { bubbles: true });
                originalInput.dispatchEvent(changeEvent);
                // // Close the overlay
                closeOverlay()
              });

              imagePreview.appendChild(img);
            };
            reader.readAsDataURL(blob);
          }).catch(error => {
            console.log('%c📋 Paste Image Uploader:', 'font-weight: bold; font-size: 1.3em;',
              '\nNo image found in clipboard');
          }); //Never called because if condition is set already
        }
      });
    }).catch(error => { /* pass */ });
  });
}

// Function to convert blob to File object
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
  const overlayContent = document.querySelector('.overlay-content');
  if (!overlayContent.contains(event.target))
    closeOverlay()
}

// Function to handle file selection in overlay and pass it to original input file element
function handleOverlayFileSelection(event, originalInput) {
  const file = event.target.files[0];
  originalInput.files = event.target.files;

  // Trigger change event on original input to update its value
  const changeEvent = new Event('change', { bubbles: true });
  originalInput.dispatchEvent(changeEvent);

  // Close the overlay
  closeOverlay()
}




/*


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'pasteImage') {
    const image = message.imageData;
    const previewDiv = document.getElementById('preview');
    previewDiv.innerHTML = `<img src="${image}" onclick="pasteImageIntoInput('${image}')">`;
  }
});

function pasteImageIntoInput(imageData) {
  const fileInputs = document.querySelectorAll("input[type='file']");
  fileInputs.forEach((input) => {
    input.files = [dataURItoBlob(imageData)];
  });
}

function dataURItoBlob(dataURI) {
  const byteString = atob(dataURI.split(',')[1]);
  const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeString });
}
*/