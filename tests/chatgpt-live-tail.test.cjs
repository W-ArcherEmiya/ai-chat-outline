const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'ai-chat-outline.js'), 'utf8');
const msg = id => ({ identityKeys: [`message:${id}`], text: id });
function fixture() {
    const state = { pendingLiveContext: '', pendingLiveCatalogMessages: [] };
    const c = vm.createContext({ STATE: state,
        mergeRemoteAndLiveMessages: remote => remote,
        clearChatGptPendingRefresh: () => { state.pendingLiveCatalogMessages = []; state.pendingLiveContext = ''; },
        getMessageIdentityKeys: m => m.identityKeys || [], getComparableMessageText: text => text,
        findOrderedComparableTextIndex: (texts, text, start) => texts.indexOf(text, start),
        getCurrentChatGptTurnAlignmentMatches: () => [],
        snapshotChatGptCatalogMessage: m => ({ ...m }),
        scheduleChatGptPendingRefresh: messages => { state.pendingLiveMessages = messages.length; },
        window: { setTimeout() {} }, scheduleScan() {}
    });
    vm.runInContext(source.slice(source.indexOf('    function mergeChatGptAuthoritativeBranchWithLiveTail('),
        source.indexOf('    function snapshotChatGptCatalogMessages(')), c);
    return { state, merge: (remote, live, context = 'A') =>
        Array.from(c.mergeChatGptAuthoritativeBranchWithLiveTail(remote, live, context), m => m.text) };
}
test('new prompts continue after the remote tail unmounts', () => {
    const { merge } = fixture();
    assert.deepEqual(merge([msg('a')], [msg('a'), msg('b')]), ['a', 'b']);
    assert.deepEqual(merge([msg('a')], [msg('b'), msg('c')]), ['a', 'b', 'c']);
    assert.deepEqual(merge([msg('a')], [msg('c'), msg('d')]), ['a', 'b', 'c', 'd']);
    assert.deepEqual(merge([msg('a')], []), ['a', 'b', 'c', 'd']);
});
test('repeated scans do not duplicate live additions', () => {
    const { merge } = fixture();
    merge([msg('a')], [msg('a'), msg('b')]);
    for (let i = 0; i < 3; i++) assert.deepEqual(merge([msg('a')], [msg('b'), msg('c')]), ['a', 'b', 'c']);
});
test('route change cannot append previous pending messages', () => {
    const { merge } = fixture();
    merge([msg('a')], [msg('a'), msg('b')]);
    assert.deepEqual(merge([msg('x')], [msg('b'), msg('c')], 'B'), ['x']);
});
test('server confirmation removes duplicate pending entries', () => {
    const { merge } = fixture();
    merge([msg('a')], [msg('a'), msg('b')]);
    assert.deepEqual(merge([msg('a'), msg('b')], [msg('b'), msg('c')]), ['a', 'b', 'c']);
    assert.deepEqual(merge([msg('a'), msg('b'), msg('c')], [msg('c')]), ['a', 'b', 'c']);
});
