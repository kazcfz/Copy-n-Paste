// Periodically listen for new version
const interval = 150;
const checkForUpdate = () => chrome.runtime.requestUpdateCheck(() => { });
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (!message || message.Type !== 'CnP-inject-main-world')
		return false;

	if (!sender.tab || !chrome.scripting || typeof chrome.scripting.executeScript !== 'function') {
		sendResponse({ ok: false });
		return false;
	}

	chrome.scripting.executeScript({
		target: { tabId: sender.tab.id, frameIds: [sender.frameId] },
		files: ['init.js'],
		world: 'MAIN'
	}, () => sendResponse({ ok: !chrome.runtime.lastError }));

	return true;
});
chrome.runtime.onUpdateAvailable.addListener(() => chrome.runtime.reload());
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('u', { periodInMinutes: interval }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create('u', { periodInMinutes: interval }));
chrome.alarms.onAlarm.addListener(a => a.name === 'u' && checkForUpdate());
checkForUpdate();