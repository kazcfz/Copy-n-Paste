/* 
Scripts that (must) run within the main world of the DOM,
which is the execution environment shared with the host page's JavaScript.
*/

// Detect programmatically created and clicked input elements to override
const originalClick = HTMLElement.prototype.click;
HTMLElement.prototype.click = function(...args) {
  if (this.matches("input[type='file']")) {
    setupcreateOverlay(this);
    originalClick.call(this, ...args);
  }
};
