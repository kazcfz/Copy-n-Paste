// Periodically listen for new version
const interval = 150;
const checkForUpdate = () => chrome.runtime.requestUpdateCheck(() => { });
chrome.runtime.onUpdateAvailable.addListener(() => chrome.runtime.reload());
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('u', { periodInMinutes: interval }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create('u', { periodInMinutes: interval }));
chrome.alarms.onAlarm.addListener(a => a.name === 'u' && checkForUpdate());
checkForUpdate();