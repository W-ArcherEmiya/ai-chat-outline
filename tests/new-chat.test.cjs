const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname, '..', 'ai-chat-outline.js'), 'utf8');
const code = script.slice(script.indexOf('    function rememberChatGptPreviousMessages('), script.indexOf('    function resetChatGptConversationState('));
function fixture() {
    const old = { identityKeys: ['message:old'], text: 'same', anchor: {} };
    const state = { messages: [old], chatGptCatalogMessages: [old], remoteMessages: [old] };
    const context = vm.createContext({ STATE: state,
        getMessageIdentityKeys: message => message.identityKeys || [],
        replaceChatGptCatalog: messages => { state.chatGptCatalogMessages = messages; }
    });
    vm.runInContext(code, context);
    context.rememberChatGptPreviousMessages();
    return { old, state, context };
}
test('old conversation DOM is rejected on new-chat page, including remounted nodes', () => {
    const { old, context } = fixture();
    assert.equal(context.collectChatGptNewChatMessages([old, { ...old, anchor: {} }], 'chatgpt.com/').length, 0);
});
test('new first message with identical text and a fresh ID is retained', () => {
    const { old, context } = fixture();
    const fresh = { ...old, identityKeys: ['message:new'] };
    const result = context.collectChatGptNewChatMessages([old, fresh], 'chatgpt.com/');
    assert.equal(result.length, 1);
    assert.equal(result[0], fresh);
});
test('unsaved new-chat messages are removed when DOM is empty, not retained', () => {
    const { state, context } = fixture();
    context.collectChatGptNewChatMessages([{ text: 'new', anchor: {} }], 'chatgpt.com/');
    context.collectChatGptNewChatMessages([], 'chatgpt.com/');
    assert.equal(state.chatGptCatalogMessages.length, 0);
});
test('old nodes without identity are excluded; new nodes without identity are accepted', () => {
    const { old, context } = fixture();
    const fresh = { text: 'first', anchor: {} };
    const result = context.collectChatGptNewChatMessages([{ anchor: old.anchor }, fresh], 'chatgpt.com/');
    assert.equal(result.length, 1);
    assert.equal(result[0], fresh);
});

test('rapid A to B to C navigation keeps excluding A after B is remembered', () => {
    const { old, context, state } = fixture();
    state.messages = [{ identityKeys: ['message:B'], anchor: {} }];
    state.chatGptCatalogMessages = [];
    state.remoteMessages = [];
    context.rememberChatGptPreviousMessages();
    assert.equal(context.collectChatGptNewChatMessages([old, ...state.messages], 'new-chat').length, 0);
});

function installMerge(context) {
    // Normalize CRLF so the object-method boundary is the same on all checkouts.
    const normalized = script.replace(/\r\n/g, '\n');
    const a = normalized.indexOf('            mergeMessages(liveMessages) {');
    const b = normalized.indexOf('\n        },\n        gemini:', a);
    assert.ok(a >= 0 && b > a);
    vm.runInContext(`merge = ({${normalized.slice(a, b)}}).mergeMessages`, context);
    context.getChatGptMessageCacheContext = () => 'chatgpt:B';
    context.getChatGptConversationId = () => 'B';
    context.annotateMessagesWithNativeToc = () => {};
    context.bindLiveMessagesToChatGptCatalog = messages => messages;
}

test('saved conversation never adopts stale DOM after the former two-second timeout', () => {
    const { old, context, state } = fixture();
    installMerge(context);
    state.chatGptRouteChangedAt = 0;
    state.remoteMessageContext = 'chatgpt:A';
    state.remoteMessageIsAuthoritative = true;
    assert.equal(context.merge([old]).length, 0);
    assert.equal(state.lastTocSource, 'chatgpt-awaiting-current-conversation');
});

test('authoritative B keeps its order and rejects stale A as a live tail', () => {
    const { old, context, state } = fixture();
    installMerge(context);
    const b = { identityKeys: ['message:B'], text: 'B', anchor: {} };
    const fresh = { identityKeys: ['message:B-new'], text: 'first new question', anchor: {} };
    state.remoteMessages = [b];
    state.remoteMessageContext = 'chatgpt:B';
    state.remoteMessageIsAuthoritative = true;
    context.mergeChatGptAuthoritativeBranchWithLiveTail = (remote, live) => {
        assert.equal(live.includes(old), false);
        assert.equal(live.includes(b), true);
        assert.equal(live.includes(fresh), true);
        return remote;
    };
    const result = context.merge([b, old, fresh]);
    assert.equal(result.length, 1);
    assert.equal(result[0], b);
});

test('saved conversation accepts a new message ID on a recycled old DOM node', () => {
    const { old, context, state } = fixture();
    installMerge(context);
    const b = { identityKeys: ['message:B'], text: 'B' };
    const fresh = { identityKeys: ['message:new'], text: 'new question', anchor: old.anchor };
    state.remoteMessages = [b];
    state.remoteMessageContext = 'chatgpt:B';
    state.remoteMessageIsAuthoritative = true;
    context.mergeChatGptAuthoritativeBranchWithLiveTail = (remote, live) => {
        assert.equal(live.includes(fresh), true);
        assert.equal(live.includes(old), false);
        return remote;
    };
    context.merge([b, old, fresh]);
});
