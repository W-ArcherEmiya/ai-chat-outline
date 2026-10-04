const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname, '..', 'ai-chat-outline.js'), 'utf8');
function fixture() {
    const context = vm.createContext({
        STATE: {},
        getComparableMessageText: text => text,
        getMessageIdentityKeys: message => message.identityKeys || [],
        createMessageIdentityKeys: (...keys) => [...new Set(keys.flat())],
        snapshotChatGptCatalogMessage: message => ({ ...message, identityKeys: [...message.identityKeys] }),
        snapshotChatGptCatalogMessages: messages => messages.map(message => ({ ...message })),
        annotateMessagesWithNativeToc() {},
        findOrderedComparableTextIndex: (texts, text, start, used) => texts.findIndex((value, index) => index >= start && value === text && !used?.has(index))
    });
    for (const [start, end] of [
        ['alignLiveMessagesByComparableText', 'getTextAlignmentPreview'],
        ['mergeRemoteAndLiveMessages', 'clearChatGptPendingRefresh'],
        ['bindLiveMessagesToChatGptCatalog', 'snapshotChatGptCatalogMessage']
    ]) vm.runInContext(script.slice(script.indexOf(`    function ${start}(`), script.indexOf(`    function ${end}(`)), context);
    return context;
}

for (const size of [3, 122]) {
    test(`${size} turns: duplicate text and recycled local indexes cannot reorder or rebind catalog`, () => {
        const f = fixture();
        const remote = Array.from({ length: size }, (_, i) => ({ text: i % 2 ? 'same question' : `question ${i}`, identityKeys: [`message:${i}`], remoteIndex: i }));
        for (const start of [0, Math.max(0, size - 5), 0, Math.floor(size / 2), Math.max(0, size - 5)]) {
            const live = remote.slice(start, start + 5).map((message, localIndex) => ({
                ...message, remoteIndex: localIndex,
                anchor: { isConnected: true, id: message.identityKeys[0] }
            })).reverse();
            const merged = f.mergeRemoteAndLiveMessages(remote, live).slice(0, size);
            const bound = f.bindLiveMessagesToChatGptCatalog(merged, live);
            assert.equal(bound.length, size);
            for (let i = 0; i < size; i++) {
                assert.equal(bound[i].text, remote[i].text);
                assert.deepEqual(Array.from(bound[i].identityKeys), remote[i].identityKeys);
                if (bound[i].anchor) assert.equal(bound[i].anchor.id, remote[i].identityKeys[0]);
            }
        }
    });
}

test('same text with a different known UUID is not bound to a catalog entry', () => {
    const f = fixture();
    const remote = [{ text: 'same', identityKeys: ['message:old'], remoteIndex: 0 }];
    const live = [{ text: 'same', identityKeys: ['message:new'], remoteIndex: 0, anchor: { isConnected: true, id: 'message:new' } }];
    const bound = f.bindLiveMessagesToChatGptCatalog(remote, live);
    assert.equal(bound[0].anchor, undefined);
    assert.deepEqual(Array.from(bound[0].identityKeys), ['message:old']);
});
