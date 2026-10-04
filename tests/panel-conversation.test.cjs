const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const script = fs.readFileSync(path.join(__dirname, '..', 'ai-chat-outline.js'), 'utf8');
const code = script.slice(script.indexOf('    function getPanelConversationContext('),
    script.indexOf('    // DOM observation and message ordering'));

function fixture(site, id = 'first') {
    const panel = { collapsed: true, classList: { contains: () => panel.collapsed } };
    const calls = [];
    const context = vm.createContext({
        ADAPTER: { id: site }, STATE: { panelConversationContext: '' },
        window: { location: { pathname: `/app/${id}` }, setTimeout: () => 0 },
        conversationId: id,
        getPanelElement: () => panel,
        setPanelCollapsed: (panel, collapsed, persist) => {
            panel.collapsed = collapsed;
            calls.push({ collapsed, persist });
        },
        readStorageValue: () => '1', STORAGE_KEYS: { collapsed: 'collapsed' },
        scheduleAutoCollapse() {},
        scheduleActiveSync() {}, cancelClickNavigationTracking() {}
    });
    vm.runInContext('function getChatGptConversationId(){return conversationId;} function getClaudeConversationId(){return conversationId;}', context);
    vm.runInContext(code, context);
    return { context, panel, calls };
}

for (const site of ['chatgpt', 'claude', 'gemini']) {
    test(`${site}: open on entry, respect manual collapse, reopen on conversation change`, () => {
        const { context, panel, calls } = fixture(site);
        context.restorePanelState(panel);
        assert.equal(panel.collapsed, false);
        panel.collapsed = true;
        context.syncPanelForConversation();
        assert.equal(panel.collapsed, true);
        assert.equal(calls.length, 1);
        context.conversationId = 'second';
        context.window.location.pathname = '/app/second';
        context.syncPanelForConversation();
        assert.equal(panel.collapsed, false);
        assert.equal(calls.length, 2);
        assert.ok(calls.every(call => call.persist === false));
    });
}

test('leaving and reentering the same conversation opens it again', () => {
    const { context, panel } = fixture('chatgpt');
    context.syncPanelForConversation();
    panel.collapsed = true;
    context.conversationId = '';
    context.syncPanelForConversation();
    assert.equal(panel.collapsed, true);
    context.conversationId = 'first';
    context.syncPanelForConversation();
    assert.equal(panel.collapsed, false);
});

test('Gemini account path is supported; homepage retains stored collapse', () => {
    const { context, panel } = fixture('gemini');
    context.window.location.pathname = '/u/1/app/second';
    assert.equal(context.getPanelConversationContext(), 'gemini:second');
    context.window.location.pathname = '/app';
    context.restorePanelState(panel);
    assert.equal(panel.collapsed, true);
});

test('entering a conversation clears previous highlight and follow pause', () => {
    const { context } = fixture('chatgpt');
    Object.assign(context.STATE, { activeIndex: 80, forcedActiveIndex: 80, tocUserScrollUntil: Infinity });
    context.syncPanelForConversation();
    assert.equal(context.STATE.activeIndex, -1);
    assert.equal(context.STATE.forcedActiveIndex, -1);
    assert.equal(context.STATE.tocUserScrollUntil, 0);
});

test('follow uses list-relative geometry and does not reset a middle entry to top', () => {
    const list = {
        scrollTop: 0, clientHeight: 200, clientTop: 1,
        getBoundingClientRect: () => ({ top: 100 })
    };
    const item = {
        offsetHeight: 30,
        getBoundingClientRect: () => ({ top: 901, height: 30 })
    };
    const context = vm.createContext({
        STATE: { activeIndex: 49 },
        window: { setTimeout: () => 0 },
        shouldPauseTocFollow: () => false,
        getTocList: () => list,
        getActiveScrollContainer: () => ({}), getScrollTop: () => 0
    });
    vm.runInContext(script.slice(script.indexOf('    function setTocListScrollTop('),
        script.indexOf('    function setActiveIndex(')), context);
    context.syncItemIntoView(list, item);
    assert.equal(list.scrollTop, 715);
    context.syncTocToTopIfNeeded();
    assert.equal(list.scrollTop, 715);
    context.STATE.activeIndex = 0;
    context.syncTocToTopIfNeeded();
    assert.equal(list.scrollTop, 0);
});
