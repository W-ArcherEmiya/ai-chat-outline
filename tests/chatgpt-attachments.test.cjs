const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'ai-chat-outline.js'), 'utf8').replace(/\r\n/g, '\n');
const context = vm.createContext({ normalizePlainText: text => String(text || '').replace(/\s+/g, ' ').trim(),
    createMessageIdentityKeys: (...ids) => [...new Set(ids.filter(Boolean).map(id => `message:${id}`))],
    getConversationPathNodes: nodes => nodes });
for (const name of ['flattenConversationPart', 'getChatGptAttachmentLabel', 'getConversationMessageText',
    'shouldUseConversationMessage', 'extractChatGptUserMessagesFromNodes', 'buildChatGptPathIndexByIdentity']) {
    const start = source.indexOf(`    function ${name}(`);
    assert.ok(start >= 0);
    vm.runInContext(source.slice(start, source.indexOf('\n    }', start) + 6), context);
}
const fileMessage = { id: 'doc', author: { role: 'user' }, content: { parts: [''] },
    metadata: { attachments: [{ id: 'file-1', name: 'report.pdf' }] } };
test('document-only history is included with filename and original message ID', () => {
    const result = context.extractChatGptUserMessagesFromNodes([{ id: 'node', message: fileMessage }]);
    assert.equal(result.length, 1);
    assert.equal(result[0].text, '文件：report.pdf');
    assert.equal(result[0].identityKey, 'message:doc');
});
test('prompt text and existing image labels remain unchanged', () => {
    assert.equal(context.getConversationMessageText({ ...fileMessage, content: { parts: ['Explain this'] } }), 'Explain this');
    assert.equal(context.getConversationMessageText({ content: { parts: [{ content_type: 'image_asset_pointer' }] } }), '[image]');
});
test('multiple documents and alternative filename fields are supported', () => {
    assert.equal(context.getConversationMessageText({ attachments: [{ filename: 'a.docx' }, { file_name: 'b.xlsx' }] }), '文件：a.docx、b.xlsx');
    assert.equal(context.getConversationMessageText({ content: { parts: [{ content_type: 'file', name: 'a.pdf' }] } }), '文件：a.pdf');
});
test('missing filename gets fallback and duplicate attachment ID is deduplicated', () => {
    assert.equal(context.getConversationMessageText({ attachments: [{ id: 'a' }] }), '文件');
    assert.equal(context.getConversationMessageText({ attachments: [{ id: 'a' }, { id: 'b' }] }), '文件 x2');
    assert.equal(context.getConversationMessageText({ ...fileMessage, attachments: fileMessage.metadata.attachments }), '文件：report.pdf');
});
test('empty and hidden messages remain excluded', () => {
    assert.equal(context.getConversationMessageText({ content: { parts: [''] } }), '');
    assert.equal(context.extractChatGptUserMessagesFromNodes([{ message: { ...fileMessage,
        metadata: { ...fileMessage.metadata, is_hidden: true } } }]).length, 0);
});
test('document entry participates in navigation path numbering', () => {
    const nodes = [{ message: fileMessage }, { message: { id: 'reply', author: { role: 'assistant' }, content: { parts: ['ok'] } } },
        { message: { id: 'next', author: { role: 'user' }, content: { parts: ['next'] } } }];
    const index = context.buildChatGptPathIndexByIdentity(nodes);
    assert.equal(index.get('message:doc'), 0);
    assert.equal(index.get('message:reply'), 0);
    assert.equal(index.get('message:next'), 1);
});
