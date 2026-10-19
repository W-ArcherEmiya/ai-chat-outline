const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname, '..', 'ai-chat-outline.js'), 'utf8').replace(/\r\n/g, '\n');
const message = (id, text = id) => ({ text, identityKeys: id ? [`message:${id}`] : [] });

function fixture(remote) {
    const state = { claudeCatalogMessages: [], claudeRemoteMessages: remote,
        claudeRemoteContext: 'claude:A', claudeCatalogContext: '' };
    const context = vm.createContext({ STATE: state,
        getMessageIdentityKeys: m => m.identityKeys || [],
        createMessageIdentityKeys: (...keys) => [...new Set(keys.filter(Boolean))],
        getComparableMessageText: text => (text || '').trim(),
        getMessageTarget: m => m.anchor || m.container,
        getClaudeMessageContext: () => 'claude:A', getClaudeConversationId: () => 'A',
        collectClaudeDirectDomMessages: () => context.live
    });
    for (const name of ['snapshotChatGptCatalogMessage', 'snapshotChatGptCatalogMessages']) {
        const start = script.indexOf(`    function ${name}(`);
        const end = script.indexOf('\n    }', start) + 6;
        vm.runInContext(script.slice(start, end), context);
    }
    vm.runInContext(script.slice(script.indexOf('    function replaceClaudeCatalog('),
        script.indexOf('    const SITE_ADAPTERS')), context);
    const start = script.indexOf('            mergeMessages(liveMessages) {', script.indexOf('        claude: {'));
    const end = script.indexOf('\n            }', start) + '\n            }'.length;
    vm.runInContext(`merge = ({${script.slice(start, end)}}).mergeMessages`, context);
    return { state, scan(live) { context.live = live; return Array.from(context.merge(live)); } };
}

test('old conversation appends new prompts and retains them across scans and unmounts', () => {
    const a = message('a'), b = message('b'), c = message('c'), d = message('d');
    const { scan, state } = fixture([a, b]);
    scan([a, b]);
    assert.deepEqual(scan([b, c]).map(m => m.text), ['a', 'b', 'c']);
    assert.deepEqual(scan([c, d]).map(m => m.text), ['a', 'b', 'c', 'd']);
    assert.equal(scan([]).length, 4);
    state.claudeRemoteMessages = [a, b, c, d];
    assert.equal(scan([c, d]).length, 4);
});

test('same text with different IDs remains a distinct new prompt', () => {
    const a = message('a', 'again'), b = message('b', 'again');
    const { scan } = fixture([a]);
    assert.equal(scan([a, b]).length, 2);
    assert.equal(scan([b]).length, 2);
});

test('unrelated or stale DOM cannot extend the current conversation', () => {
    const { scan, state } = fixture([message('a')]);
    state.claudeCatalogContext = 'claude:B';
    state.claudeCatalogMessages = [message('a'), message('stale')];
    assert.deepEqual(scan([message('other'), message('new')]).map(m => m.text), ['a']);
});

test('branch replacement discards local tail from the previous branch', () => {
    const { scan, state } = fixture([message('a'), message('b')]);
    scan([message('b'), message('c')]);
    state.claudeRemoteMessages = [message('a'), message('edited')];
    assert.deepEqual(scan([]).map(m => m.text), ['a', 'edited']);
});

test('unique no-ID boundary permits append but repeated text does not', () => {
    const { scan } = fixture([message('a', 'first'), message('b', 'last')]);
    assert.equal(scan([message('', 'last'), message('', 'new')]).length, 3);
    const repeated = fixture([message('a', 'same'), message('b', 'same')]);
    assert.equal(repeated.scan([message('', 'same'), message('', 'new')]).length, 2);
});

test('conflicting known IDs never bind an anchor solely by text', () => {
    const { scan } = fixture([message('a', 'same')]);
    const unrelated = { ...message('b', 'same'), anchor: { isConnected: true } };
    const result = scan([unrelated]);
    assert.equal(result.length, 1);
    assert.equal(result[0].anchor, null);
    assert.deepEqual(Array.from(result[0].identityKeys), ['message:a']);
});

test('short and long remote catalogs preserve order on append', () => {
    for (const count of [3, 122]) {
        const remote = Array.from({ length: count }, (_, i) => message(String(i)));
        const { scan } = fixture(remote);
        const result = scan([...remote.slice(-2), message('new')]);
        assert.deepEqual(result.map(m => m.text), [...remote.map(m => m.text), 'new']);
        assert.equal(result[count].remoteIndex, count);
    }
});
