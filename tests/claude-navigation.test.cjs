const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'ai-chat-outline.js'), 'utf8').replace(/\r\n/g, '\n');
function install(context, name) {
    const start = source.search(new RegExp(`    (?:async )?function ${name}\\(`));
    assert.ok(start >= 0);
    vm.runInContext(source.slice(start, source.indexOf('\n    }', start) + 6), context);
}
function matchingFixture() {
    const element = { isConnected: true, text: 'rendered text', id: 'target' };
    const context = vm.createContext({ document: {}, STATE: { messages: [{ text: 'stored text' }] },
        collectClaudeUserMessageElements: () => [element], getClaudeComparableText: text => text,
        getClaudeMessageTextElement: el => el, normalizeMessageText: el => el.text,
        findLiveUserElementByIdentityKeys: () => element,
        getMessageIdentityKeys: () => ['message:target'], resolveClaudeMessageContainer: el => el,
        isClaudeComposerElement: () => false, createMessageIdentityKeys: id => [`message:${id}`],
        getMessageIdentityKeyFromElement: el => el.id, getClaudeVirtualRowIndex: () => 1
    });
    install(context, 'findClaudeDirectUserElement');
    return { context, element };
}
test('exact identity accepts rendering differences in message text', () => {
    const { context, element } = matchingFixture();
    assert.equal(context.findClaudeDirectUserElement({ text: 'stored text' }, 0, 1).element, element);
});
test('text and row match never override conflicting known identity', () => {
    const { context, element } = matchingFixture();
    context.findLiveUserElementByIdentityKeys = () => null;
    element.id = 'other';
    element.text = 'stored text';
    assert.equal(context.findClaudeDirectUserElement({ text: 'stored text' }, 0, 1), null);
});
function navigationFixture() {
    let waits = 0, scrolled = 0, predictions = 0;
    const destinations = [];
    const state = { claudeJumpToken: 0, claudeRemoteMessages: [], claudeRemotePath: [] };
    const container = { scrollTop: 0, scrollHeight: 1100, clientHeight: 100,
        scrollTo: ({ top }) => destinations.push(top) };
    const context = vm.createContext({ STATE: state,
        getClaudeMountedVirtualRows: () => [],
        getClaudePredictedVirtualRow: () => ++predictions === 1 ? 5 : null,
        findClaudeDirectUserElement: () => waits === 8 ? { element: {}, source: 'virtual-id' } : null,
        getClaudeVirtualScrollContainer: () => container, getClaudeVirtualTotalRows: () => 11,
        getClaudeViewportVirtualRows: () => [], getMessageIdentityKeys: () => ['message:target'],
        waitForClaudeVirtualSettle: async () => { waits++; },
        scrollClaudeUserElementIntoView: () => { scrolled++; return true; }
    });
    install(context, 'navigateClaudeVirtualMessage');
    return { context, state, destinations, get scrolled() { return scrolled; } };
}
test('temporary missing prediction retains last known row, never coerces null to zero', async () => {
    const f = navigationFixture();
    await f.context.navigateClaudeVirtualMessage({ text: 'target' }, 0);
    assert.equal(f.destinations.length, 8);
    assert.ok(f.destinations.every(top => top === 500));
});
test('target mounted on last seek attempt is checked and navigated', async () => {
    const f = navigationFixture();
    assert.equal(await f.context.navigateClaudeVirtualMessage({ text: 'target' }, 0), true);
    assert.equal(f.scrolled, 1);
    assert.equal(f.state.lastNavigationDebug.mode, 'claude-virtual-id');
});
test('cancelled seek cannot scroll target after its final wait', async () => {
    const f = navigationFixture();
    f.context.waitForClaudeVirtualSettle = async () => { f.state.claudeJumpToken++; };
    assert.equal(await f.context.navigateClaudeVirtualMessage({ text: 'target' }, 0), false);
    assert.equal(f.scrolled, 0);
});
