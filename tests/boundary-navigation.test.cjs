const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname, '..', 'ai-chat-outline.js'), 'utf8');
const code = script.slice(script.indexOf('    function getChatGptBottomNavigationApi('),
    script.indexOf('    function runBoundaryScroll('));

function fixture() {
    let now = 0;
    let calls = 0;
    const api = { scrollToBottom() { calls++; }, getScrollElement: () => ({ isConnected: true, contains: () => true }),
        getUnroundedScrollDistanceFromBottomPx: () => 0 };
    const root = { closest: () => null, __reactFiber$test: { memoizedProps: { value: api } } };
    const state = { messages: [{ id: 'first' }] };
    const button = { disabled: false };
    const sandbox = vm.createContext({
        STATE: state, Date: { now: () => now },
        window: { setInterval, clearInterval, setTimeout, clearTimeout },
        getPageWindow: () => ({ document: { querySelectorAll: () => [root] } }),
        getCommittedChatGptNavigationFiber: fiber => fiber,
        getChatGptMessageNavigationApi: () => ({}),
        getChatGptMessageCacheContext: () => 'conversation',
        getMessageIdentityKeys: message => [`message:${message.id}`], getLastMessageIndex: () => state.messages.length - 1,
        setButtonIcon: (btn, icon) => { btn.icon = icon; },
        beginForcedBoundaryNavigation: index => { state.forcedActiveIndex = index; },
        scheduleActiveSync() {},
        setActiveIndex: index => { state.activeIndex = index; },
        getTocList: () => null,
        waitForMilliseconds: async ms => { now += ms; },
        navigateWithChatGptMessageApi: async (_, message, index) => {
            assert.equal(message.id, 'first'); assert.equal(index, 0);
            state.lastNavigationDebug = { mode: 'remote-message-api-visible' };
        }
    });
    vm.runInContext(code, sandbox);
    return { sandbox, state, button, api, root, calls: () => calls };
}

test('native bottom is called once and completes without fixed long stabilization', async () => {
    const f = fixture();
    assert.equal(await f.sandbox.navigateChatGptBoundary(f.button, 'bottom'), true);
    assert.equal(f.calls(), 1);
    assert.equal(f.state.lastBoundaryDebug.mode, 'native-bottom-confirmed');
    assert.equal(f.state.lastBoundaryDebug.durationMs, 80);
    assert.equal(f.button.disabled, false);
    assert.equal(f.state.forcedActiveIndex, -1);
});

test('top delegates to first message ID navigation', async () => {
    const f = fixture();
    await f.sandbox.navigateChatGptBoundary(f.button, 'top');
    assert.equal(f.state.lastBoundaryDebug.mode, 'native-visible');
    assert.equal(f.calls(), 0);
});

test('unavailable native API allows legacy fallback', async () => {
    const f = fixture();
    f.api.getScrollElement = () => null;
    assert.equal(await f.sandbox.navigateChatGptBoundary(f.button, 'bottom'), false);
    assert.equal(f.calls(), 0);
});

test('native errors release button without dispatching a coordinate fallback', async () => {
    const f = fixture();
    f.api.scrollToBottom = () => { throw new Error('unavailable'); };
    assert.equal(await f.sandbox.navigateChatGptBoundary(f.button, 'bottom'), true);
    assert.equal(f.state.lastBoundaryDebug.mode, 'native-error');
    assert.equal(f.button.disabled, false);
});

test('cancellation releases button even when native promise never completes', async () => {
    const f = fixture();
    f.api.scrollToBottom = () => new Promise(() => {});
    const pending = f.sandbox.navigateChatGptBoundary(f.button, 'bottom');
    await Promise.resolve();
    f.state.cancelBoundaryNavigation();
    await pending;
    assert.equal(f.state.lastBoundaryDebug.mode, 'native-cancelled');
    assert.equal(f.button.disabled, false);
    assert.equal(f.state.cancelBoundaryNavigation, null);
});

test('unconfirmed bottom position is reported, not repeatedly scrolled', async () => {
    const f = fixture();
    f.api.getUnroundedScrollDistanceFromBottomPx = () => 100;
    await f.sandbox.navigateChatGptBoundary(f.button, 'bottom');
    assert.equal(f.calls(), 1);
    assert.equal(f.state.lastBoundaryDebug.mode, 'native-bottom-unconfirmed');
});

test('bottom does not claim success when final turn cannot be mounted', async () => {
    const f = fixture();
    f.sandbox.navigateWithChatGptMessageApi = async () => {
        f.state.lastNavigationDebug = { mode: 'remote-message-api-target-unmounted' };
    };
    await f.sandbox.navigateChatGptBoundary(f.button, 'bottom');
    assert.equal(f.calls(), 0);
    assert.equal(f.state.lastBoundaryDebug.mode, 'native-bottom-last-turn-unconfirmed');
    assert.equal(f.button.disabled, false);
});

test('confirmed bottom clears follow pause and retains the final active item after release', async () => {
    const f = fixture();
    f.state.tocUserScrollUntil = Infinity;
    f.state.activeIndex = -1;
    await f.sandbox.navigateChatGptBoundary(f.button, 'bottom');
    assert.equal(f.state.tocUserScrollUntil, 0);
    assert.equal(f.state.activeIndex, 0);
    assert.equal(f.state.clickLockIndex, 0);
    assert.equal(f.state.forcedActiveIndex, -1);
    assert.equal(f.state.lastBoundaryDebug.tocIndex, 0);
});

test('unconfirmed bottom does not retain a successful navigation lock', async () => {
    const f = fixture();
    f.state.tocUserScrollUntil = Infinity;
    f.state.activeIndex = -1;
    f.api.getUnroundedScrollDistanceFromBottomPx = () => 100;
    await f.sandbox.navigateChatGptBoundary(f.button, 'bottom');
    assert.equal(f.state.clickLockIndex, undefined);
    assert.equal(f.state.forcedActiveIndex, -1);
});

test('middle item pause is overridden by both top and bottom commands', async () => {
    const f = fixture();
    const list = { scrollHeight: 3000, scrollTop: 1200 };
    f.sandbox.getTocList = () => list;
    f.sandbox.setTocListScrollTop = (list, top) => { list.scrollTop = top; };
    f.state.tocUserScrollUntil = Infinity;
    await f.sandbox.navigateChatGptBoundary(f.button, 'top');
    assert.equal(list.scrollTop, 0);
    assert.equal(f.state.tocUserScrollUntil, 0);
    assert.equal(f.state.clickLockIndex, 0);
    f.state.messages.push({ id: 'last' });
    f.sandbox.navigateWithChatGptMessageApi = async () => { f.state.lastNavigationDebug = { mode: 'remote-message-api-visible' }; };
    list.scrollTop = 1200;
    f.state.tocUserScrollUntil = Infinity;
    await f.sandbox.navigateChatGptBoundary(f.button, 'bottom');
    assert.equal(list.scrollTop, 3000);
    assert.equal(f.state.clickLockIndex, 1);
});
