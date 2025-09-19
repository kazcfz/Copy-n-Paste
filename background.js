// Periodically listen for new version
const interval = 150;
const checkForUpdate = () => chrome.runtime.requestUpdateCheck(() => { });
chrome.runtime.onUpdateAvailable.addListener(() => chrome.runtime.reload());
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('u', { periodInMinutes: interval }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create('u', { periodInMinutes: interval }));
chrome.alarms.onAlarm.addListener(a => a.name === 'u' && checkForUpdate());
checkForUpdate();

chrome.runtime.onInstalled.addListener(() => {
    chrome.scripting.registerContentScripts([{
        id: "mainworld-patch",
        js: ["mainworld.js"],
        matches: ["<all_urls>"],
        runAt: "document_start",
        world: "MAIN"
    }], () => {
        if (chrome.runtime.lastError) {
            console.error("Failed to register script:", chrome.runtime.lastError);
        } else {
            console.log("Main world script registered");
        }
    });
});