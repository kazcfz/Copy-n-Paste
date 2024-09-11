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
function previewImage(webCopiedImgSrc, readerEvent, blob) {
  let imagePreview = document.querySelector('#cnp-image-preview');
  const imagePreviewContainer = document.querySelector('#cnp-preview-container');
  const spinner = document.querySelector('.spinner');
  const badge = document.querySelector('.cnp-preview-badge');

  let fileName = blob.name;

  badge.title += fileName + '\n';
  badge.innerText = parseInt(badge.innerText) + 1;

  if (fileName == 'image.png' || !blob.name)
    fileName = 'CnP_'+new Date().toLocaleString().replace(/, /g, '_').replace(/[\/: ]/g, '')+'.'+blob.type.split('/').pop();

  if (!imagePreview) {
    // Preview image types
    if (blob.type.split('/')[0] == 'image') {
      imagePreview = document.createElement('img');
      imagePreview.id = 'cnp-image-preview';
      imagePreview.src = readerEvent.target.result;
      try {imagePreviewContainer.appendChild(imagePreview);} catch (error) {logging(error);}
      imagePreview.onload = () => spinner.style.display = 'none';
    } 
    // Preview PDF type
    else if (blob.type.split('/').pop() == 'pdf') {
      spinner.style.display = 'none';
      imagePreview = document.createElement('iframe');
      imagePreview.id = 'cnp-image-preview';
      imagePreview.type = blob.type;
      imagePreview.src = readerEvent.target.result + '#scrollbar=0&view=FitH,top&page=1&toolbar=0&statusbar=0&navpanes=0';
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
      imagePreview.src = readerEvent.target.result;
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
    if (fileName.length > 25)
      baseName = baseName.slice(0, 25) + '..';
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

  imagePreviewContainer.style.cursor = 'pointer';
  imagePreviewContainer.addEventListener('click', () => {
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
  }, {once: true});
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
          // Access clipboard to display latest copied images to overlay
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
                    previewImage(webCopiedImgSrc, readerEvent, file);
                    statusMap.set('success', statusMap.get('success') + 1);
                    resolve();
                  };
                  reader.onerror = () => {
                      statusMap.set('fail', statusMap.get('fail') + 1);
                      resolve(); // Resolve on error as well
                  };
                  reader.readAsDataURL(file);
              });
            };

            // Create an array of promises for each file and wait for all resolves
            const readPromises = Array.from(dataTransfer.files).map(file => {return readFileAsDataURL(file);});
            await Promise.all(readPromises);

            if (statusMap.get('fail') >= 1 && statusMap.get('success') <= 0)
              noImage();
          } else
            noImage();
        }
      }, { once: true, capture: true });
      
      document.execCommand('paste');
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
function noImage() {
  const CNP_notImage = document.createElement('span');
  CNP_notImage.id = 'cnp-not-image';
  CNP_notImage.textContent = 'Screenshot / Drop an image';

  const overlay = document.querySelector('.cnp-overlay');
  const imagePreviewContainer = overlay.querySelector('#cnp-preview-container');
  imagePreviewContainer.style.cursor = 'default';
  imagePreviewContainer.appendChild(CNP_notImage);

  const spinner = document.querySelector('.spinner');
  spinner.style.display = 'none';

  const badge = document.querySelector('.cnp-preview-badge');
  badge.style.display = 'none';
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
