/*
Runs in the page's MAIN world at document_start, before any page script.
Some file pickers never produce a click event that content.js can see:
detached inputs (created with JS but never added to the page) and showPicker().
This hands them to content.js, which decides whether to show the overlay.
Nothing here touches clipboard data.
*/
(() => {
    const nativeClick = HTMLElement.prototype.click;
    const nativeShowPicker = HTMLInputElement.prototype.showPicker;
    const isFileInput = el => el.localName === 'input' && el.type === 'file';

    // Returns true when content.js takes over (it cancels the event).
    function offerToExtension(input) {
        // relatedTarget is how a detached element reaches the isolated world; connected ones travel via composedPath()
        const event = input.isConnected
            ? new CustomEvent('cnp-picker', { bubbles: true, composed: true, cancelable: true })
            : new MouseEvent('cnp-picker', { cancelable: true, relatedTarget: input });
        return !(input.isConnected ? input : document).dispatchEvent(event);
    }

    HTMLElement.prototype.click = function click() {
        // Connected inputs are handled by content.js's click listener
        if (isFileInput(this) && !this.isConnected && offerToExtension(this))
            this.addEventListener('click', event => event.preventDefault(), { capture: true, once: true });
        return nativeClick.call(this);
    };

    if (nativeShowPicker)
        HTMLInputElement.prototype.showPicker = function showPicker() {
            if (isFileInput(this) && offerToExtension(this))
                return;
            return nativeShowPicker.call(this);
        };
})();
