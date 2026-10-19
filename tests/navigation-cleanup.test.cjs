const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'ai-chat-outline.js'), 'utf8');
const code = source.slice(source.indexOf('    async function navigateWithChatGptRemoteToc('), source.indexOf('    function seekVirtualMessageIntoView('));
function fixture() {
    const calls = [];
    const target = { isConnected: true, scrollIntoView: () => calls.push('mounted') };
    const context = vm.createContext({
        STATE: {}, getChatGptMessageNavigationApi: () => null,
        getChatGptConversationId: () => 'saved',
        waitForChatGptNavigationAndNavigate: async () => { calls.push('wait'); return true; },
        navigateWithChatGptMessageApi: async () => { calls.push('native'); return true; },
        getMessageIdentityKeys: () => ['message:one'],
        findLiveUserElementByIdentityKeys: () => target,
        getMessageTarget: () => target,
        attachResolvedUserElementToMessage() {}, scheduleActiveSync() {},
        setChatGptNavigationStatus: status => calls.push(status)
    });
    vm.runInContext(code, context);
    return { context, calls, target };
}
test('saved conversation waits for native API instead of using mounted or coordinate fallback', async () => {
    const f = fixture();
    await f.context.navigateWithChatGptRemoteToc({}, 0);
    assert.deepEqual(f.calls, ['wait']);
});
test('ready native API retains priority', async () => {
    const f = fixture();
    f.context.getChatGptMessageNavigationApi = () => ({});
    await f.context.navigateWithChatGptRemoteToc({}, 0);
    assert.deepEqual(f.calls, ['native']);
});
test('unsaved first message can still navigate its mounted bubble', async () => {
    const f = fixture();
    f.context.getChatGptConversationId = () => '';
    await f.context.navigateWithChatGptRemoteToc({}, 0);
    assert.deepEqual(f.calls, ['mounted', '']);
});
test('missing unsaved target shows retry without starting a seek loop', async () => {
    const f = fixture();
    f.context.getChatGptConversationId = () => '';
    f.target.isConnected = false;
    await f.context.navigateWithChatGptRemoteToc({}, 0);
    assert.deepEqual(f.calls, ['error']);
});
test('removed GPT seek functions have no remaining definitions or calls', () => {
    for (const name of ['scrollChatGptSlotForRevive', 'resolveMountedChatGptRemoteTarget', 'seekMountedChatGptRemoteTarget', 'waitForMountedChatGptRemoteTarget']) {
        assert.equal(source.includes(name), false, name);
    }
    for (const name of ['runBoundaryScroll', 'navigateClaudeVirtualMessage', 'scrollVirtualMessageIntoView']) {
        assert.ok(source.includes(`function ${name}(`), name);
    }
});
