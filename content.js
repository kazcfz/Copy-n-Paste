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

function handleDocumentClick(event) {
  // If the clicked element is not the text box, hide it
  if (textBox && !textBox.contains(event.target)) {
    textBox.remove();
    textBox = null;
    // Remove the click event listener after hiding the text box
    document.removeEventListener('click', handleDocumentClick);
  }
}

// Function to handle click event on file input element
function handleFileInputClick(event) {
  event.preventDefault();
  console.log('Input file clicked success');

  // Create overlay
  const overlay = document.createElement('div');
  overlay.classList.add('overlay');
  // Load overlay content
  fetch(chrome.runtime.getURL('overlay.html'))
    .then(response => response.text())
    .then(html => {
      overlay.innerHTML = html;
      document.body.appendChild(overlay);
      // Position overlay-content where cursor is
      const overlayContent = overlay.querySelector('.overlay-content');
      // Account for scroll offset
      overlayContent.style.left = event.clientX + window.scrollX + (overlayContent.offsetWidth / 2) + 5 + 'px';
      overlayContent.style.top = event.clientY + window.scrollY - (overlayContent.offsetHeight / 2) + 'px';
      // Add event listener to close overlay when clicking outside of overlay-content
      document.addEventListener('click', closeOverlayOnClickOutside);
    });
}

// Function to close overlay when clicking outside of overlay-content
function closeOverlayOnClickOutside(event) {
  const overlayContent = document.querySelector('.overlay-content');
  if (!overlayContent.contains(event.target)) {
      const overlay = document.querySelector('.overlay');
      overlay.remove();
      document.removeEventListener('click', closeOverlayOnClickOutside);
  }
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