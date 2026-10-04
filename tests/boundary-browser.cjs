const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const script = fs.readFileSync(path.join(__dirname, '..', 'ai-chat-outline.js'), 'utf8');
const extract = (start, end) => script.slice(script.indexOf(`    ${start}`), script.indexOf(`    ${end}`));
const code = extract('function syncBoundaryTocPosition(', 'function runBoundaryScroll(') +
    extract('function setTocListScrollTop(', 'function findActiveMessageIndex(') +
    extract('function bindLiveMessagesToChatGptCatalog(', 'function snapshotChatGptCatalogMessage(');

(async () => {
    const browser = await chromium.launch({
        ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : { channel: 'msedge' }),
        headless: true
    });
    try {
        for (const width of [360, 1280]) {
            const page = await browser.newPage({ viewport: { width, height: 800 } });
            await page.setContent('<style>body{font:14px sans-serif;margin:12px}#thread{height:600px;overflow:auto;border:1px solid #aaa}article{padding:12px}#toc-list{height:80px;overflow:auto;margin:0;padding:0;list-style:none}#toc-list li{height:24px}.toc-active{background:#def}</style><button id="top">Top</button><button id="bottom">Bottom</button><ul id="toc-list"></ul><main id="thread"></main>');
            const results = await page.evaluate(async ({ code }) => {
                window.STATE = {};
                window.getChatGptMessageCacheContext = () => 'fixture';
                window.getMessageIdentityKeys = m => m.identityKeys;
                window.getLastMessageIndex = () => STATE.messages.length - 1;
                window.setButtonIcon = (button, icon) => { button.dataset.icon = icon; };
                window.beginForcedBoundaryNavigation = index => { STATE.forcedActiveIndex = index; };
                window.scheduleActiveSync = () => {};
                window.getTocList = () => document.getElementById('toc-list');
                window.shouldPauseTocFollow = () => Date.now() < STATE.tocUserScrollUntil;
                window.waitForMilliseconds = ms => new Promise(resolve => setTimeout(resolve, ms));
                window.getComparableMessageText = text => text;
                window.createMessageIdentityKeys = (...keys) => [...new Set(keys.flat())];
                window.snapshotChatGptCatalogMessage = m => ({ ...m, identityKeys: [...m.identityKeys] });
                window.snapshotChatGptCatalogMessages = messages => messages.map(m => ({ ...m }));
                window.annotateMessagesWithNativeToc = () => {};
                (0, eval)(code);
                const thread = document.getElementById('thread');
                let generation = 0;
                let lastMounted = false;
                let nativeCalls = 0;
                function render(index) {
                    generation++;
                    thread.replaceChildren();
                    const start = Math.max(0, index - 4);
                    const live = [];
                    for (let i = start; i <= index; i++) {
                        const article = document.createElement('article');
                        article.dataset.id = `message:${i}`;
                        article.textContent = `${i}: ${STATE.messages[i].text}`;
                        const answer = document.createElement('div');
                        answer.style.height = i === STATE.messages.length - 1 ? '1800px' : '350px';
                        answer.textContent = 'Assistant response';
                        article.append(answer);
                        thread.append(article);
                        live.push({ ...STATE.messages[i], remoteIndex: i - start, anchor: article });
                    }
                    lastMounted = index === STATE.messages.length - 1;
                    const bound = bindLiveMessagesToChatGptCatalog(STATE.messages, live.reverse());
                    for (let i = 0; i < bound.length; i++) {
                        if (bound[i].identityKeys.length !== 1 || bound[i].identityKeys[0] !== `message:${i}`) throw Error('catalog identity changed');
                        if (bound[i].anchor && bound[i].anchor.dataset.id !== `message:${i}`) throw Error('wrong DOM binding');
                    }
                    const list = getTocList();
                    list.replaceChildren(...bound.map(m => {
                        const item = document.createElement('li');
                        item.textContent = m.identityKeys[0];
                        return item;
                    }));
                }
                window.getChatGptMessageNavigationApi = () => ({});
                window.navigateWithChatGptMessageApi = async (_, message, index) => {
                    await waitForMilliseconds(30);
                    if (message.identityKeys[0] !== `message:${index}`) throw Error('wrong requested ID');
                    render(index);
                    thread.lastElementChild.scrollIntoView({ block: 'start' });
                    STATE.lastNavigationDebug = { mode: 'remote-message-api-visible' };
                };
                window.getChatGptBottomNavigationApi = () => {
                    const ownerGeneration = generation;
                    return {
                        scrollToBottom() {
                            nativeCalls++;
                            // Model an old controller or an unloaded final turn as a no-op.
                            if (ownerGeneration === generation && lastMounted) thread.scrollTop = thread.scrollHeight;
                        },
                        getUnroundedScrollDistanceFromBottomPx: () => thread.scrollHeight - thread.clientHeight - thread.scrollTop
                    };
                };
                const results = [];
                for (const count of [3, 122]) {
                    STATE.messages = Array.from({ length: count }, (_, i) => ({ text: i % 2 ? 'Repeated question' : `Question ${i}`, identityKeys: [`message:${i}`], remoteIndex: i }));
                    STATE.activeIndex = -1;
                    render(Math.min(count - 1, 4));
                    for (let round = 0; round < 3; round++) {
                        const middle = Math.floor(count / 2);
                        await navigateWithChatGptMessageApi({}, STATE.messages[middle], middle);
                        setActiveIndex(middle);
                        STATE.tocUserScrollUntil = Date.now() + 5000;
                        await navigateChatGptBoundary(document.getElementById('top'), 'top');
                        if (getTocList().scrollTop !== 0 || STATE.activeIndex !== 0) throw Error('directory did not follow top after middle navigation');
                        await navigateWithChatGptMessageApi({}, STATE.messages[middle], middle);
                        setActiveIndex(middle);
                        STATE.tocUserScrollUntil = Date.now() + 5000;
                        getTocList().scrollTop = 0;
                        await navigateChatGptBoundary(document.getElementById('bottom'), 'bottom');
                        const gap = thread.scrollHeight - thread.clientHeight - thread.scrollTop;
                        if (gap > 2 || STATE.lastBoundaryDebug.mode !== 'native-bottom-confirmed') throw Error(`bottom failed: ${gap}`);
                        if (document.getElementById('bottom').disabled) throw Error('button stuck');
                        const listRect = getTocList().getBoundingClientRect();
                        const itemRect = getTocList().lastElementChild.getBoundingClientRect();
                        if (STATE.activeIndex !== count - 1 || itemRect.top < listRect.top - 1 || itemRect.bottom > listRect.bottom + 1) throw Error('directory did not follow bottom');
                    }
                    results.push({ count, rounds: 3, mode: STATE.lastBoundaryDebug.mode });
                }
                return { results, nativeCalls };
            }, { code });
            assert.equal(results.nativeCalls, 6);
            console.log(JSON.stringify({ width, ...results }));
            await page.screenshot({ path: path.join(os.tmpdir(), `boundary-browser-${width}.png`) });
            await page.close();
        }
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
