const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const script = fs.readFileSync(path.join(__dirname, '..', 'ai-chat-outline.js'), 'utf8');
const code = script.slice(
    script.indexOf('    function getCommittedChatGptNavigationFiber('),
    script.indexOf('    async function navigateWithChatGptRemoteToc(')
);
const entry = id => ({ turn: { messageIds: [id] } });

function fixture({ top = 70, drift = false } = {}) {
    let now = 1000;
    let loaded = false;
    let navigated = false;
    let historyCalls = 0;
    let apiCalls = 0;
    let context = 'conversation';
    const currentRoot = { stateNode: {} };
    const oldRoot = { stateNode: currentRoot.stateNode };
    currentRoot.stateNode.current = currentRoot;
    const owner = { return: currentRoot };
    const oldOwner = { return: oldRoot };
    owner.alternate = oldOwner;
    oldOwner.alternate = owner;
    currentRoot.child = owner;
    oldRoot.child = oldOwner;
    const api = {
        async scrollToMessage(id) {
            apiCalls++;
            assert.equal(id, 'far');
            assert.equal(loaded, true, 'history must load before ID navigation');
            navigated = true;
        }
    };
    owner.memoizedProps = {
        conversationId: 'conversation',
        ref: { current: api },
        entries: Array.from({ length: 5 }, (_, i) => entry(`near-${i}`))
    };
    oldOwner.memoizedProps = {
        ...owner.memoizedProps,
        entries: [...owner.memoizedProps.entries, entry('far')]
    };
    owner.child = {
        memoizedProps: {
            conversationSource: {
                contextId: 'chatgpt:conversation',
                async search(query) {
                    historyCalls++;
                    assert.equal(query.query.trim(), '');
                    loaded = true;
                    owner.memoizedProps.entries = [...owner.memoizedProps.entries, entry('far')];
                }
            }
        }
    };
    oldOwner.child = {
        memoizedProps: {
            conversationSource: {
                contextId: 'chatgpt:conversation',
                search() { throw new Error('stale search source used'); }
            }
        }
    };
    const domRoot = { closest: () => null, __reactFiber$test: { return: oldOwner } };
    const target = {
        isConnected: true,
        getBoundingClientRect() {
            const y = drift && now >= 1200 ? -800 : top;
            return { top: y, bottom: y + 228, height: 228 };
        }
    };
    const state = { lastTocClick: {}, messages: [{}] };
    const sandbox = vm.createContext({
        AbortController, Set, Promise,
        Date: { now: () => now },
        window: { setTimeout, clearTimeout, setInterval, clearInterval, innerHeight: 900 },
        STATE: state,
        getPanelElement: () => null,
        ADAPTER: { id: 'chatgpt' },
        getPageWindow: () => ({ document: { querySelectorAll: () => [domRoot] } }),
        getChatGptConversationId: () => context,
        getChatGptMessageCacheContext: () => context,
        getMessageIdFromIdentityKey: key => key.replace(/^message:/, ''),
        getMessageIdentityKeys: () => ['message:far'],
        getMessageRemoteIndex: () => 116,
        clearJumpSyncTimer() {}, clearVirtualSeekTimer() {}, scheduleActiveSync() {},
        attachResolvedUserElementToMessage() {},
        findLiveUserElementByIdentityKeys: () => navigated ? target : null,
        findScrollContainerForElement: () => ({ getBoundingClientRect: () => ({ top: 52, bottom: 900 }) }),
        waitForMilliseconds: async ms => { now += ms; }
    });
    vm.runInContext(code, sandbox);
    return {
        sandbox, state, owner, oldOwner,
        counts: () => ({ historyCalls, apiCalls }),
        changeContext: () => { context = 'other'; },
        navigate: () => sandbox.navigateWithChatGptMessageApi(sandbox.getChatGptMessageNavigationApi(), {}, 116)
    };
}

test('stale DOM fiber resolves to committed navigation owner', () => {
    const f = fixture();
    assert.equal(f.sandbox.getCommittedChatGptNavigationFiber(f.oldOwner), f.owner);
    assert.equal(f.sandbox.getChatGptMessageNavigationApi().entries.length, 5);
});

test('target in alternate tree does not skip history loading', async () => {
    const f = fixture();
    const nav = f.sandbox.getChatGptMessageNavigationApi();
    assert.equal(f.sandbox.chatGptNavigationHasMessage(nav, ['message:far']), false);
    await f.navigate();
    assert.deepEqual(f.counts(), { historyCalls: 1, apiCalls: 1 });
    assert.equal(f.state.lastNavigationDebug.historyLoaded, true);
    assert.equal(f.state.lastNavigationDebug.mode, 'remote-message-api-visible');
    assert.ok(f.state.lastNavigationDebug.viewportSamples.length >= 5);
});

test('mounted offscreen target is not reported as successful', async () => {
    const f = fixture({ top: -800 });
    await f.navigate();
    assert.equal(f.state.lastNavigationDebug.mode, 'remote-message-api-not-aligned');
    assert.deepEqual(f.counts(), { historyCalls: 1, apiCalls: 1 });
});

test('transient visibility followed by displacement is not successful', async () => {
    const f = fixture({ drift: true });
    await f.navigate();
    assert.equal(f.state.lastNavigationDebug.mode, 'remote-message-api-not-aligned');
    assert.equal(f.state.lastNavigationDebug.viewportSamples[0].aligned, true);
    assert.equal(f.state.lastNavigationDebug.viewportSamples.at(-1).aligned, false);
});

test('stale source is not reused if current source is missing', async () => {
    const f = fixture();
    f.owner.child = null;
    await f.navigate();
    assert.equal(f.state.lastNavigationDebug.mode, 'remote-message-history-source-unavailable');
    assert.deepEqual(f.counts(), { historyCalls: 0, apiCalls: 0 });
});

test('conversation change during history load cancels ID navigation', async () => {
    const f = fixture();
    f.owner.child.memoizedProps.conversationSource.search = async () => f.changeContext();
    await f.navigate();
    assert.equal(f.counts().apiCalls, 0);
});

test('concurrent history consumers share a single search request', async () => {
    const f = fixture();
    let searches = 0;
    let finish;
    const source = { search: () => {
        searches++;
        return new Promise(resolve => { finish = resolve; });
    } };
    const first = f.sandbox.loadChatGptNativeHistory(source);
    const second = f.sandbox.loadChatGptNativeHistory(source);
    assert.equal(first, second);
    await Promise.resolve();
    assert.equal(searches, 1);
    finish();
    await first;
    assert.equal(f.state.chatGptHistoryLoad, null);
});

test('route cleanup aborts the shared load', async () => {
    const f = fixture();
    let signal;
    const pending = f.sandbox.loadChatGptNativeHistory({ search: (_, options) => {
        signal = options.signal;
        return new Promise(() => {});
    } });
    await Promise.resolve();
    f.sandbox.clearChatGptHistoryWarmup();
    await assert.rejects(pending, /history-load-cancelled/);
    assert.equal(signal.aborted, true);
    assert.equal(f.state.chatGptHistoryLoad, null);
});

test('background warmup loads history without scrolling and runs once per route', async () => {
    const f = fixture();
    f.sandbox.scheduleChatGptHistoryWarmup();
    f.sandbox.scheduleChatGptHistoryWarmup();
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.deepEqual(f.counts(), { historyCalls: 1, apiCalls: 0 });
    assert.equal(f.state.chatGptHistoryWarmupDebug.mode, 'history-warmup-ready');
    f.sandbox.scheduleChatGptHistoryWarmup();
    assert.equal(f.state.chatGptHistoryWarmupTimer, 0);
    await f.navigate();
    assert.deepEqual(f.counts(), { historyCalls: 1, apiCalls: 1 });
});

test('only the latest click navigates after shared history finishes', async () => {
    const f = fixture();
    const source = f.owner.child.memoizedProps.conversationSource;
    const original = source.search;
    let finish;
    source.search = async query => {
        await new Promise(resolve => { finish = resolve; });
        await original(query);
    };
    const firstClick = { identityKeys: ['message:far'] };
    f.state.lastTocClick = firstClick;
    const first = f.navigate();
    await Promise.resolve();
    assert.equal(f.state.chatGptNavigationStatus, 'loading');
    assert.equal(f.state.chatGptPendingClick, firstClick);
    const lastClick = { identityKeys: ['message:far'] };
    f.state.lastTocClick = lastClick;
    const last = f.navigate();
    assert.equal(f.state.chatGptPendingClick, lastClick);
    finish();
    await Promise.all([first, last]);
    assert.deepEqual(f.counts(), { historyCalls: 1, apiCalls: 1 });
    assert.equal(f.state.chatGptPendingClick, null);
    assert.equal(f.state.chatGptNavigationStatus, '');
});

test('failed preparation clears waiting marker and exposes retry state', async () => {
    const f = fixture();
    f.owner.child.memoizedProps.conversationSource.search = async () => { throw new Error('offline'); };
    await f.navigate();
    assert.equal(f.state.chatGptNavigationStatus, 'error');
    assert.equal(f.state.chatGptPendingClick, null);
    f.sandbox.clearChatGptHistoryWarmup();
    assert.equal(f.state.chatGptNavigationStatus, '');
});

test('mounted first message does not require a native history API', async () => {
    const f = fixture();
    f.owner.memoizedProps.ref.current = null;
    f.sandbox.findLiveUserElementByIdentityKeys = () => ({ isConnected: true });
    f.sandbox.scheduleChatGptHistoryWarmup();
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(f.state.chatGptNavigationStatus, '');
    assert.equal(f.state.chatGptHistoryWarmupTimer, 0);
    assert.deepEqual(f.counts(), { historyCalls: 0, apiCalls: 0 });
});

test('startup API absence is deferred, then a later render can preload', async () => {
    const f = fixture();
    const api = f.owner.memoizedProps.ref.current;
    f.owner.memoizedProps.ref.current = null;
    f.sandbox.scheduleChatGptHistoryWarmup(7);
    await new Promise(resolve => setTimeout(resolve, 850));
    assert.equal(f.state.chatGptHistoryWarmupDebug.mode, 'history-warmup-deferred');
    assert.notEqual(f.state.chatGptNavigationStatus, 'error');
    assert.notEqual(f.state.chatGptHistoryWarmupContext, 'conversation');
    f.owner.memoizedProps.ref.current = api;
    f.sandbox.scheduleChatGptHistoryWarmup();
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(f.state.chatGptHistoryWarmupDebug.mode, 'history-warmup-ready');
    assert.deepEqual(f.counts(), { historyCalls: 1, apiCalls: 0 });
});

test('an actual background history failure still exposes retry', async () => {
    const f = fixture();
    f.owner.child.memoizedProps.conversationSource.search = async () => { throw new Error('offline'); };
    f.sandbox.scheduleChatGptHistoryWarmup();
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(f.state.chatGptNavigationStatus, 'error');
    assert.equal(f.state.chatGptHistoryWarmupDebug.mode, 'remote-message-history-error');
});
