// ==UserScript==
// @name         ai-chat-outline
// @namespace    http://tampermonkey.net/
// @version      2.8.9
// @description  Adds a sidebar table of contents to ChatGPT, Gemini and Claude.
// @author       ArcherEmiya
// @match        https://gemini.google.com/*
// @match        https://chatgpt.com/*
// @match        https://claude.ai/*
// @grant        unsafeWindow
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    function cleanUpOldVersions() {
        const ids = [
            'gemini-toc',
            'gemini-toc-v2',
            'gemini-toc-v2_1',
            'gemini-toc-v2_3',
            'gemini-toc-v2_4',
            'gemini-toc-v2_5',
            'gemini-toc-v2_6',
            'ai-toc-v2_2',
            'ai-toc-style',
            'ai-toc-style-v2_2',
            'ai-toc-style-v2_3'
        ];
        ids.forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });
        document.querySelectorAll('style[id^="gemini-toc"], style[id^="ai-toc"]').forEach((el) => el.remove());
    }

    cleanUpOldVersions();
    console.log('ai-chat-outline v2.8.9: started');

    function getPageWindow() {
        try {
            if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow;
        } catch (error) {
            // Some script managers expose unsafeWindow lazily; window remains a valid fallback.
        }
        return window;
    }

    const CONFIG = {
        displayCount: 8,
        panelWidth: 280,
        panelMargin: 8,
        bubbleSize: 48,
        autoCollapse: true,
        autoCollapseDelay: 12000
    };
    const TIMINGS = {
        scanDelay: 120,
        positionRefresh: 80,
        jumpCorrection: 140,
        manualRelease: 180,
        tocFollowPause: 900,
        tocUserScroll: 1200,
        topBoundaryStable: 2200,
        bottomBoundaryStable: 600,
        boundaryInterval: 120,
        topBoundaryMaxAttempts: 240,
        bottomBoundaryMaxAttempts: 120,
        virtualSeekInterval: 260,
        virtualSeekMaxAttempts: 120
    };
    const STATE = {
        messages: [],
        activeIndex: -1,
        manualActiveIndex: -1,
        clickLockIndex: -1,
        forcedActiveIndex: -1,
        tocUserScrollUntil: 0,
        tocSyncing: false,
        scrollSettleTimer: 0,
        jumpSyncTimer: 0,
        scrollContainer: null,
        syncFrame: 0,
        resizeBound: false,
        scanTimer: 0,
        positionTimer: 0,
        autoCollapseTimer: 0,
        cancelBoundaryNavigation: null,
        lastBoundaryDebug: null,
        panelConversationContext: '',
        positionCache: [],
        positionsDirty: true,
        chatGptCatalogMessages: [],
        chatGptCatalogContext: '',
        chatGptCatalogSource: '',
        chatGptHistoryLoad: null,
        chatGptHistoryWarmupTimer: 0,
        chatGptHistoryWarmupContext: '',
        chatGptHistoryWarmupDebug: null,
        chatGptNavigationStatus: '',
        chatGptPendingClick: null,
        chatGptConversationCache: new Map(),
        chatGptConversationRequests: new Map(),
        chatGptFetchAttemptedAt: new Map(),
        chatGptFetchAttempts: new Map(),
        chatGptRouteContext: '',
        chatGptRouteChanges: 0,
        chatGptRouteChangedAt: 0,
        chatGptRouteWatcherInstalled: false,
        chatGptPrefetchInstalled: false,
        chatGptDebugEvents: [],
        remoteMessages: [],
        remoteMessageContext: '',
        remoteMessageSource: '',
        remoteMessageIsAuthoritative: false,
        remoteFetchContext: '',
        remoteFetchInFlight: false,
        remoteFetchStatus: '',
        remoteRefreshTimer: 0,
        remoteRefreshAttempts: 0,
        remoteRefreshPendingSignature: '',
        pendingLiveMessages: 0,
        pendingLiveCatalogMessages: [],
        pendingLiveContext: '',
        pendingLiveMissingSince: 0,
        remoteResponseUrl: '',
        remoteResponseStatus: 0,
        remotePayloadShape: '',
        remotePayloadPath: '',
        chatGptPathIndexByIdentity: new Map(),
        conversationInterceptorInstalled: false,
        claudeCatalogMessages: [],
        claudeCatalogContext: '',
        claudeCatalogSource: '',
        claudeConversationCache: new Map(),
        claudeConversationRequests: new Map(),
        claudePrefetchAttemptedAt: new Map(),
        claudeRemoteMessages: [],
        claudeRemotePath: [],
        claudeRenderablePathIndexes: [],
        claudeRemoteContext: '',
        claudeRemoteSource: '',
        claudeRemoteStatus: '',
        claudeRemoteUpdatedAt: 0,
        claudeLastConversationUrl: '',
        claudeObservedUrls: [],
        claudeOrganizationCandidates: [],
        claudeOrganizationStatus: '',
        claudeOrganizationRequest: null,
        claudeHydrateUrl: '',
        claudeHydrateContext: '',
        claudeHydrateInFlight: false,
        claudeHydrateAttempts: 0,
        claudeHydrateRetryTimer: 0,
        claudeRouteContext: '',
        claudeRouteChanges: 0,
        claudeRouteChangedAt: 0,
        claudeRouteWatcherInstalled: false,
        claudePrefetchInstalled: false,
        claudeDebugEvents: [],
        claudeResourceObserver: null,
        claudeConversationInterceptorInstalled: false,
        claudeDirectDomMessages: 0,
        claudeDocumentUserMessages: 0,
        claudeDirectDomSamples: [],
        claudeDirectScrollContainer: '',
        claudeDirectScrollStats: null,
        claudeVirtualRows: [],
        claudeVirtualTotalRows: 0,
        claudeJumpToken: 0,
        lastTocSource: '',
        messageListContext: '',
        lastTocClick: null,
        lastNavigationDebug: null,
        lastActiveDebug: null,
        virtualSeekTimer: 0,
        observer: null,
        globalEventsBound: false
    };

    const STORAGE_KEYS = {
        panelPosition: 'ai-toc-v2_5-panel-position',
        expandedPosition: 'ai-toc-v2_5-expanded-position',
        bubblePosition: 'ai-toc-v2_5-bubble-position',
        collapsed: 'ai-toc-v2_5-collapsed'
    };

    const PATHS = {
        search: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
        top: 'M7 4h10v2H7V4zm5 3l-5 5h3v8h4v-8h3l-5-5z',
        bottom: 'M10 4h4v8h3l-5 5-5-5h3V4zM7 18h10v2H7v-2z',
        spin: 'M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z',
        bullet: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
        collapse: 'M19 13H5v-2h14v2z',
        expand: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
        clear: 'M18.3 5.71 16.89 4.3 12 9.17 7.11 4.3 5.7 5.71 10.59 10.6 5.7 15.49 7.11 16.9 12 12.01 16.89 16.9 18.3 15.49 13.41 10.6z'
    };

    // Site adapters and message collection
    function resolveGroupedMessageContainer(line, selector) {
        if (!line) return null;

        let current = line.parentElement || line;
        let candidate = current;

        while (current && current.parentElement && current.parentElement !== document.body) {
            const parent = current.parentElement;
            const matchedChildren = Array.from(parent.children).filter((child) => {
                return child.matches(selector) || !!child.querySelector(selector);
            });

            if (matchedChildren.length > 1) {
                return current;
            }

            candidate = current;
            current = parent;
        }

        return candidate;
    }

    function extractImageLabel(container) {
        if (!container) return '';

        const images = Array.from(container.querySelectorAll('img'));
        if (!images.length) return '';

        const labels = [];
        images.forEach((img) => {
            const raw = (img.getAttribute('alt') || img.getAttribute('aria-label') || img.title || '').trim();
            if (!raw) return;
            if (raw.length <= 2) return;
            if (/^(image|photo|picture)$/i.test(raw)) return;
            labels.push(raw);
        });

        if (labels.length) {
            return `图片：${labels[0]}`;
        }

        return images.length > 1 ? `图片 x${images.length}` : '图片';
    }

    function normalizeMessageText(node) {
        return (node && node.textContent ? node.textContent : '').replace(/\s+/g, ' ').trim();
    }

    function extractChatGptUserQueryText(element) {
        if (!element || !element.querySelector) return normalizeMessageText(element);
        const content = element.matches && element.matches('.whitespace-pre-wrap')
            ? element
            : element.querySelector('.whitespace-pre-wrap');
        return normalizeMessageText(content || element);
    }

    const CHATGPT_LEGACY_USER_SELECTOR = '[data-message-author-role="user"]';
    const CHATGPT_FALLBACK_USER_SELECTOR = 'div.self-end.bg-token-bg-tertiary';
    const CHATGPT_MODERN_USER_SELECTOR = '[data-chatgpt-search-message-ids]';
    const CHATGPT_MODERN_USER_BUBBLE_SELECTOR = '.bg-user-message.text-user-message';
    const CHATGPT_USER_SELECTOR = [
        CHATGPT_LEGACY_USER_SELECTOR,
        CHATGPT_MODERN_USER_BUBBLE_SELECTOR,
        CHATGPT_FALLBACK_USER_SELECTOR
    ].join(', ');

    function resolveChatGptModernUserAnchor(element) {
        if (!element || !element.querySelector) return element;
        const container = element.matches && element.matches(CHATGPT_MODERN_USER_SELECTOR)
            ? element
            : element.closest && element.closest(CHATGPT_MODERN_USER_SELECTOR);
        if (!container) return element;
        if (container.matches(CHATGPT_MODERN_USER_BUBBLE_SELECTOR)) return container;
        return container.querySelector(CHATGPT_MODERN_USER_BUBBLE_SELECTOR);
    }

    function getChatGptLiveUserElements() {
        const legacy = Array.from(document.querySelectorAll(CHATGPT_LEGACY_USER_SELECTOR));
        if (legacy.length) return legacy;
        const modern = Array.from(document.querySelectorAll(CHATGPT_MODERN_USER_SELECTOR))
            .filter((element) => !element.closest('#ai-toc-v2_2, form, [contenteditable="true"]'))
            .map(resolveChatGptModernUserAnchor)
            .filter((element, index, all) => element && all.indexOf(element) === index);
        if (modern.length) return modern;
        const modernBubbles = Array.from(document.querySelectorAll(CHATGPT_MODERN_USER_BUBBLE_SELECTOR))
            .filter((element) => !element.closest('#ai-toc-v2_2, form, [contenteditable="true"]'));
        if (modernBubbles.length) return modernBubbles;
        return Array.from(document.querySelectorAll(CHATGPT_FALLBACK_USER_SELECTOR))
            .filter((element) => !element.closest('#ai-toc-v2_2, form, [contenteditable="true"]'));
    }

    function getChatGptLiveMessageElements() {
        const legacy = Array.from(document.querySelectorAll('[data-message-author-role]'));
        if (legacy.length) return legacy;
        const modernTurns = Array.from(document.querySelectorAll('[data-turn-key]'));
        if (modernTurns.length) return modernTurns;
        const users = getChatGptLiveUserElements();
        const assistants = Array.from(document.querySelectorAll('.markdown.prose'))
            .filter((element) => !element.closest('.bg-token-bg-tertiary, #ai-toc-v2_2'));
        return Array.from(new Set(users.concat(assistants)));
    }

    function normalizePlainText(text) {
        return (text || '').replace(/\s+/g, ' ').trim();
    }

    function getComparableMessageText(text) {
        return normalizePlainText(text)
            .replace(/[\u200b-\u200f\ufeff]/g, '')
            .replace(/^\[(image|photo|picture|file|attachment|图片|图像|文件|附件)\]\s*/i, '')
            .replace(/\[(image|photo|picture|file|attachment|图片|图像|文件|附件)\]\s*/gi, '')
            .replace(/^(you said|user said|您说|你说|我说)[:：]\s*/i, '')
            .replace(/\s*(copy|copied|edit|复制|已复制|编辑)$/i, '')
            .toLowerCase()
            .replace(/\s+/g, '');
    }

    function getChatGptRenderedComparableText(text) {
        const renderedText = String(text || '')
            .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
            .replace(/(^|\s)#{1,6}\s+/g, '$1')
            .replace(/(^|\s)>\s?/g, '$1')
            .replace(/```[^\s]*\s?/g, '')
            .replace(/[*_~`]/g, '');
        return getComparableMessageText(renderedText);
    }

    function getChatGptGenericSearchRoot() {
        return document.body;
    }

    function isChatGptGenericTextCandidate(element, root) {
        if (!(element instanceof HTMLElement) || !element.isConnected) return false;
        if (element === root || element.childElementCount > 80) return false;
        if (element.matches('script, style, svg, button, input, textarea, select, option')) return false;
        if (element.closest('#ai-toc-v2_2, form, nav, aside, header, [contenteditable="true"], [aria-hidden="true"]')) {
            return false;
        }
        return isVisibleElement(element);
    }

    function getChatGptGenericTextAlignmentMatches() {
        if (!STATE.remoteMessages.length) return [];

        const root = getChatGptGenericSearchRoot();
        if (!root) return [];

        const remoteTexts = STATE.remoteMessages.map((message) => getChatGptRenderedComparableText(message.text));
        const exactRemoteIndexes = new Map();
        let longestRemoteText = 0;
        remoteTexts.forEach((text, remoteIndex) => {
            if (!text) return;
            const indexes = exactRemoteIndexes.get(text) || [];
            indexes.push(remoteIndex);
            exactRemoteIndexes.set(text, indexes);
            longestRemoteText = Math.max(longestRemoteText, text.length);
        });
        if (!exactRemoteIndexes.size) return [];

        const rawCandidates = [];
        const selector = 'article, section, div, p, pre, blockquote, h1, h2, h3, h4, h5, h6, li, span';
        Array.from(root.querySelectorAll(selector)).forEach((element) => {
            if (!isChatGptGenericTextCandidate(element, root)) return;

            const liveText = normalizeMessageText(element);
            if (!liveText || liveText.length > Math.max(24000, longestRemoteText * 2)) return;
            const comparable = getChatGptRenderedComparableText(liveText);
            if (!comparable) return;

            let remoteIndexes = exactRemoteIndexes.get(comparable) || [];
            let source = 'generic-exact-text';
            if (!remoteIndexes.length && comparable.length >= 12) {
                const compatible = [];
                remoteTexts.forEach((remoteText, remoteIndex) => {
                    if (!remoteText) return;
                    const difference = Math.abs(remoteText.length - comparable.length);
                    const allowedDifference = Math.max(24, Math.round(remoteText.length * 0.08));
                    if (difference <= allowedDifference && isComparableTextMatch(remoteText, comparable)) {
                        compatible.push(remoteIndex);
                    }
                });
                if (compatible.length === 1) {
                    remoteIndexes = compatible;
                    source = 'generic-compatible-text';
                }
            }
            if (!remoteIndexes.length) return;

            rawCandidates.push({
                element,
                liveText,
                comparable,
                remoteIndexes,
                source
            });
        });

        const innermostCandidates = rawCandidates.filter((candidate) => !rawCandidates.some((other) => (
            other !== candidate &&
            candidate.element.contains(other.element) &&
            other.comparable === candidate.comparable
        )));
        innermostCandidates.sort((left, right) => {
            if (left.element === right.element) return 0;
            const position = left.element.compareDocumentPosition(right.element);
            return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
        });

        const matches = [];
        const seenElements = new Set();
        const seenRemoteIndexes = new Set();
        innermostCandidates.forEach((candidate) => {
            if (seenElements.has(candidate.element)) return;
            const availableIndexes = candidate.remoteIndexes.filter((remoteIndex) => !seenRemoteIndexes.has(remoteIndex));
            if (availableIndexes.length !== 1) return;
            const remoteIndex = availableIndexes[0];
            seenElements.add(candidate.element);
            seenRemoteIndexes.add(remoteIndex);
            matches.push({
                element: candidate.element,
                liveIndex: matches.length,
                remoteIndex,
                source: candidate.source,
                liveText: candidate.liveText
            });
        });
        return matches;
    }

    function isComparableTextMatch(remoteText, liveText) {
        if (!remoteText || !liveText) return false;
        if (remoteText === liveText) return true;

        const minLength = Math.min(remoteText.length, liveText.length);
        if (minLength < 4) return false;

        return liveText.includes(remoteText) || remoteText.includes(liveText);
    }

    function findOrderedComparableTextIndex(texts, comparable, startIndex, usedIndexes) {
        if (!comparable) return -1;
        const start = typeof startIndex === 'number' ? startIndex : 0;

        for (let i = start; i < texts.length; i++) {
            if (usedIndexes && usedIndexes.has(i)) continue;
            if (texts[i] === comparable) return i;
        }

        const compatibleIndexes = [];
        for (let i = start; i < texts.length; i++) {
            if (usedIndexes && usedIndexes.has(i)) continue;
            if (isComparableTextMatch(texts[i], comparable)) compatibleIndexes.push(i);
        }
        return compatibleIndexes.length === 1 ? compatibleIndexes[0] : -1;
    }

    function normalizeNativeTocText(text) {
        return normalizePlainText(text);
    }

    function isCompatibleNativeTocText(liveText, tocText) {
        const live = normalizeNativeTocText(liveText);
        const toc = normalizeNativeTocText(tocText);
        if (!live || !toc) return false;
        if (live === toc) return true;
        return Math.min(live.length, toc.length) >= 200 && (live.startsWith(toc) || toc.startsWith(live));
    }

    function getChatGptNativeTocButtonIndex(button, fallbackIndex) {
        const label = (button.getAttribute('aria-label') || '').trim();
        const match = /^Prompt\s+(\d+)$/i.exec(label);
        if (!match || !match[1]) return fallbackIndex;

        const parsed = Number.parseInt(match[1], 10);
        return Number.isNaN(parsed) ? fallbackIndex : Math.max(0, parsed - 1);
    }

    function getChatGptNativeTocButtons() {
        if (!window.location.hostname.includes('chatgpt.com')) return [];

        return Array.from(document.querySelectorAll('button[aria-label^="Prompt "]'))
            .filter((button) => {
                if (!(button instanceof HTMLElement)) return false;
                const label = (button.getAttribute('aria-label') || '').trim();
                if (!/^Prompt\s+\d+$/i.test(label)) return false;

                const nativeTocContainer = button.closest('.no-scrollbar');
                return !!(nativeTocContainer && nativeTocContainer.querySelectorAll('button[aria-label^="Prompt "]').length);
            })
            .sort((a, b) => getChatGptNativeTocButtonIndex(a, 0) - getChatGptNativeTocButtonIndex(b, 0));
    }

    function getChatGptNativeTocTexts(buttons) {
        const firstButton = buttons[0];
        const container = firstButton
            ? firstButton.closest('.no-scrollbar')?.parentElement ||
                firstButton.closest('.relative.flex.items-start') ||
                firstButton.closest('.fixed')
            : null;
        if (!container) return [];

        const titleElements = Array.from(container.querySelectorAll([
            'button[data-fill] [title]',
            'button[class*="__menu-item"] [title]',
            'ul button [title]',
            '[role="menu"] [title]',
            '.absolute [title]'
        ].join(', ')));
        const seen = new Set();

        return titleElements
            .filter((element) => {
                if (!(element instanceof HTMLElement)) return false;
                if (seen.has(element)) return false;
                seen.add(element);
                return true;
            })
            .map((element) => normalizeNativeTocText(element.getAttribute('title') || element.textContent || ''))
            .filter(Boolean);
    }

    function getChatGptNativeTocEntries() {
        const buttons = getChatGptNativeTocButtons();
        if (!buttons.length) return [];

        const texts = getChatGptNativeTocTexts(buttons);
        if (texts.length !== buttons.length) return [];

        const textCounts = new Map();
        texts.forEach((text) => {
            const normalized = normalizeNativeTocText(text);
            textCounts.set(normalized, (textCounts.get(normalized) || 0) + 1);
        });
        const hasPrefixAmbiguity = (text) => {
            const normalized = normalizeNativeTocText(text);
            if (!normalized) return true;
            return texts.some((candidate) => {
                const comparable = normalizeNativeTocText(candidate);
                return comparable && comparable !== normalized &&
                    (normalized.startsWith(comparable) || comparable.startsWith(normalized));
            });
        };

        const liveByText = new Map();
        getChatGptLiveUserElements().forEach((element) => {
            const text = normalizeNativeTocText(extractChatGptUserQueryText(element));
            if (!text) return;
            const group = liveByText.get(text) || [];
            group.push(element);
            liveByText.set(text, group);
        });

        return buttons.map((button, index) => {
            const text = texts[index] || '';
            const normalizedText = normalizeNativeTocText(text);
            const liveMatches = liveByText.get(normalizedText) || [];
            const uniqueLiveElement = textCounts.get(normalizedText) === 1 &&
                !hasPrefixAmbiguity(text) &&
                liveMatches.length === 1
                ? liveMatches[0]
                : null;
            return {
                index: getChatGptNativeTocButtonIndex(button, index),
                text,
                button,
                element: uniqueLiveElement,
                isActive: button.hasAttribute('data-toc-active')
            };
        });
    }

    function getChatGptNativeTocEntryForIndex(index) {
        return getChatGptNativeTocEntries().find((entry) => entry.index === index) || null;
    }

    function getChatGptActiveNativeTocIndex() {
        const buttons = getChatGptNativeTocButtons();
        const activeButton = buttons.find((button) => button.hasAttribute('data-toc-active'));
        if (!activeButton) return null;

        const buttonIndex = buttons.indexOf(activeButton);
        return getChatGptNativeTocButtonIndex(activeButton, buttonIndex);
    }

    function annotateMessagesWithNativeToc(messages) {
        if (!window.location.hostname.includes('chatgpt.com') || !messages.length) return messages;

        const entries = getChatGptNativeTocEntries();
        if (!entries.length) return messages;

        const used = new Set();
        const canUseListPosition = messages.length === entries.length;
        messages.forEach((message, messageIndex) => {
            const remoteIndex = getMessageRemoteIndex(message, messageIndex);
            const hasAuthoritativeIndex = typeof message.remoteIndex === 'number' ||
                typeof message.nativeTocIndex === 'number';
            let entry = null;
            if (hasAuthoritativeIndex || canUseListPosition) {
                entry = entries.find((candidate) => (
                    candidate.index === remoteIndex &&
                    !used.has(candidate.index) &&
                    isCompatibleNativeTocText(message.text, candidate.text)
                ));
            }
            if (!entry) {
                const compatibleEntries = entries.filter((candidate) => {
                    if (used.has(candidate.index)) return false;
                    return isCompatibleNativeTocText(message.text, candidate.text);
                });
                entry = compatibleEntries.length === 1 ? compatibleEntries[0] : null;
            }
            if (!entry) return;

            used.add(entry.index);
            message.nativeTocIndex = entry.index;
            message.nativeTocText = entry.text;
            message.navigationId = `chatgpt-native-user-query::${entry.index}`;
            if (entry.element) {
                const domIdentityKey = getMessageIdentityKeyFromElement(entry.element);
                if (domIdentityKey) {
                    message.identityKeys = createMessageIdentityKeys.apply(
                        null,
                        getMessageIdentityKeys(message).concat([domIdentityKey])
                    );
                    message.identityKey = message.identityKeys[0] || message.identityKey;
                    message.anchor = entry.element;
                    message.container = ADAPTER ? ADAPTER.resolveMessageContainer(entry.element) : entry.element;
                    message.anchorSource = 'native-toc';
                }
            }
        });

        return messages;
    }

    function collectChatGptNativeTocMessages() {
        const entries = getChatGptNativeTocEntries();
        return entries
            .filter((entry) => entry.text && entry.text.trim())
            .map((entry) => {
                const identityKey = entry.element ? getMessageIdentityKeyFromElement(entry.element) : '';
                const message = {
                    container: entry.element || null,
                    anchor: entry.element || null,
                    text: entry.text,
                    identityKey,
                    identityKeys: createMessageIdentityKeys(identityKey),
                    nativeTocIndex: entry.index,
                    nativeTocText: entry.text,
                    navigationId: `chatgpt-native-user-query::${entry.index}`,
                    source: 'chatgpt-native-toc',
                    anchorSource: entry.element ? 'native-toc' : 'native-toc-button'
                };
                return message;
            });
    }

    function getChatGptConversationIdFromText(text) {
        if (!text) return '';

        const patterns = [
            /\/c\/([0-9a-f-]{20,})/i,
            /\/backend-api\/(?:f\/)?conversations?\/([0-9a-f-]{20,})/i,
            /[?&]conversation_id=([0-9a-f-]{20,})/i
        ];

        for (let i = 0; i < patterns.length; i++) {
            const match = text.match(patterns[i]);
            if (match && match[1]) return match[1];
        }

        return '';
    }

    function getChatGptConversationId() {
        if (!window.location.hostname.includes('chatgpt.com')) return '';

        try {
            const params = new URLSearchParams(window.location.search);
            const queryId = params.get('conversation_id');
            if (queryId) return queryId;
        } catch (error) {
            // URLSearchParams can fail on malformed extension URLs; path parsing still covers normal pages.
        }

        return getChatGptConversationIdFromText(window.location.href);
    }

    function getMessageIdentityKeyFromElement(element) {
        if (!element || !element.getAttribute) return '';

        const getModernId = (candidate) => {
            if (!candidate || !candidate.getAttribute) return '';
            const raw = candidate.getAttribute('data-chatgpt-search-message-ids') ||
                candidate.getAttribute('data-turn-key') || '';
            if (!raw) return '';
            const uuidMatch = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
            return uuidMatch ? uuidMatch[0] : raw.trim().split(/[\s,]+/)[0];
        };
        const directId = element.getAttribute('data-message-id') ||
            element.getAttribute('data-message-uuid') ||
            getModernId(element);
        if (directId) return `message:${directId}`;

        const closest = element.closest
            ? element.closest('[data-message-id], [data-message-uuid], [data-chatgpt-search-message-ids], [data-turn-key]')
            : null;
        const closestId = closest
            ? closest.getAttribute('data-message-id') ||
                closest.getAttribute('data-message-uuid') ||
                getModernId(closest)
            : '';
        return closestId ? `message:${closestId}` : '';
    }

    function createMessageIdentityKeys() {
        const seen = new Set();
        const keys = [];

        for (let i = 0; i < arguments.length; i++) {
            const id = arguments[i];
            if (!id) continue;

            const key = String(id).startsWith('message:') ? String(id) : `message:${id}`;
            if (seen.has(key)) continue;

            seen.add(key);
            keys.push(key);
        }

        return keys;
    }

    function getMessageIdentityKeys(message) {
        if (!message) return [];

        const keys = [];
        if (Array.isArray(message.identityKeys)) keys.push(...message.identityKeys);
        if (message.identityKey) keys.push(message.identityKey);

        const elementKey = getMessageIdentityKeyFromElement(getMessageTarget(message));
        if (elementKey) keys.push(elementKey);

        return createMessageIdentityKeys.apply(null, keys);
    }

    function getMessageIdentityKey(message) {
        const keys = getMessageIdentityKeys(message);
        return keys[0] || '';
    }

    function getMessageIdFromIdentityKey(identityKey) {
        return identityKey && identityKey.indexOf('message:') === 0 ? identityKey.slice(8) : '';
    }

    function escapeCssValue(value) {
        if (window.CSS && typeof window.CSS.escape === 'function') {
            return window.CSS.escape(value);
        }
        return String(value).replace(/["\\]/g, '\\$&');
    }

    function getChatGptMessageCacheContext() {
        const conversationId = getChatGptConversationId();
        if (conversationId) return `chatgpt:${conversationId}`;
        return `${window.location.hostname}${window.location.pathname}${window.location.search}`;
    }

    function recordChatGptDebugEvent(type, details) {
        STATE.chatGptDebugEvents.push({
            time: new Date().toISOString(),
            type,
            context: getChatGptMessageCacheContext(),
            details: details || null
        });
        if (STATE.chatGptDebugEvents.length > 30) {
            STATE.chatGptDebugEvents.splice(0, STATE.chatGptDebugEvents.length - 30);
        }
    }

    function storeChatGptConversationCache(context, messages, pathIndexByIdentity, source) {
        if (!context || !/^chatgpt:/.test(context) || !messages || !messages.length) return false;
        const cache = STATE.chatGptConversationCache;
        cache.delete(context);
        cache.set(context, {
            messages: snapshotChatGptCatalogMessages(messages),
            pathIndexByIdentity: new Map(pathIndexByIdentity || []),
            source: source || 'direct',
            updatedAt: Date.now()
        });
        while (cache.size > 12) cache.delete(cache.keys().next().value);
        return true;
    }

    function restoreChatGptConversationCache(context) {
        const cached = STATE.chatGptConversationCache.get(context);
        if (!cached || !cached.messages.length) return false;

        STATE.chatGptConversationCache.delete(context);
        STATE.chatGptConversationCache.set(context, cached);
        STATE.remoteMessages = snapshotChatGptCatalogMessages(cached.messages);
        STATE.remoteMessageContext = context;
        STATE.remoteMessageSource = `memory-cache:${cached.source}`;
        STATE.remoteMessageIsAuthoritative = true;
        STATE.remoteFetchStatus = `memory-cache:current-path:ok:${cached.messages.length}`;
        STATE.chatGptPathIndexByIdentity = new Map(cached.pathIndexByIdentity || []);
        replaceChatGptCatalog(STATE.remoteMessages, context, 'memory-cache-current-branch');
        STATE.messages = snapshotChatGptCatalogMessages(STATE.chatGptCatalogMessages);
        STATE.messageListContext = context;
        STATE.lastTocSource = STATE.chatGptCatalogSource;
        STATE.positionCache = [];
        STATE.positionsDirty = true;
        return true;
    }

    function resetChatGptConversationState(nextContext, source) {
        const previousContext = STATE.chatGptRouteContext || STATE.chatGptCatalogContext || STATE.remoteMessageContext || '';
        if (previousContext === nextContext && STATE.chatGptRouteContext === nextContext) return false;

        STATE.chatGptRouteContext = nextContext;
        clearChatGptHistoryWarmup();
        STATE.chatGptRouteChanges += 1;
        STATE.chatGptRouteChangedAt = Date.now();
        STATE.chatGptCatalogMessages = [];
        STATE.chatGptCatalogContext = '';
        STATE.chatGptCatalogSource = '';
        STATE.remoteMessages = [];
        STATE.remoteMessageContext = '';
        STATE.remoteMessageSource = '';
        STATE.remoteMessageIsAuthoritative = false;
        STATE.remoteFetchContext = nextContext;
        STATE.remoteFetchInFlight = false;
        STATE.remoteFetchStatus = 'route-change:waiting';
        STATE.chatGptPathIndexByIdentity = new Map();
        clearChatGptPendingRefresh();
        STATE.messages = [];
        STATE.positionCache = [];
        STATE.positionsDirty = true;
        STATE.messageListContext = nextContext;
        const restoredFromCache = restoreChatGptConversationCache(nextContext);
        STATE.lastTocSource = restoredFromCache
            ? STATE.chatGptCatalogSource
            : 'chatgpt-awaiting-current-conversation';
        const list = getTocList();
        if (list) {
            if (restoredFromCache) renderScanResult(list, STATE.messages, -1);
            else renderEmptyTocState(list);
        }
        recordChatGptDebugEvent('route-change', {
            source: source || 'unknown',
            previousContext,
            nextContext,
            restoredFromCache
        });
        return true;
    }

    function checkChatGptRouteContext(source) {
        if (!window.location.hostname.includes('chatgpt.com')) return;
        syncPanelForConversation();
        const context = getChatGptMessageCacheContext();
        if (!STATE.chatGptRouteContext) {
            STATE.chatGptRouteContext = context;
            recordChatGptDebugEvent('route-initialized', { source: source || 'unknown', context });
            return;
        }
        if (STATE.chatGptRouteContext === context) return;
        resetChatGptConversationState(context, source);
        scheduleScan(0);
    }

    function installChatGptRouteWatcher() {
        if (!window.location.hostname.includes('chatgpt.com') || STATE.chatGptRouteWatcherInstalled) return;
        STATE.chatGptRouteWatcherInstalled = true;
        checkChatGptRouteContext('bootstrap');
        const pageWindow = getPageWindow();
        ['pushState', 'replaceState'].forEach((methodName) => {
            try {
                const historyObject = pageWindow && pageWindow.history;
                const original = historyObject && historyObject[methodName];
                if (typeof original !== 'function' || original.__aiTocChatGptRoutePatched) return;
                const wrapped = function wrappedChatGptHistory() {
                    const result = original.apply(this, arguments);
                    window.setTimeout(() => checkChatGptRouteContext(`history.${methodName}`), 0);
                    return result;
                };
                wrapped.__aiTocChatGptRoutePatched = true;
                historyObject[methodName] = wrapped;
            } catch (error) {
                recordChatGptDebugEvent('route-hook-error', {
                    methodName,
                    error: error && error.message ? error.message : 'unknown'
                });
            }
        });
        pageWindow.addEventListener('popstate', () => checkChatGptRouteContext('popstate'));
        window.setInterval(() => checkChatGptRouteContext('poll'), 400);
    }

    function flattenConversationPart(part) {
        if (typeof part === 'string') return part;
        if (!part) return '';

        if (Array.isArray(part)) {
            return part.map(flattenConversationPart).filter(Boolean).join(' ');
        }

        if (typeof part !== 'object') return '';
        if (typeof part.text === 'string') return part.text;
        if (typeof part.content === 'string') return part.content;
        if (Array.isArray(part.parts)) return flattenConversationPart(part.parts);
        if (Array.isArray(part.content)) return flattenConversationPart(part.content);
        if (part.content_type && /image/i.test(String(part.content_type))) return '[image]';
        return '';
    }

    function getConversationMessageText(message) {
        if (!message || !message.content) return '';

        const content = message.content;
        if (Array.isArray(content.parts)) {
            return normalizePlainText(content.parts.map(flattenConversationPart).filter(Boolean).join(' '));
        }

        return normalizePlainText(flattenConversationPart(content));
    }

    function getChatGptConversationCandidate(data) {
        const queue = [{ value: data, path: '$', depth: 0 }];
        const visited = new WeakSet();
        let best = null;
        let inspected = 0;

        while (queue.length && inspected < 4000) {
            const current = queue.shift();
            let value = current.value;
            if (typeof value === 'string' && /^[\s]*[{[]/.test(value)) {
                try {
                    value = JSON.parse(value);
                } catch (error) {
                    continue;
                }
            }
            if (!value || typeof value !== 'object') continue;
            if (visited.has(value)) continue;
            visited.add(value);
            inspected += 1;

            const mapping = value.mapping || value.message_mapping || value.messageMapping;
            const rawCurrentNode = value.current_node || value.currentNode || value.current_node_id || value.currentNodeId;
            const currentNode = rawCurrentNode && typeof rawCurrentNode === 'object'
                ? rawCurrentNode.id || rawCurrentNode.node_id || rawCurrentNode.nodeId || ''
                : rawCurrentNode;
            if (mapping && (Array.isArray(mapping) || typeof mapping === 'object')) {
                const mappingCount = Array.isArray(mapping) ? mapping.length : Object.keys(mapping).length;
                const score = 1000 + mappingCount + (currentNode ? 10000 : 0);
                if (!best || score > best.score) {
                    best = {
                        value,
                        mapping,
                        currentNode: currentNode || '',
                        mappingCount,
                        path: current.path,
                        score
                    };
                }
            }

            if (current.depth >= 7) continue;
            const priorityKeys = ['conversation', 'data', 'result', 'payload', 'body', 'value', 'response'];
            const keys = Object.keys(value);
            priorityKeys.concat(keys.filter((key) => !priorityKeys.includes(key))).forEach((key) => {
                const child = value[key];
                if (!child || (typeof child !== 'object' && typeof child !== 'string')) return;
                queue.push({ value: child, path: `${current.path}.${key}`, depth: current.depth + 1 });
            });
        }

        if (!best) return null;
        const mappingEntries = Array.isArray(best.mapping)
            ? best.mapping.map((node, index) => [
                node && (node.id || (node.message && node.message.id)) || String(index),
                node
            ])
            : Object.entries(best.mapping);
        const normalizedMapping = mappingEntries.reduce((result, entry) => {
            const id = entry[0];
            const node = entry[1];
            if (!node || typeof node !== 'object') return result;
            result[id] = node.id ? node : Object.assign({ id }, node);
            return result;
        }, {});

        return {
            data: Object.assign({}, best.value, {
                mapping: normalizedMapping,
                current_node: best.currentNode
            }),
            path: best.path,
            mappingCount: best.mappingCount
        };
    }

    function describeChatGptPayload(data) {
        if (Array.isArray(data)) return `array:${data.length}`;
        if (!data || typeof data !== 'object') return typeof data;
        return `object:${Object.keys(data).slice(0, 16).join(',')}`;
    }

    function getConversationPathNodes(data) {
        const mapping = data && data.mapping ? data.mapping : null;
        if (!mapping) return [];

        if (data.current_node && mapping[data.current_node]) {
            const path = [];
            const seen = new Set();
            let node = mapping[data.current_node];

            while (node && !seen.has(node.id)) {
                seen.add(node.id);
                path.push(node);
                node = node.parent ? mapping[node.parent] : null;
            }

            return path.reverse();
        }

        return Object.keys(mapping)
            .map((key) => mapping[key])
            .sort((a, b) => {
                const aTime = a && a.message && typeof a.message.create_time === 'number' ? a.message.create_time : 0;
                const bTime = b && b.message && typeof b.message.create_time === 'number' ? b.message.create_time : 0;
                return aTime - bTime;
            });
    }

    function shouldUseConversationMessage(message) {
        if (!message) return false;
        const metadata = message.metadata || {};
        return !metadata.is_visually_hidden_from_conversation && !metadata.is_hidden;
    }

    function extractChatGptUserMessagesFromNodes(nodes) {
        const seen = new Set();
        return nodes.reduce((messages, node) => {
            const message = node && node.message;
            const role = message && message.author ? message.author.role : '';
            if (role !== 'user') return messages;
            if (!shouldUseConversationMessage(message)) return messages;

            const text = getConversationMessageText(message);
            if (!text) return messages;

            const identityKeys = createMessageIdentityKeys(message.id, node.id);
            const seenKey = identityKeys[0] || '';
            if (seenKey && seen.has(seenKey)) return messages;
            if (seenKey) seen.add(seenKey);

            messages.push({
                container: null,
                anchor: null,
                text,
                identityKey: seenKey,
                identityKeys,
                source: 'conversation'
            });
            return messages;
        }, []);
    }

    function extractChatGptUserMessages(data) {
        return extractChatGptUserMessagesFromNodes(getConversationPathNodes(data));
    }

    function buildChatGptPathIndexByIdentity(data) {
        const indexByIdentity = new Map();
        let userIndex = -1;

        getConversationPathNodes(data).forEach((node) => {
            const message = node && node.message;
            const role = message && message.author ? message.author.role : '';
            if (role === 'user' && shouldUseConversationMessage(message) && getConversationMessageText(message)) {
                userIndex += 1;
            }
            if (userIndex < 0 || !shouldUseConversationMessage(message)) return;

            createMessageIdentityKeys(message && message.id, node && node.id).forEach((key) => {
                if (key && !indexByIdentity.has(key)) indexByIdentity.set(key, userIndex);
            });
        });

        return indexByIdentity;
    }

    function applyChatGptConversationData(data, source, contextOverride) {
        const candidate = getChatGptConversationCandidate(data);
        const conversationData = candidate ? candidate.data : null;
        const messages = conversationData ? extractChatGptUserMessages(conversationData) : [];
        const context = contextOverride || getChatGptMessageCacheContext();
        const currentContext = getChatGptMessageCacheContext();
        if (!messages.length) {
            if (context === currentContext && !STATE.remoteMessages.length) {
                STATE.remoteFetchStatus = `${source}:${candidate ? 'no-user-messages' : 'unsupported-payload'}`;
            }
            return false;
        }

        const mapping = conversationData.mapping;
        const hasCurrentPath = !!(mapping && conversationData.current_node && mapping[conversationData.current_node]);
        const pathIndexByIdentity = hasCurrentPath
            ? buildChatGptPathIndexByIdentity(conversationData)
            : new Map();
        if (hasCurrentPath) {
            storeChatGptConversationCache(context, messages, pathIndexByIdentity, source);
        }
        if (context !== currentContext) {
            recordChatGptDebugEvent(hasCurrentPath ? 'response-cached' : 'response-ignored', {
                source,
                responseContext: context,
                currentContext,
                messages: messages.length,
                authoritative: hasCurrentPath
            });
            return hasCurrentPath;
        }

        STATE.remotePayloadShape = describeChatGptPayload(data);
        STATE.remotePayloadPath = candidate ? candidate.path : '';
        if (!hasCurrentPath && STATE.remoteMessageContext === context && STATE.remoteMessageIsAuthoritative) {
            STATE.remoteFetchStatus = `${source}:ignored-non-current-path`;
            return false;
        }
        if (!hasCurrentPath && STATE.remoteMessageContext === context && STATE.remoteMessages.length > messages.length) {
            STATE.remoteFetchStatus = `${source}:ignored-short:${messages.length}<${STATE.remoteMessages.length}`;
            return false;
        }

        STATE.remoteMessages = messages;
        STATE.remoteMessageContext = context;
        STATE.remoteMessageSource = source;
        STATE.remoteMessageIsAuthoritative = hasCurrentPath;
        if (hasCurrentPath) {
            STATE.chatGptPathIndexByIdentity = pathIndexByIdentity;
        }
        STATE.remoteFetchStatus = `${source}:${hasCurrentPath ? 'current-path' : 'fallback'}:ok:${messages.length}`;
        scheduleScan(0);
        return true;
    }

    function alignLiveMessagesByComparableText(remoteMessages, liveMessages) {
        const liveByRemoteIndex = new Map();
        const usedRemoteIndexes = new Set();
        const remoteByIdentity = new Map();
        remoteMessages.forEach((message, index) => {
            getMessageIdentityKeys(message).forEach((key) => remoteByIdentity.set(key, index));
        });
        let nextRemoteIndex = 0;
        const remoteTexts = remoteMessages.map((message) => getComparableMessageText(message.text));

        liveMessages.forEach((liveMessage) => {
            const liveIdentityKeys = getMessageIdentityKeys(liveMessage);
            if (liveIdentityKeys.length) {
                const key = liveIdentityKeys.find(key => remoteByIdentity.has(key));
                if (!key) return;
                const index = remoteByIdentity.get(key);
                if (usedRemoteIndexes.has(index)) return;
                usedRemoteIndexes.add(index);
                liveByRemoteIndex.set(index, liveMessage);
                liveMessage.remoteIndex = index;
                liveMessage.anchorSource = 'id';
                nextRemoteIndex = index + 1;
                return;
            }
            const liveText = getComparableMessageText(liveMessage.text);
            if (!liveText) return;
            if (remoteTexts.filter(text => text === liveText).length > 1) return;

            const matchedIndex = findOrderedComparableTextIndex(
                remoteTexts,
                liveText,
                nextRemoteIndex,
                usedRemoteIndexes
            );

            if (matchedIndex < 0) return;

            const matchType = remoteTexts[matchedIndex] === liveText
                ? 'exact-text-order'
                : 'contained-text-order';

            usedRemoteIndexes.add(matchedIndex);
            liveByRemoteIndex.set(matchedIndex, liveMessage);
            liveMessage.remoteIndex = matchedIndex;
            liveMessage.anchorSource = matchType;
            nextRemoteIndex = matchedIndex + 1;
        });

        return liveByRemoteIndex;
    }

    function getTextAlignmentPreview() {
        const remoteTexts = STATE.remoteMessages.map((message) => getChatGptRenderedComparableText(message.text));
        let nextRemoteIndex = 0;

        return getChatGptLiveUserElements().map((element, liveIndex) => {
            const liveText = extractChatGptUserQueryText(element);
            const comparable = getChatGptRenderedComparableText(liveText);
            const matchedRemoteIndex = findOrderedComparableTextIndex(remoteTexts, comparable, nextRemoteIndex);
            if (matchedRemoteIndex >= 0) nextRemoteIndex = matchedRemoteIndex + 1;

            return {
                liveIndex,
                matchedRemoteIndex,
                liveText: liveText.slice(0, 80),
                remoteText: matchedRemoteIndex >= 0 ? STATE.remoteMessages[matchedRemoteIndex].text.slice(0, 80) : ''
            };
        });
    }

    function getCurrentTextAlignmentMatches() {
        const liveElements = getChatGptLiveUserElements();
        if (!liveElements.length) return getChatGptGenericTextAlignmentMatches();

        const remoteTexts = STATE.remoteMessages.map((message) => getChatGptRenderedComparableText(message.text));
        const remoteByIdentity = new Map();
        STATE.remoteMessages.forEach((message, remoteIndex) => {
            getMessageIdentityKeys(message).forEach((key) => {
                if (key && !remoteByIdentity.has(key)) remoteByIdentity.set(key, remoteIndex);
            });
        });
        let nextRemoteIndex = 0;

        return liveElements.reduce((matches, element, liveIndex) => {
            const liveText = extractChatGptUserQueryText(element);
            const comparable = getChatGptRenderedComparableText(liveText);
            const identityKey = getMessageIdentityKeyFromElement(element);
            let matchedRemoteIndex = identityKey && remoteByIdentity.has(identityKey)
                ? remoteByIdentity.get(identityKey)
                : -1;
            let matchType = matchedRemoteIndex >= 0 ? 'message-id' : '';
            if (matchedRemoteIndex < 0) {
                matchedRemoteIndex = findOrderedComparableTextIndex(remoteTexts, comparable, nextRemoteIndex);
                matchType = matchedRemoteIndex >= 0
                    ? (remoteTexts[matchedRemoteIndex] === comparable
                        ? (identityKey ? 'exact-text-order-id-mismatch' : 'exact-text-order')
                        : (identityKey ? 'contained-text-order-id-mismatch' : 'contained-text-order'))
                    : '';
            }
            if (matchedRemoteIndex >= 0) nextRemoteIndex = matchedRemoteIndex + 1;

            if (matchedRemoteIndex >= 0) {
                matches.push({
                    element,
                    liveIndex,
                    remoteIndex: matchedRemoteIndex,
                    source: matchType,
                    liveText
                });
            }

            return matches;
        }, []);
    }

    function getCurrentChatGptTurnAlignmentMatches() {
        if (!STATE.chatGptPathIndexByIdentity.size) return [];

        return Array.from(document.querySelectorAll('[data-message-author-role], [data-turn-key]')).reduce((matches, element) => {
            const identityKey = getMessageIdentityKeyFromElement(element);
            if (!identityKey || !STATE.chatGptPathIndexByIdentity.has(identityKey)) return matches;
            matches.push({
                element,
                remoteIndex: STATE.chatGptPathIndexByIdentity.get(identityKey),
                role: element.getAttribute('data-message-author-role') ||
                    (element.hasAttribute('data-turn-key') ? 'turn' : ''),
                source: 'conversation-path-id'
            });
            return matches;
        }, []);
    }

    function mergeRemoteAndLiveMessages(remoteMessages, liveMessages) {
        if (!remoteMessages.length) return liveMessages;

        const liveByIdentity = new Map();
        const liveByRemoteIndex = alignLiveMessagesByComparableText(remoteMessages, liveMessages);
        const usedLiveMessages = new Set();

        liveMessages.forEach((message) => {
            const keys = getMessageIdentityKeys(message);
            if (!keys.length) return;

            message.identityKey = keys[0];
            message.identityKeys = keys;

            keys.forEach((key) => {
                if (!liveByIdentity.has(key)) liveByIdentity.set(key, message);
            });
        });

        const merged = remoteMessages.map((remoteMessage, remoteIndex) => {
            const keys = getMessageIdentityKeys(remoteMessage);
            const key = keys[0] || '';
            let liveMessage = null;
            let anchorSource = '';

            for (let i = 0; i < keys.length; i++) {
                liveMessage = liveByIdentity.get(keys[i]);
                if (liveMessage) {
                    anchorSource = 'id';
                    break;
                }
            }

            if (!liveMessage) {
                liveMessage = liveByRemoteIndex.get(remoteIndex) || null;
                if (liveMessage) anchorSource = liveMessage.anchorSource || 'text-order';
            }

            if (!liveMessage || usedLiveMessages.has(liveMessage)) return {
                container: null,
                anchor: null,
                text: remoteMessage.text,
                identityKey: key,
                identityKeys: keys,
                remoteIndex,
                source: remoteMessage.source
            };

            usedLiveMessages.add(liveMessage);
            return {
                container: liveMessage.container,
                anchor: liveMessage.anchor,
                text: liveMessage.text || remoteMessage.text,
                identityKey: key,
                identityKeys: keys,
                remoteIndex,
                anchorSource,
                source: 'live'
            };
        });

        liveMessages.forEach((message) => {
            if (!usedLiveMessages.has(message)) merged.push(message);
        });

        return merged;
    }

    function clearChatGptPendingRefresh() {
        if (STATE.remoteRefreshTimer) {
            window.clearTimeout(STATE.remoteRefreshTimer);
            STATE.remoteRefreshTimer = 0;
        }
        STATE.remoteRefreshAttempts = 0;
        STATE.remoteRefreshPendingSignature = '';
        STATE.pendingLiveMessages = 0;
        STATE.pendingLiveCatalogMessages = [];
        STATE.pendingLiveContext = '';
        STATE.pendingLiveMissingSince = 0;
    }

    function scheduleChatGptPendingRefresh(pendingMessages) {
        STATE.pendingLiveMessages = pendingMessages.length;
        if (!pendingMessages.length) {
            clearChatGptPendingRefresh();
            return;
        }

        const signature = pendingMessages.map((message) => (
            getMessageIdentityKey(message) || getComparableMessageText(message.text)
        )).join('|');
        if (STATE.remoteRefreshPendingSignature !== signature) {
            if (STATE.remoteRefreshTimer) window.clearTimeout(STATE.remoteRefreshTimer);
            STATE.remoteRefreshTimer = 0;
            STATE.remoteRefreshAttempts = 0;
            STATE.remoteRefreshPendingSignature = signature;
        }
        if (STATE.remoteRefreshTimer || STATE.remoteRefreshAttempts >= 6) return;

        const delay = Math.min(4000, 500 * Math.pow(2, STATE.remoteRefreshAttempts));
        const refresh = () => {
            if (STATE.remoteFetchInFlight) {
                STATE.remoteRefreshTimer = window.setTimeout(refresh, 300);
                return;
            }
            STATE.remoteRefreshTimer = 0;
            STATE.remoteRefreshAttempts += 1;
            hydrateChatGptConversationMessages(true);
        };
        STATE.remoteRefreshTimer = window.setTimeout(refresh, delay);
    }

    function mergeChatGptAuthoritativeBranchWithLiveTail(remoteMessages, liveMessages, context) {
        const reboundRemote = mergeRemoteAndLiveMessages(remoteMessages, liveMessages).slice(0, remoteMessages.length);
        if (!remoteMessages.length) {
            clearChatGptPendingRefresh();
            return reboundRemote;
        }
        if (STATE.pendingLiveContext && STATE.pendingLiveContext !== context) {
            clearChatGptPendingRefresh();
        }

        const remoteByIdentity = new Map();
        const remoteTexts = remoteMessages.map((message) => getComparableMessageText(message.text));
        remoteMessages.forEach((message, remoteIndex) => {
            getMessageIdentityKeys(message).forEach((key) => {
                if (key && !remoteByIdentity.has(key)) remoteByIdentity.set(key, remoteIndex);
            });
        });

        let nextRemoteIndex = 0;
        const liveRemoteIndexes = liveMessages.map((message) => {
            const identityKeys = getMessageIdentityKeys(message);
            let matchedIndex = -1;
            for (let i = 0; i < identityKeys.length; i++) {
                if (remoteByIdentity.has(identityKeys[i])) {
                    matchedIndex = remoteByIdentity.get(identityKeys[i]);
                    break;
                }
            }
            if (matchedIndex < 0 && !identityKeys.length) {
                matchedIndex = findOrderedComparableTextIndex(
                    remoteTexts,
                    getComparableMessageText(message.text),
                    nextRemoteIndex
                );
            }
            if (matchedIndex >= 0) nextRemoteIndex = matchedIndex + 1;
            return matchedIndex;
        });

        let remoteTailLiveIndex = -1;
        for (let i = liveRemoteIndexes.length - 1; i >= 0; i--) {
            if (liveRemoteIndexes[i] === remoteMessages.length - 1) {
                remoteTailLiveIndex = i;
                break;
            }
        }
        let detectedPendingMessages = remoteTailLiveIndex < 0
            ? []
            : liveMessages.slice(remoteTailLiveIndex + 1).filter((message, offset) => (
                liveRemoteIndexes[remoteTailLiveIndex + 1 + offset] < 0 && message.text
            ));
        if (!detectedPendingMessages.length && remoteTailLiveIndex < 0) {
            const remoteTailTurnElements = getCurrentChatGptTurnAlignmentMatches()
                .filter((match) => match.remoteIndex === remoteMessages.length - 1)
                .map((match) => match.element);
            if (remoteTailTurnElements.length) {
                detectedPendingMessages = liveMessages.filter((message, liveIndex) => {
                    if (liveRemoteIndexes[liveIndex] >= 0 || !message.text) return false;
                    const target = getMessageTarget(message);
                    if (!target || !target.isConnected) return false;
                    return remoteTailTurnElements.some((tailElement) => (
                        tailElement !== target &&
                        !!(tailElement.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING)
                    ));
                });
            }
        }
        if (detectedPendingMessages.length) {
            STATE.pendingLiveCatalogMessages = detectedPendingMessages.map(snapshotChatGptCatalogMessage);
            STATE.pendingLiveContext = context;
            STATE.pendingLiveMissingSince = 0;
        } else if (STATE.pendingLiveCatalogMessages.length && STATE.pendingLiveContext === context) {
            const remoteIdentityKeys = new Set();
            remoteMessages.forEach((message) => {
                getMessageIdentityKeys(message).forEach((key) => remoteIdentityKeys.add(key));
            });
            const unconfirmedPendingMessages = STATE.pendingLiveCatalogMessages.filter((message) => (
                !getMessageIdentityKeys(message).some((key) => remoteIdentityKeys.has(key))
            ));
            if (unconfirmedPendingMessages.length !== STATE.pendingLiveCatalogMessages.length) {
                STATE.pendingLiveCatalogMessages = unconfirmedPendingMessages;
                STATE.pendingLiveMissingSince = 0;
            }
            if (!STATE.pendingLiveCatalogMessages.length) {
                clearChatGptPendingRefresh();
            } else if (remoteTailLiveIndex >= 0) {
                if (!STATE.pendingLiveMissingSince) {
                    STATE.pendingLiveMissingSince = Date.now();
                    window.setTimeout(() => scheduleScan(0), 800);
                } else if (Date.now() - STATE.pendingLiveMissingSince >= 700) {
                    clearChatGptPendingRefresh();
                }
            } else {
                STATE.pendingLiveMissingSince = 0;
            }
        }

        const pendingMessages = STATE.pendingLiveContext === context
            ? STATE.pendingLiveCatalogMessages.map(snapshotChatGptCatalogMessage)
            : [];
        pendingMessages.forEach((message, pendingIndex) => {
            message.remoteIndex = remoteMessages.length + pendingIndex;
            message.source = 'live-pending-current-branch';
            message.anchorSource = message.anchorSource || 'live-pending';
        });
        scheduleChatGptPendingRefresh(pendingMessages);
        return reboundRemote.concat(pendingMessages);
    }

    function snapshotChatGptCatalogMessages(messages) {
        return messages.map((message, index) => {
            const snapshot = snapshotChatGptCatalogMessage(message, index);
            if (typeof snapshot.remoteIndex !== 'number' && typeof snapshot.nativeTocIndex !== 'number') {
                snapshot.remoteIndex = index;
            }
            return snapshot;
        });
    }

    function replaceChatGptCatalog(messages, context, source) {
        STATE.chatGptCatalogMessages = snapshotChatGptCatalogMessages(messages);
        STATE.chatGptCatalogContext = context;
        STATE.chatGptCatalogSource = source;
    }

    function getChatGptMessageTurnIndex(message, fallbackIndex) {
        if (message && typeof message.turnIndex === 'number') return message.turnIndex;
        const target = getMessageTarget(message);
        const turn = target && target.closest
            ? target.closest('[data-testid^="conversation-turn-"]')
            : null;
        if (turn) {
            const match = /^conversation-turn-(\d+)/.exec(turn.getAttribute('data-testid') || '');
            if (match && match[1]) {
                const parsed = Number.parseInt(match[1], 10);
                if (!Number.isNaN(parsed)) return parsed;
            }
        }
        return typeof fallbackIndex === 'number' ? fallbackIndex + 1000000 : Number.MAX_SAFE_INTEGER;
    }

    function getChatGptMessageTurnId(message) {
        if (message && message.turnId) return message.turnId;
        const target = getMessageTarget(message);
        const turn = target && target.closest
            ? target.closest('[data-turn-id-container], [data-turn-id]')
            : null;
        return turn
            ? turn.getAttribute('data-turn-id-container') || turn.getAttribute('data-turn-id') || ''
            : '';
    }

    function mergeLiveMessagesIntoChatGptCatalog(liveMessages, context) {
        const existing = STATE.chatGptCatalogContext === context
            ? STATE.chatGptCatalogMessages.map(snapshotChatGptCatalogMessage)
            : [];
        const byIdentity = new Map();
        const byTurnId = new Map();

        existing.forEach((message) => {
            getMessageIdentityKeys(message).forEach((key) => {
                if (!byIdentity.has(key)) byIdentity.set(key, message);
            });
            const turnId = getChatGptMessageTurnId(message);
            if (turnId && !byTurnId.has(turnId)) byTurnId.set(turnId, message);
        });

        liveMessages.forEach((liveMessage, liveIndex) => {
            const identityKeys = getMessageIdentityKeys(liveMessage);
            let cached = null;
            for (let i = 0; i < identityKeys.length; i++) {
                if (byIdentity.has(identityKeys[i])) {
                    cached = byIdentity.get(identityKeys[i]);
                    break;
                }
            }
            const liveTurnId = getChatGptMessageTurnId(liveMessage);
            if (!cached && liveTurnId && byTurnId.has(liveTurnId)) {
                cached = byTurnId.get(liveTurnId);
            }

            if (!cached) {
                cached = snapshotChatGptCatalogMessage(liveMessage, liveIndex);
                cached.turnIndex = getChatGptMessageTurnIndex(liveMessage, liveIndex);
                cached.turnId = liveTurnId;
                existing.push(cached);
            } else {
                const rebound = snapshotChatGptCatalogMessage(liveMessage, liveIndex);
                cached.anchor = rebound.anchor;
                cached.container = rebound.container;
                cached.text = rebound.text || cached.text;
                cached.identityKeys = createMessageIdentityKeys.apply(
                    null,
                    getMessageIdentityKeys(cached).concat(identityKeys)
                );
                cached.identityKey = cached.identityKeys[0] || '';
                cached.turnIndex = Math.min(
                    getChatGptMessageTurnIndex(cached, liveIndex),
                    getChatGptMessageTurnIndex(liveMessage, liveIndex)
                );
                cached.turnId = cached.turnId || liveTurnId;
                cached.anchorSource = 'turn-cache-live-anchor';
            }

            getMessageIdentityKeys(cached).forEach((key) => byIdentity.set(key, cached));
            if (cached.turnId) byTurnId.set(cached.turnId, cached);
        });

        existing.sort((a, b) => {
            const aTurn = getChatGptMessageTurnIndex(a);
            const bTurn = getChatGptMessageTurnIndex(b);
            if (aTurn !== bTurn) return aTurn - bTurn;
            return (a.observedIndex || 0) - (b.observedIndex || 0);
        });
        existing.forEach((message, index) => {
            message.remoteIndex = index;
        });

        replaceChatGptCatalog(existing, context, 'live-turn-cache');
        return bindLiveMessagesToChatGptCatalog(STATE.chatGptCatalogMessages, liveMessages);
    }

    function bindLiveMessagesToChatGptCatalog(catalogMessages, liveMessages) {
        if (!catalogMessages.length) return [];
        annotateMessagesWithNativeToc(liveMessages);

        const usedLiveMessages = new Set();
        const liveByIdentity = new Map();
        const liveByOrder = new Map();
        const catalogTextCounts = new Map();
        const liveByText = new Map();

        catalogMessages.forEach((message) => {
            const comparable = getComparableMessageText(message.text);
            if (comparable) catalogTextCounts.set(comparable, (catalogTextCounts.get(comparable) || 0) + 1);
        });

        liveMessages.forEach((message) => {
            getMessageIdentityKeys(message).forEach((key) => {
                if (!liveByIdentity.has(key)) liveByIdentity.set(key, message);
            });

            const order = typeof message.nativeTocIndex === 'number'
                ? message.nativeTocIndex
                : message.remoteIndex;
            if (typeof order === 'number' && !liveByOrder.has(order)) liveByOrder.set(order, message);

            const comparable = getComparableMessageText(message.text);
            if (comparable) {
                const group = liveByText.get(comparable) || [];
                group.push(message);
                liveByText.set(comparable, group);
            }
        });

        const rebound = catalogMessages.map((catalogMessage, index) => {
            const snapshot = snapshotChatGptCatalogMessage(catalogMessage, index);
            const catalogOrder = typeof snapshot.nativeTocIndex === 'number'
                ? snapshot.nativeTocIndex
                : snapshot.remoteIndex;
            const keys = getMessageIdentityKeys(snapshot);
            let liveMessage = null;
            const compatibleFallback = candidate => candidate && !usedLiveMessages.has(candidate) &&
                !(keys.length && getMessageIdentityKeys(candidate).length) &&
                getComparableMessageText(candidate.text) === getComparableMessageText(snapshot.text);

            if (!liveMessage) {
                for (let i = 0; i < keys.length; i++) {
                    const candidate = liveByIdentity.get(keys[i]);
                    if (candidate && !usedLiveMessages.has(candidate)) {
                        liveMessage = candidate;
                        break;
                    }
                }
            }

            if (!liveMessage && typeof catalogOrder === 'number') {
                const candidate = liveByOrder.get(catalogOrder);
                if (compatibleFallback(candidate)) liveMessage = candidate;
            }

            if (!liveMessage) {
                const comparable = getComparableMessageText(snapshot.text);
                const candidates = comparable ? liveByText.get(comparable) || [] : [];
                if (catalogTextCounts.get(comparable) === 1 && candidates.length === 1 && compatibleFallback(candidates[0])) {
                    liveMessage = candidates[0];
                }
            }

            if (!liveMessage || usedLiveMessages.has(liveMessage)) return snapshot;
            usedLiveMessages.add(liveMessage);

            snapshot.anchor = liveMessage.anchor && liveMessage.anchor.isConnected ? liveMessage.anchor : null;
            snapshot.container = liveMessage.container && liveMessage.container.isConnected ? liveMessage.container : null;
            snapshot.identityKeys = createMessageIdentityKeys.apply(
                null,
                getMessageIdentityKeys(snapshot).concat(getMessageIdentityKeys(liveMessage))
            );
            snapshot.identityKey = snapshot.identityKeys[0] || '';
            snapshot.anchorSource = liveMessage.anchorSource || 'catalog-live-anchor';
            return snapshot;
        });

        STATE.chatGptCatalogMessages = snapshotChatGptCatalogMessages(rebound);
        return rebound;
    }

    function snapshotChatGptCatalogMessage(message, fallbackIndex) {
        const target = getMessageTarget(message);
        const targetConnected = !!(target && target.isConnected);
        const anchorConnected = !!(message && message.anchor && message.anchor.isConnected);
        const containerConnected = !!(message && message.container && message.container.isConnected);
        const identityKeys = getMessageIdentityKeys(message);
        const snapshot = {
            container: containerConnected ? message.container : (targetConnected ? target : null),
            anchor: anchorConnected ? message.anchor : (targetConnected ? target : null),
            text: message && message.text ? message.text : '',
            identityKey: identityKeys[0] || '',
            identityKeys,
            navigationId: message && message.navigationId ? message.navigationId : '',
            nativeTocText: message && message.nativeTocText ? message.nativeTocText : '',
            source: message && message.source ? message.source : '',
            anchorSource: message && message.anchorSource ? message.anchorSource : '',
            observedIndex: message && typeof message.observedIndex === 'number' ? message.observedIndex : fallbackIndex
        };

        if (message && typeof message.turnIndex === 'number') {
            snapshot.turnIndex = message.turnIndex;
        }
        if (message && message.turnId) {
            snapshot.turnId = message.turnId;
        }

        if (message && typeof message.remoteIndex === 'number') {
            snapshot.remoteIndex = message.remoteIndex;
        }
        if (message && typeof message.pathIndex === 'number') {
            snapshot.pathIndex = message.pathIndex;
        }
        if (message && typeof message.virtualRowIndex === 'number') {
            snapshot.virtualRowIndex = message.virtualRowIndex;
        }
        if (message && typeof message.nativeTocIndex === 'number') {
            snapshot.nativeTocIndex = message.nativeTocIndex;
        }
        return snapshot;
    }

    function getChatGptAccountId() {
        try {
            const raw = window.localStorage.getItem('_account');
            if (!raw) return '';
            const parsed = JSON.parse(raw);
            if (typeof parsed === 'string') return parsed === 'personal' ? '' : parsed;
            if (!parsed || typeof parsed !== 'object') return '';
            return parsed.account_id || parsed.accountId || parsed.id ||
                (parsed.account && (parsed.account.id || parsed.account.account_id)) || '';
        } catch (error) {
            return '';
        }
    }

    function getChatGptCookie(name) {
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = document.cookie.match(new RegExp(`(?:^|; )${escapedName}=([^;]*)`));
        if (!match) return '';
        try {
            return decodeURIComponent(match[1]);
        } catch (error) {
            return match[1];
        }
    }

    function getChatGptOriginalFetch() {
        const pageWindow = getPageWindow();
        const pageFetch = pageWindow.fetch;
        if (typeof pageFetch !== 'function') return null;
        return pageFetch.__aiTocOriginalFetch || pageFetch;
    }

    function fetchChatGptSessionToken(fetchFn) {
        return fetchFn.call(getPageWindow(), '/api/auth/session', {
            method: 'GET',
            credentials: 'include',
            headers: { accept: 'application/json' }
        })
            .then((response) => response.ok ? response.json() : null)
            .then((session) => {
                if (!session) return '';
                return session.accessToken || session.access_token || session.token ||
                    (session.user && session.user.accessToken) || '';
            })
            .catch(() => '');
    }

    function buildChatGptConversationHeaders(token) {
        const headers = { accept: 'application/json' };
        if (token) headers.authorization = `Bearer ${token}`;
        const accountId = getChatGptAccountId();
        if (accountId) headers['chatgpt-account-id'] = accountId;
        const deviceId = getChatGptCookie('oai-did');
        if (deviceId) headers['oai-device-id'] = deviceId;
        const language = document.documentElement.lang || navigator.language;
        if (language) headers['oai-language'] = language;
        return headers;
    }

    function requestChatGptConversationIndex(conversationId, context, source) {
        if (!conversationId || !context) return Promise.resolve(false);
        const existing = STATE.chatGptConversationRequests.get(context);
        if (existing) return existing;
        const fetchFn = getChatGptOriginalFetch();
        if (!fetchFn) return Promise.reject(new Error('fetch-unavailable'));

        const request = fetchChatGptSessionToken(fetchFn)
            .then((token) => {
                const encodedId = encodeURIComponent(conversationId);
                const urls = [
                    `/backend-api/conversation/${encodedId}`,
                    `/backend-api/f/conversation/${encodedId}`,
                    `/backend-api/conversations/${encodedId}`
                ];
                const headers = buildChatGptConversationHeaders(token);

                const tryNext = (index) => {
                    if (index >= urls.length) return Promise.resolve(false);
                    const url = urls[index];
                    return fetchFn.call(getPageWindow(), url, {
                        method: 'GET',
                        credentials: 'include',
                        headers
                    }).then((response) => {
                        if (context === getChatGptMessageCacheContext()) {
                            STATE.remoteResponseUrl = response.url || url;
                            STATE.remoteResponseStatus = response.status || 0;
                        }
                        if (!response.ok) {
                            if (context === getChatGptMessageCacheContext()) {
                                STATE.remoteFetchStatus = `${source}:http-${response.status}`;
                            }
                            return tryNext(index + 1);
                        }
                        return response.json()
                            .then((data) => {
                                const applied = applyChatGptConversationData(data, source, context);
                                return applied && STATE.chatGptConversationCache.has(context)
                                    ? true
                                    : tryNext(index + 1);
                            }, () => {
                                if (context === getChatGptMessageCacheContext()) {
                                    STATE.remoteFetchStatus = `${source}:read-error`;
                                }
                                return tryNext(index + 1);
                            });
                    });
                };

                return tryNext(0);
            })
            .then((loaded) => {
                if (!loaded) throw new Error('no-authoritative-response');
                return true;
            })
            .finally(() => {
                STATE.chatGptConversationRequests.delete(context);
            });
        STATE.chatGptConversationRequests.set(context, request);
        return request;
    }

    function hydrateChatGptConversationMessages(forceRefresh) {
        const conversationId = getChatGptConversationId();
        if (!conversationId) return;
        const context = getChatGptMessageCacheContext();
        if (
            !forceRefresh &&
            STATE.remoteMessageContext === context &&
            STATE.remoteMessageIsAuthoritative &&
            STATE.remoteMessages.length
        ) return;
        if (STATE.chatGptConversationRequests.has(context)) return;

        const now = Date.now();
        const lastAttemptedAt = STATE.chatGptFetchAttemptedAt.get(context) || 0;
        if (!forceRefresh && now - lastAttemptedAt < 800) return;
        STATE.chatGptFetchAttemptedAt.set(context, now);
        const attempts = (STATE.chatGptFetchAttempts.get(context) || 0) + 1;
        STATE.chatGptFetchAttempts.set(context, attempts);
        STATE.remoteFetchContext = context;
        STATE.remoteFetchInFlight = true;
        STATE.remoteFetchStatus = 'direct:loading';

        requestChatGptConversationIndex(conversationId, context, 'direct')
            .then(() => {
                STATE.chatGptFetchAttempts.set(context, 0);
            })
            .catch((error) => {
                if (context === getChatGptMessageCacheContext()) {
                    STATE.remoteFetchStatus = `direct:${error && error.message ? error.message : 'error'}`;
                    if (attempts < 4) {
                        window.setTimeout(() => {
                            if (
                                context === getChatGptMessageCacheContext() &&
                                !(STATE.remoteMessageContext === context && STATE.remoteMessageIsAuthoritative)
                            ) {
                                hydrateChatGptConversationMessages(true);
                            }
                        }, Math.min(1800, 400 * attempts));
                    }
                }
            })
            .finally(() => {
                if (context === getChatGptMessageCacheContext()) {
                    STATE.remoteFetchInFlight = false;
                    scheduleScan(0);
                }
            });
    }

    function prefetchChatGptConversationFromLink(target) {
        if (!target || !target.closest) return;
        const link = target.closest('a[href]');
        if (!link) return;
        const conversationId = getChatGptConversationIdFromText(link.href || link.getAttribute('href'));
        if (!conversationId || conversationId === getChatGptConversationId()) return;
        const context = `chatgpt:${conversationId}`;
        if (STATE.chatGptConversationCache.has(context) || STATE.chatGptConversationRequests.has(context)) return;
        const lastAttemptedAt = STATE.chatGptFetchAttemptedAt.get(context) || 0;
        if (Date.now() - lastAttemptedAt < 15000) return;
        STATE.chatGptFetchAttemptedAt.set(context, Date.now());
        requestChatGptConversationIndex(conversationId, context, 'sidebar-prefetch')
            .then(() => recordChatGptDebugEvent('prefetch-complete', { context }))
            .catch((error) => {
                recordChatGptDebugEvent('prefetch-error', {
                    context,
                    error: error && error.message ? error.message : 'error'
                });
                if (context === getChatGptMessageCacheContext()) {
                    STATE.chatGptFetchAttemptedAt.delete(context);
                    hydrateChatGptConversationMessages(true);
                }
            });
    }

    function installChatGptConversationPrefetch() {
        if (!window.location.hostname.includes('chatgpt.com') || STATE.chatGptPrefetchInstalled) return;
        STATE.chatGptPrefetchInstalled = true;
        document.addEventListener('pointerover', (event) => prefetchChatGptConversationFromLink(event.target), true);
        document.addEventListener('focusin', (event) => prefetchChatGptConversationFromLink(event.target), true);
        document.addEventListener('pointerdown', (event) => prefetchChatGptConversationFromLink(event.target), true);
    }

    function isChatGptConversationResponseUrl(url) {
        return !!(url && (
            /\/backend-api\/(?:f\/)?conversations?\/[0-9a-f-]{20,}/i.test(url) ||
            /\/backend-api\/(?:f\/)?conversations?[^#]*[?&]conversation_id=[0-9a-f-]{20,}/i.test(url)
        ));
    }

    function readConversationResponse(response, source) {
        if (!response || !isChatGptConversationResponseUrl(response.url)) return;

        const conversationId = getChatGptConversationIdFromText(response.url);
        const context = conversationId ? `chatgpt:${conversationId}` : getChatGptMessageCacheContext();
        const isCurrentContext = context === getChatGptMessageCacheContext();
        if (isCurrentContext) {
            STATE.remoteResponseUrl = response.url || '';
            STATE.remoteResponseStatus = response.status || 0;
        }
        if (!response.ok) {
            if (isCurrentContext && (STATE.remoteMessageContext !== context || !STATE.remoteMessageIsAuthoritative)) {
                STATE.remoteFetchStatus = `${source}:http-${response.status}`;
            }
            return;
        }

        response.clone().json()
            .then((data) => applyChatGptConversationData(data, source, context))
            .catch(() => {
                if (isCurrentContext) STATE.remoteFetchStatus = `${source}:read-error`;
            });
    }

    function installChatGptConversationInterceptors() {
        if (!window.location.hostname.includes('chatgpt.com')) return;
        if (STATE.conversationInterceptorInstalled) return;
        STATE.conversationInterceptorInstalled = true;

        const pageWindow = getPageWindow();
        const originalFetch = pageWindow.fetch;
        if (typeof originalFetch === 'function') {
            const interceptedFetch = function interceptedFetch() {
                const result = originalFetch.apply(this, arguments);
                Promise.resolve(result)
                    .then((response) => readConversationResponse(response, 'page-fetch'))
                    .catch(() => {});
                return result;
            };
            interceptedFetch.__aiTocOriginalFetch = originalFetch.__aiTocOriginalFetch || originalFetch;
            pageWindow.fetch = interceptedFetch;
        }

        const OriginalXHR = pageWindow.XMLHttpRequest;
        if (typeof OriginalXHR === 'function' && OriginalXHR.prototype && !OriginalXHR.prototype.__aiTocConversationPatched) {
            const xhrProto = OriginalXHR.prototype;
            const originalOpen = xhrProto.open;
            const originalSend = xhrProto.send;

            xhrProto.open = function interceptedOpen(method, url) {
                this.__aiTocConversationUrl = typeof url === 'string' ? url : String(url || '');
                return originalOpen.apply(this, arguments);
            };

            xhrProto.send = function interceptedSend() {
                if (!this.__aiTocConversationListener) {
                    this.__aiTocConversationListener = true;
                    this.addEventListener('load', () => {
                        const requestUrl = this.__aiTocConversationUrl || '';
                        if (!isChatGptConversationResponseUrl(requestUrl)) return;
                        const conversationId = getChatGptConversationIdFromText(requestUrl);
                        const context = conversationId ? `chatgpt:${conversationId}` : getChatGptMessageCacheContext();
                        const isCurrentContext = context === getChatGptMessageCacheContext();
                        if (isCurrentContext) {
                            STATE.remoteResponseUrl = requestUrl;
                            STATE.remoteResponseStatus = this.status || 0;
                        }
                        if (this.status < 200 || this.status >= 300) {
                            if (isCurrentContext && (STATE.remoteMessageContext !== context || !STATE.remoteMessageIsAuthoritative)) {
                                STATE.remoteFetchStatus = `page-xhr:http-${this.status}`;
                            }
                            return;
                        }

                        try {
                            const data = JSON.parse(this.responseText);
                            applyChatGptConversationData(data, 'page-xhr', context);
                        } catch (error) {
                            if (isCurrentContext) STATE.remoteFetchStatus = 'page-xhr:read-error';
                        }
                    });
                }

                return originalSend.apply(this, arguments);
            };

            xhrProto.__aiTocConversationPatched = true;
        }
    }

    function exposeDebugInfo() {
        const pageWindow = getPageWindow();
        const debugFn = function aiTocDebug() {
            const alignmentMatches = getCurrentTextAlignmentMatches();
            const chatGptFallbackScrollContainer = ADAPTER.id === 'chatgpt'
                ? getChatGptFallbackScrollContainer()
                : null;
            const nativeTocButtons = getChatGptNativeTocButtons();
            const nativeTocTexts = getChatGptNativeTocTexts(nativeTocButtons);
            const liveSamples = getChatGptLiveUserElements().map((element, index) => {
                const text = extractChatGptUserQueryText(element);
                return {
                    index,
                    identityKey: getMessageIdentityKeyFromElement(element),
                    text: text.slice(0, 120),
                    comparable: getComparableMessageText(text).slice(0, 120)
                };
            });
            const remoteSamples = STATE.remoteMessages.map((message, index) => ({
                index,
                identityKeys: getMessageIdentityKeys(message),
                text: message.text.slice(0, 120),
                comparable: getComparableMessageText(message.text).slice(0, 120)
            }));
            const nativeTocSamples = getChatGptNativeTocEntries().map((entry) => ({
                index: entry.index,
                text: entry.text.slice(0, 120),
                hasElement: !!(entry.element && entry.element.isConnected),
                isActive: entry.isActive
            }));
            const adapterSamples = Array.from(document.querySelectorAll(ADAPTER.selector)).map((element, index) => ({
                index,
                text: ADAPTER.id === 'chatgpt'
                    ? extractChatGptUserQueryText(element).slice(0, 120)
                    : normalizeMessageText(element).slice(0, 120)
            }));
            const genericAlignmentSamples = alignmentMatches
                .filter((match) => /^generic-/.test(match.source || ''))
                .map((match) => ({
                    remoteIndex: match.remoteIndex,
                    source: match.source,
                    tag: match.element.tagName,
                    className: String(match.element.className || '').slice(0, 160),
                    text: match.liveText.slice(0, 120)
                }));
            const duplicateTextGroups = Array.from(STATE.messages.reduce((groups, message, index) => {
                const comparable = getComparableMessageText(message.text);
                if (!comparable) return groups;
                const group = groups.get(comparable) || [];
                group.push({
                    index,
                    identityKeys: getMessageIdentityKeys(message),
                    remoteIndex: typeof message.remoteIndex === 'number' ? message.remoteIndex : null,
                    nativeTocIndex: typeof message.nativeTocIndex === 'number' ? message.nativeTocIndex : null,
                    stableOrder: typeof message.stableOrder === 'number' ? message.stableOrder : null,
                    text: message.text.slice(0, 120)
                });
                groups.set(comparable, group);
                return groups;
            }, new Map()).values()).filter((group) => group.length > 1);

            return {
                version: '2.8.9',
                conversationId: getChatGptConversationId(),
                url: window.location.href,
                adapterId: ADAPTER.id,
                adapterSelector: ADAPTER.selector,
                adapterMatches: adapterSamples.length,
                liveDomUserMessages: getChatGptLiveUserElements().length,
                genericDomTextMatches: genericAlignmentSamples.length,
                genericDomTextSamples: genericAlignmentSamples,
                chatGptFallbackScrollContainer: chatGptFallbackScrollContainer
                    ? describeClaudeScrollContainer(chatGptFallbackScrollContainer)
                    : '',
                chatGptFallbackScrollMaxTop: chatGptFallbackScrollContainer
                    ? Math.round(getScrollMaxTop(chatGptFallbackScrollContainer))
                    : 0,
                nativeTocMessages: getChatGptNativeTocEntries().length,
                nativeTocButtons: nativeTocButtons.length,
                nativeTocTexts: nativeTocTexts.length,
                nativeTocButtonLabels: nativeTocButtons.slice(0, 12).map((button) => button.getAttribute('aria-label') || ''),
                nativeTocTextSamples: nativeTocTexts.slice(0, 12),
                userMessageSlots: getChatGptMessageSlotSummary().filter((slot) => slot.userIndex !== null).length,
                chatGptIndexedSlotLayoutComplete: hasCompleteChatGptIndexedSlotLayout(getChatGptMessageSlotRoot()),
                chatGptSlotRootCount: document.querySelectorAll('[class*="convSearchResultHighlightRoot"]').length,
                tocMessages: STATE.messages.length,
                chatGptCatalogMessages: STATE.chatGptCatalogMessages.length,
                chatGptCatalogContext: STATE.chatGptCatalogContext,
                chatGptCatalogSource: STATE.chatGptCatalogSource,
                chatGptHistoryWarmup: STATE.chatGptHistoryWarmupDebug,
                chatGptConversationCacheSize: STATE.chatGptConversationCache.size,
                chatGptConversationCacheKeys: Array.from(STATE.chatGptConversationCache.keys()),
                chatGptConversationRequests: Array.from(STATE.chatGptConversationRequests.keys()),
                chatGptRouteContext: STATE.chatGptRouteContext,
                chatGptRouteChanges: STATE.chatGptRouteChanges,
                chatGptRouteChangedAt: STATE.chatGptRouteChangedAt,
                chatGptRouteWatcherInstalled: STATE.chatGptRouteWatcherInstalled,
                chatGptPrefetchInstalled: STATE.chatGptPrefetchInstalled,
                chatGptDebugEvents: STATE.chatGptDebugEvents.slice(),
                remoteMessages: STATE.remoteMessages.length,
                remoteMessageContext: STATE.remoteMessageContext,
                remoteMessageSource: STATE.remoteMessageSource,
                remoteMessageIsAuthoritative: STATE.remoteMessageIsAuthoritative,
                remoteFetchContext: STATE.remoteFetchContext,
                remoteFetchInFlight: STATE.remoteFetchInFlight,
                remoteFetchStatus: STATE.remoteFetchStatus,
                remoteRefreshScheduled: !!STATE.remoteRefreshTimer,
                remoteRefreshAttempts: STATE.remoteRefreshAttempts,
                pendingLiveMessages: STATE.pendingLiveMessages,
                remoteResponseUrl: STATE.remoteResponseUrl,
                remoteResponseStatus: STATE.remoteResponseStatus,
                remotePayloadShape: STATE.remotePayloadShape,
                remotePayloadPath: STATE.remotePayloadPath,
                chatGptPathIdentityMappings: STATE.chatGptPathIndexByIdentity.size,
                claudeConversationId: getClaudeConversationId(),
                claudeCatalogMessages: STATE.claudeCatalogMessages.length,
                claudeCatalogContext: STATE.claudeCatalogContext,
                claudeCatalogSource: STATE.claudeCatalogSource,
                claudeConversationCacheSize: STATE.claudeConversationCache.size,
                claudeConversationCacheKeys: Array.from(STATE.claudeConversationCache.keys()),
                claudeConversationRequests: Array.from(STATE.claudeConversationRequests.keys()),
                claudeRemoteMessages: STATE.claudeRemoteMessages.length,
                claudeRemotePathMessages: STATE.claudeRemotePath.length,
                claudeRenderableRows: STATE.claudeRenderablePathIndexes.length,
                claudeRemoteContext: STATE.claudeRemoteContext,
                claudeRemoteSource: STATE.claudeRemoteSource,
                claudeRemoteStatus: STATE.claudeRemoteStatus,
                claudeRemoteUpdatedAt: STATE.claudeRemoteUpdatedAt,
                claudeLastConversationUrl: STATE.claudeLastConversationUrl,
                claudeObservedUrls: STATE.claudeObservedUrls.slice(),
                claudeOrganizationCandidates: STATE.claudeOrganizationCandidates.slice(),
                claudeOrganizationStatus: STATE.claudeOrganizationStatus,
                claudeHydrateUrl: STATE.claudeHydrateUrl,
                claudeHydrateContext: STATE.claudeHydrateContext,
                claudeHydrateInFlight: STATE.claudeHydrateInFlight,
                claudeHydrateAttempts: STATE.claudeHydrateAttempts,
                claudeHydrateRetryScheduled: !!STATE.claudeHydrateRetryTimer,
                claudeRouteContext: STATE.claudeRouteContext,
                claudeRouteChanges: STATE.claudeRouteChanges,
                claudeRouteChangedAt: STATE.claudeRouteChangedAt,
                claudeRouteWatcherInstalled: STATE.claudeRouteWatcherInstalled,
                claudePrefetchInstalled: STATE.claudePrefetchInstalled,
                claudeDebugEvents: STATE.claudeDebugEvents.slice(),
                claudeResourceObserverInstalled: !!STATE.claudeResourceObserver,
                claudeInterceptorInstalled: STATE.claudeConversationInterceptorInstalled,
                claudeDirectDomMessages: STATE.claudeDirectDomMessages,
                claudeDocumentUserMessages: STATE.claudeDocumentUserMessages,
                claudeDirectDomSamples: STATE.claudeDirectDomSamples.slice(),
                claudeDirectScrollContainer: STATE.claudeDirectScrollContainer,
                claudeDirectScrollStats: STATE.claudeDirectScrollStats,
                claudeVirtualRows: STATE.claudeVirtualRows.slice(),
                claudeVirtualTotalRows: STATE.claudeVirtualTotalRows,
                tocSource: STATE.lastTocSource,
                interceptorInstalled: STATE.conversationInterceptorInstalled,
                exactTextOrderAnchors: STATE.messages.filter((message) => message.anchorSource === 'exact-text-order').length,
                containedTextOrderAnchors: STATE.messages.filter((message) => message.anchorSource === 'contained-text-order').length,
                textOrderAnchors: STATE.messages.filter((message) => /text-order$/.test(message.anchorSource || '')).length,
                currentTextAlignmentMatches: alignmentMatches.map((match) => ({
                    liveIndex: match.liveIndex,
                    remoteIndex: match.remoteIndex,
                    source: match.source,
                    liveText: match.liveText.slice(0, 80)
                })),
                slotSummary: getChatGptMessageSlotSummary(),
                alignmentPreview: getTextAlignmentPreview(),
                adapterSamples,
                liveSamples,
                remoteSamples,
                nativeTocSamples,
                duplicateTextGroups,
                lastTocClick: STATE.lastTocClick,
                lastBoundaryDebug: STATE.lastBoundaryDebug,
                lastNavigationDebug: STATE.lastNavigationDebug,
                lastActiveDebug: STATE.lastActiveDebug
            };
        };
        window.__aiTocDebug = debugFn;
        window.__aiTocVersion = '2.8.9';
        pageWindow.__aiTocDebug = debugFn;
        pageWindow.__aiTocVersion = '2.8.9';
    }

    function collectMessagesFromAdapter(adapter) {
        if (adapter.beforeCollect) adapter.beforeCollect();

        const allLines = Array.from(document.querySelectorAll(adapter.selector));
        const messages = [];
        let currentGroup = null;

        allLines.forEach((line) => {
            const container = adapter.resolveMessageContainer(line);
            if (!container) return;

            const text = adapter.getMessageLabel(line, container);
            if (!text) return;

            if (currentGroup && currentGroup.container === container) {
                if (currentGroup.text !== text) {
                    currentGroup.text += ` ${text}`;
                }
                return;
            }

            if (currentGroup) messages.push(currentGroup);
            currentGroup = {
                container,
                anchor: line,
                text,
                identityKey: getMessageIdentityKeyFromElement(line),
                identityKeys: createMessageIdentityKeys(getMessageIdentityKeyFromElement(line))
            };
        });

        if (currentGroup) messages.push(currentGroup);

        const usedContainers = new Set(messages.map((message) => message.container));
        const knownSignatures = new Set(messages.map((message) => getContainerSignature(message.container)).filter(Boolean));
        const extraMessages = adapter.collectExtraMessages(knownSignatures, usedContainers, isPanelMutation) || [];

        if (extraMessages.length) {
            messages.push(...extraMessages);
            messages.sort(compareMessageOrder);
        }

        if (adapter.mergeMessages) {
            return adapter.mergeMessages(messages);
        }

        return messages;
    }

    function getMessageTarget(message) {
        return message ? (message.anchor || message.container) : null;
    }

    function isMessageConnected(message) {
        const target = getMessageTarget(message);
        return !!(target && target.isConnected);
    }

    function getDefaultScrollReferenceTargets(messages, selector) {
        if (messages.length) {
            const targets = [
                getMessageTarget(messages[0]),
                getMessageTarget(messages[(messages.length - 1) >> 1]),
                getMessageTarget(messages[messages.length - 1])
            ].filter(Boolean);
            if (targets.length) return targets;
        }

        const fallback = document.querySelector(selector);
        return fallback ? [fallback] : [];
    }

    const CLAUDE_USER_SELECTOR = [
        '[data-testid="user-message"]',
        '[data-testid^="user-message"]',
        '.font-user-message',
        '[class*="font-user-message"]'
    ].join(', ');

    function getClaudeMessageTextElement(container) {
        if (!container || !container.querySelector) return container;
        return container.querySelector('.font-user-message, [class*="font-user-message"]') || container;
    }

    function collectClaudeUserMessageElements(root) {
        const queryRoot = root && root.querySelectorAll ? root : document;
        const seen = new Set();
        return Array.from(queryRoot.querySelectorAll(CLAUDE_USER_SELECTOR)).reduce((result, element) => {
            const container = resolveClaudeMessageContainer(element) || element;
            if (
                !container ||
                seen.has(container) ||
                isClaudeComposerElement(container) ||
                container.closest('#ai-toc-v2_2')
            ) {
                return result;
            }
            seen.add(container);
            result.push(container);
            return result;
        }, []);
    }

    function isClaudeScrollableContainer(element) {
        if (!element) return false;
        const overflowY = window.getComputedStyle(element).overflowY;
        const allowsScroll = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay' ||
            element.getAttribute('data-autoscroll-container') === 'true';
        return allowsScroll && element.scrollHeight > element.clientHeight + 4;
    }

    function findClaudeScrollContainer() {
        const candidates = Array.from(document.querySelectorAll('.font-claude-response, [data-testid="user-message"]'));
        let current = candidates.find((element) => !element.closest('#ai-toc-v2_2')) || null;
        while (current && current !== document.body) {
            if (isClaudeScrollableContainer(current)) return current;
            current = current.parentElement;
        }

        const fallbacks = [
            '[data-autoscroll-container="true"]',
            '#main-content .overflow-y-scroll',
            '#root .overflow-y-auto.overflow-x-hidden'
        ];
        for (let i = 0; i < fallbacks.length; i++) {
            const element = document.querySelector(fallbacks[i]);
            if (isClaudeScrollableContainer(element)) return element;
        }
        return null;
    }

    function getClaudeReferenceScrollContainer() {
        const internal = findClaudeScrollContainer();
        const pageScroller = document.scrollingElement;
        const internalRange = internal ? internal.scrollHeight - internal.clientHeight : -1;
        const pageRange = pageScroller ? pageScroller.scrollHeight - pageScroller.clientHeight : -1;
        if (
            internal &&
            pageScroller &&
            pageRange > internalRange + 100 &&
            pageScroller.scrollHeight > pageScroller.clientHeight + 4
        ) {
            return pageScroller;
        }
        if (internal) return internal;
        if (pageScroller && pageScroller.scrollHeight > pageScroller.clientHeight + 4) return pageScroller;
        return null;
    }

    function describeClaudeScrollContainer(element) {
        if (!element) return '';
        const id = element.id ? `#${element.id}` : '';
        const classes = typeof element.className === 'string'
            ? element.className.trim().split(/\s+/).slice(0, 5).join('.')
            : '';
        return `${element.tagName || ''}${id}${classes ? `.${classes}` : ''}`;
    }

    function collectClaudeDirectDomMessages() {
        const internal = findClaudeScrollContainer();
        const referenceContainer = getClaudeReferenceScrollContainer();
        const elements = collectClaudeUserMessageElements(document);
        const messages = elements.reduce((result, element, observedIndex) => {
            const text = normalizeMessageText(getClaudeMessageTextElement(element));
            if (!text) return result;
            const identityKeys = createMessageIdentityKeys(getMessageIdentityKeyFromElement(element));
            result.push({
                container: element,
                anchor: element,
                text,
                identityKey: identityKeys[0] || '',
                identityKeys,
                observedIndex,
                source: 'claude-direct-dom'
            });
            return result;
        }, []);

        STATE.claudeDirectDomMessages = messages.length;
        STATE.claudeDocumentUserMessages = collectClaudeUserMessageElements(document).length;
        STATE.claudeDirectDomSamples = messages.slice(0, 12).map((message, index) => ({
            index,
            text: message.text.slice(0, 120),
            identityKeys: getMessageIdentityKeys(message)
        }));
        STATE.claudeDirectScrollContainer = describeClaudeScrollContainer(referenceContainer);
        STATE.claudeDirectScrollStats = {
            selected: referenceContainer ? describeClaudeScrollContainer(referenceContainer) : 'document',
            selectedScrollTop: referenceContainer ? Math.round(referenceContainer.scrollTop || 0) : 0,
            selectedScrollHeight: referenceContainer ? Math.round(referenceContainer.scrollHeight || 0) : 0,
            selectedClientHeight: referenceContainer ? Math.round(referenceContainer.clientHeight || 0) : 0,
            internal: describeClaudeScrollContainer(internal),
            internalRange: internal ? Math.round(internal.scrollHeight - internal.clientHeight) : -1,
            pageRange: document.scrollingElement
                ? Math.round(document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight)
                : -1
        };
        return messages;
    }

    function isClaudeComposerElement(element) {
        if (!element || !element.closest) return false;
        return !!element.closest('textarea, [contenteditable="true"], form, [data-testid*="composer"], [data-testid*="input"]');
    }

    function resolveClaudeMessageContainer(line) {
        if (!line) return null;

        const direct = line.closest('[data-testid="user-message"], [data-testid^="user-message"]');
        if (direct) return direct;

        const fontMessage = line.closest('.font-user-message, [class*="font-user-message"]');
        if (fontMessage) return fontMessage;

        return resolveGroupedMessageContainer(line, CLAUDE_USER_SELECTOR);
    }

    function getClaudeConversationIdFromText(text) {
        if (!text) return '';
        const patterns = [
            /\/chat\/([a-f0-9-]{20,})/i,
            /\/api\/(?:organizations\/[^/]+\/)?chat_conversations\/([a-f0-9-]{20,})/i,
            /\/api\/[^?#]*\/conversations\/([a-f0-9-]{20,})/i,
            /[?&](?:conversation_id|conversation_uuid|chat_conversation_id)=([a-f0-9-]{20,})/i
        ];
        for (let i = 0; i < patterns.length; i++) {
            const match = String(text).match(patterns[i]);
            if (match && match[1]) return match[1];
        }
        return '';
    }

    function getClaudeConversationId() {
        if (!window.location.hostname.includes('claude.ai')) return '';
        return getClaudeConversationIdFromText(window.location.href);
    }

    function getClaudeMessageContext() {
        const conversationId = getClaudeConversationId();
        return conversationId
            ? `claude:${conversationId}`
            : `${window.location.hostname}${window.location.pathname}${window.location.search}`;
    }

    function recordClaudeDebugEvent(type, details) {
        STATE.claudeDebugEvents.push({
            time: new Date().toISOString(),
            type,
            context: getClaudeMessageContext(),
            details: details || null
        });
        if (STATE.claudeDebugEvents.length > 30) {
            STATE.claudeDebugEvents.splice(0, STATE.claudeDebugEvents.length - 30);
        }
    }

    function storeClaudeConversationCache(context, index, source) {
        if (!context || !/^claude:/.test(context) || !index || !index.authoritative || !index.userMessages.length) {
            return false;
        }
        const cache = STATE.claudeConversationCache;
        cache.delete(context);
        cache.set(context, {
            messages: snapshotChatGptCatalogMessages(index.userMessages),
            fullPath: index.fullPath.map((entry) => Object.assign({}, entry)),
            renderablePathIndexes: index.renderablePathIndexes.slice(),
            source: source || 'claude-api',
            updatedAt: Date.now()
        });
        while (cache.size > 12) {
            cache.delete(cache.keys().next().value);
        }
        return true;
    }

    function restoreClaudeConversationCache(context) {
        const cached = STATE.claudeConversationCache.get(context);
        if (!cached || !cached.messages.length) return false;

        STATE.claudeConversationCache.delete(context);
        STATE.claudeConversationCache.set(context, cached);
        STATE.claudeRemoteMessages = snapshotChatGptCatalogMessages(cached.messages);
        STATE.claudeRemotePath = cached.fullPath.map((entry) => Object.assign({}, entry));
        STATE.claudeRenderablePathIndexes = cached.renderablePathIndexes.slice();
        STATE.claudeRemoteContext = context;
        STATE.claudeRemoteSource = `memory-cache:${cached.source}`;
        STATE.claudeRemoteStatus = `memory-cache:ok:${cached.messages.length}`;
        STATE.claudeRemoteUpdatedAt = cached.updatedAt || 0;
        replaceClaudeCatalog(STATE.claudeRemoteMessages, context, 'memory-cache-current-branch');
        STATE.messages = snapshotChatGptCatalogMessages(STATE.claudeCatalogMessages);
        STATE.messageListContext = context;
        STATE.lastTocSource = STATE.claudeCatalogSource;
        STATE.positionCache = [];
        STATE.positionsDirty = true;
        return true;
    }

    function resetClaudeConversationState(nextContext, source) {
        const previousContext = STATE.claudeRouteContext || STATE.claudeCatalogContext || STATE.claudeRemoteContext || '';
        if (previousContext === nextContext && STATE.claudeRouteContext === nextContext) return false;

        STATE.claudeRouteContext = nextContext;
        STATE.claudeRouteChanges += 1;
        STATE.claudeRouteChangedAt = Date.now();
        STATE.claudeJumpToken += 1;
        STATE.claudeCatalogMessages = [];
        STATE.claudeCatalogContext = '';
        STATE.claudeCatalogSource = '';
        STATE.claudeRemoteMessages = [];
        STATE.claudeRemotePath = [];
        STATE.claudeRenderablePathIndexes = [];
        STATE.claudeRemoteContext = '';
        STATE.claudeRemoteSource = '';
        STATE.claudeRemoteStatus = 'route-change:waiting';
        STATE.claudeRemoteUpdatedAt = 0;
        if (STATE.claudeHydrateRetryTimer) {
            window.clearTimeout(STATE.claudeHydrateRetryTimer);
            STATE.claudeHydrateRetryTimer = 0;
        }
        STATE.claudeHydrateUrl = '';
        STATE.claudeHydrateContext = nextContext;
        STATE.claudeHydrateInFlight = false;
        STATE.claudeHydrateAttempts = 0;
        STATE.claudeVirtualRows = [];
        STATE.claudeVirtualTotalRows = 0;
        STATE.messages = [];
        STATE.positionCache = [];
        STATE.positionsDirty = true;
        STATE.messageListContext = nextContext;
        const restoredFromCache = restoreClaudeConversationCache(nextContext);
        STATE.lastTocSource = restoredFromCache
            ? STATE.claudeCatalogSource
            : 'claude-awaiting-current-conversation';
        const list = getTocList();
        if (list) {
            if (restoredFromCache) renderScanResult(list, STATE.messages, -1);
            else renderEmptyTocState(list);
        }
        recordClaudeDebugEvent('route-change', {
            source: source || 'unknown',
            previousContext,
            nextContext,
            restoredFromCache
        });
        return true;
    }

    function checkClaudeRouteContext(source) {
        if (!window.location.hostname.includes('claude.ai')) return;
        syncPanelForConversation();
        const context = getClaudeMessageContext();
        if (!STATE.claudeRouteContext) {
            STATE.claudeRouteContext = context;
            recordClaudeDebugEvent('route-initialized', { source: source || 'unknown', context });
            return;
        }
        if (STATE.claudeRouteContext === context) return;
        resetClaudeConversationState(context, source);
        scheduleScan(0);
    }

    function installClaudeRouteWatcher() {
        if (!window.location.hostname.includes('claude.ai') || STATE.claudeRouteWatcherInstalled) return;
        STATE.claudeRouteWatcherInstalled = true;
        checkClaudeRouteContext('bootstrap');

        const pageWindow = getPageWindow();
        ['pushState', 'replaceState'].forEach((methodName) => {
            try {
                const historyObject = pageWindow && pageWindow.history;
                const original = historyObject && historyObject[methodName];
                if (typeof original !== 'function' || original.__aiTocClaudeRoutePatched) return;
                const wrapped = function wrappedClaudeHistory() {
                    const result = original.apply(this, arguments);
                    window.setTimeout(() => checkClaudeRouteContext(`history.${methodName}`), 0);
                    return result;
                };
                wrapped.__aiTocClaudeRoutePatched = true;
                historyObject[methodName] = wrapped;
            } catch (error) {
                recordClaudeDebugEvent('route-hook-error', {
                    methodName,
                    error: error && error.message ? error.message : 'unknown'
                });
            }
        });
        try {
            pageWindow.addEventListener('popstate', () => checkClaudeRouteContext('popstate'));
            pageWindow.addEventListener('hashchange', () => checkClaudeRouteContext('hashchange'));
        } catch (error) {
            window.addEventListener('popstate', () => checkClaudeRouteContext('popstate'));
            window.addEventListener('hashchange', () => checkClaudeRouteContext('hashchange'));
        }
        window.setInterval(() => checkClaudeRouteContext('poll'), 500);
    }

    function getClaudeMessageRole(message) {
        if (!message || typeof message !== 'object') return '';
        const sender = message.sender;
        if (typeof sender === 'string') return sender.toLowerCase();
        if (sender && typeof sender === 'object') {
            const senderRole = sender.role || sender.type || sender.name;
            if (senderRole) return String(senderRole).toLowerCase();
        }
        return String(message.role || message.author_role || message.authorRole || '').toLowerCase();
    }

    function flattenClaudeMessageContent(value) {
        if (typeof value === 'string') return value;
        if (!value) return '';
        if (Array.isArray(value)) {
            return value.map(flattenClaudeMessageContent).filter(Boolean).join(' ');
        }
        if (typeof value !== 'object') return '';
        if (typeof value.text === 'string') return value.text;
        if (typeof value.value === 'string' && /text/i.test(String(value.type || ''))) return value.value;
        if (Array.isArray(value.content)) return flattenClaudeMessageContent(value.content);
        if (Array.isArray(value.parts)) return flattenClaudeMessageContent(value.parts);
        if (/image/i.test(String(value.type || value.content_type || ''))) return '[image]';
        return '';
    }

    function getClaudeConversationMessageText(message) {
        if (!message || typeof message !== 'object') return '';
        if (typeof message.text === 'string' && message.text.trim()) return normalizePlainText(message.text);
        if (typeof message.prompt === 'string' && message.prompt.trim()) return normalizePlainText(message.prompt);
        return normalizePlainText(flattenClaudeMessageContent(message.content || message.parts));
    }

    function findClaudeConversationMessageArray(data) {
        const candidates = [];
        const seen = new WeakSet();

        function visit(value, depth, key) {
            if (!value || typeof value !== 'object' || depth > 5) return;
            if (seen.has(value)) return;
            seen.add(value);

            if (Array.isArray(value)) {
                const roleCount = value.reduce((count, item) => {
                    const role = getClaudeMessageRole(item);
                    return count + (/^(human|user|assistant|claude)$/.test(role) ? 1 : 0);
                }, 0);
                if (value.length && roleCount) {
                    const keyBonus = /chat_messages|messages/i.test(key || '') ? 1000 : 0;
                    candidates.push({ value, score: keyBonus + roleCount * 10 + value.length });
                }
                value.forEach((item) => visit(item, depth + 1, key));
                return;
            }

            Object.keys(value).forEach((childKey) => {
                visit(value[childKey], depth + 1, childKey);
            });
        }

        visit(data, 0, 'root');
        candidates.sort((a, b) => b.score - a.score);
        return candidates.length ? candidates[0].value : [];
    }

    function findClaudeConversationPayload(data) {
        const candidates = [];
        const seen = new WeakSet();

        function visit(value, depth) {
            if (!value || typeof value !== 'object' || depth > 6 || seen.has(value)) return;
            seen.add(value);
            if (!Array.isArray(value) && Array.isArray(value.chat_messages)) {
                const roleCount = value.chat_messages.reduce((count, item) => (
                    count + (/^(human|user|assistant|claude)$/.test(getClaudeMessageRole(item)) ? 1 : 0)
                ), 0);
                candidates.push({
                    value,
                    score: roleCount * 10 + value.chat_messages.length +
                        (value.current_leaf_message_uuid ? 10000 : 0)
                });
            }
            Object.keys(value).forEach((key) => visit(value[key], depth + 1));
        }

        visit(data, 0);
        candidates.sort((left, right) => right.score - left.score);
        return candidates.length ? candidates[0].value : null;
    }

    function inferClaudeConversationLeaf(messages) {
        const parentIds = new Set(messages.map((message) => message && message.parent_message_uuid).filter(Boolean));
        const leaves = messages.filter((message) => message && message.uuid && !parentIds.has(message.uuid));
        if (!leaves.length) return null;
        leaves.sort((left, right) => {
            const leftTime = Date.parse(left.created_at || left.updated_at || '') || 0;
            const rightTime = Date.parse(right.created_at || right.updated_at || '') || 0;
            return rightTime - leftTime;
        });
        return leaves[0];
    }

    function resolveClaudeActiveMessagePathInfo(data) {
        const payload = findClaudeConversationPayload(data);
        const messages = payload && Array.isArray(payload.chat_messages)
            ? payload.chat_messages
            : findClaudeConversationMessageArray(data);
        if (!messages.length) return { path: [], authoritative: false, reachedRoot: false };

        const byId = new Map();
        messages.forEach((message) => {
            const id = message && (message.uuid || message.id || message.message_uuid || message.messageId);
            if (id) byId.set(String(id), message);
        });
        const linkedMessages = messages.filter((message) => message && message.parent_message_uuid).length;
        if (!byId.size || !linkedMessages) {
            return { path: messages.slice(), authoritative: false, reachedRoot: false };
        }

        const leafId = payload && (
            payload.current_leaf_message_uuid || payload.current_leaf_uuid ||
            payload.current_message_uuid || payload.current_message_id
        );
        let current = leafId ? byId.get(String(leafId)) : null;
        const hasAuthoritativeLeaf = !!current;
        if (!current) current = inferClaudeConversationLeaf(messages);
        if (!current) return { path: messages.slice(), authoritative: false, reachedRoot: false };

        const path = [];
        const visited = new Set();
        let reachedRoot = false;
        while (current && path.length <= messages.length) {
            const id = current.uuid || current.id || current.message_uuid || current.messageId || '';
            if (id && visited.has(String(id))) break;
            if (id) visited.add(String(id));
            path.push(current);
            const parentId = current.parent_message_uuid || current.parent_uuid || current.parent_message_id;
            if (String(parentId || '') === '00000000-0000-4000-8000-000000000000') {
                reachedRoot = true;
                break;
            }
            if (!parentId) break;
            current = byId.get(String(parentId));
        }
        path.reverse();
        return {
            path: path.length ? path : messages.slice(),
            authoritative: hasAuthoritativeLeaf && reachedRoot,
            reachedRoot
        };
    }

    function resolveClaudeActiveMessagePath(data) {
        return resolveClaudeActiveMessagePathInfo(data).path;
    }

    function claudePathEntryRenders(entry) {
        return !(entry && entry.role === 'assistant' && !entry.stopReason);
    }

    function extractClaudeConversationIndex(data) {
        const resolved = resolveClaudeActiveMessagePathInfo(data);
        const messages = resolved.path;
        const fullPath = [];
        const renderablePathIndexes = [];
        const userMessages = [];

        messages.forEach((message, messageIndex) => {
            const role = getClaudeMessageRole(message);
            const normalizedRole = role === 'human' || role === 'user'
                ? 'human'
                : role === 'assistant' || role === 'claude' ? 'assistant' : role;
            const text = getClaudeConversationMessageText(message);
            const messageId = message.uuid || message.id || message.message_uuid || message.messageId || '';
            const pathEntry = {
                id: messageId,
                role: normalizedRole,
                text,
                stopReason: message.stop_reason || message.stopReason || null,
                deleted: !!(message.deleted_at || message.is_deleted || message.hidden === true)
            };
            fullPath.push(pathEntry);
            if (!pathEntry.deleted && claudePathEntryRenders(pathEntry)) {
                renderablePathIndexes.push(messageIndex);
            }
            if (normalizedRole !== 'human' || pathEntry.deleted || !text) return;

            const identityKeys = createMessageIdentityKeys(messageId);
            userMessages.push({
                container: null,
                anchor: null,
                text,
                identityKey: identityKeys[0] || '',
                identityKeys,
                remoteIndex: userMessages.length,
                source: 'claude-conversation',
                observedIndex: messageIndex,
                pathIndex: messageIndex,
                virtualRowIndex: Math.max(0, renderablePathIndexes.length - 1)
            });
        });
        return {
            userMessages,
            fullPath,
            renderablePathIndexes,
            authoritative: resolved.authoritative,
            reachedRoot: resolved.reachedRoot
        };
    }

    function applyClaudeConversationData(data, source, contextOverride) {
        const context = contextOverride || getClaudeMessageContext();
        const currentContext = getClaudeMessageContext();
        const index = extractClaudeConversationIndex(data);
        const messages = index.userMessages;
        if (!messages.length) {
            if (context === currentContext && !STATE.claudeRemoteMessages.length) {
                STATE.claudeRemoteStatus = `${source}:empty`;
            }
            recordClaudeDebugEvent('response-empty', { source, responseContext: context });
            return false;
        }
        if (!index.authoritative) {
            if (context === currentContext && !STATE.claudeRemoteMessages.length) {
                STATE.claudeRemoteStatus = `${source}:partial-path`;
            }
            recordClaudeDebugEvent('response-partial', {
                source,
                responseContext: context,
                messages: messages.length,
                reachedRoot: index.reachedRoot
            });
            return false;
        }

        storeClaudeConversationCache(context, index, source);
        if (context !== currentContext) {
            recordClaudeDebugEvent('response-cached', {
                source,
                responseContext: context,
                currentContext,
                messages: messages.length
            });
            return true;
        }
        STATE.claudeRemoteMessages = messages;
        STATE.claudeRemotePath = index.fullPath;
        STATE.claudeRenderablePathIndexes = index.renderablePathIndexes;
        STATE.claudeRemoteContext = context;
        STATE.claudeRemoteSource = source;
        STATE.claudeRemoteStatus = `${source}:ok:${messages.length}`;
        STATE.claudeRemoteUpdatedAt = Date.now();
        recordClaudeDebugEvent('response-applied', {
            source,
            messages: messages.length,
            pathMessages: index.fullPath.length,
            renderableRows: index.renderablePathIndexes.length
        });
        scheduleScan(0);
        return true;
    }

    function isClaudeConversationResponseUrl(url) {
        if (!url) return false;
        const value = String(url);
        if (/\/(?:completion|retry|feedback)(?:\/|\?|$)/i.test(value)) return false;
        if (/\/api\/(?:organizations\/[^/]+\/)?chat_conversations\/[a-f0-9-]{20,}(?:\/[^?#]*)?(?:[?#]|$)/i.test(value)) {
            return true;
        }
        return /\/api\/[^?#]*(?:chat_messages|messages|conversations)[^?#]*(?:\?|$)/i.test(value)
            && !!getClaudeConversationIdFromText(value);
    }

    function recordClaudeObservedUrl(url) {
        if (!url || !window.location.hostname.includes('claude.ai')) return;

        let parsed;
        try {
            parsed = new URL(String(url), window.location.href);
        } catch (error) {
            return;
        }
        if (parsed.origin !== window.location.origin || !parsed.pathname.startsWith('/api/')) return;

        const currentConversationId = getClaudeConversationId();
        const value = `${parsed.pathname}${parsed.search}`;
        const isConversationResource = /chat_conversations|conversation|chat_messages|messages/i.test(value);
        if (!isConversationResource && (!currentConversationId || !value.includes(currentConversationId))) return;

        const absoluteUrl = parsed.href;
        const existingIndex = STATE.claudeObservedUrls.indexOf(absoluteUrl);
        if (existingIndex >= 0) STATE.claudeObservedUrls.splice(existingIndex, 1);
        STATE.claudeObservedUrls.push(absoluteUrl);
        if (STATE.claudeObservedUrls.length > 30) STATE.claudeObservedUrls.splice(0, STATE.claudeObservedUrls.length - 30);
        if (/chat_conversations/i.test(value)) STATE.claudeLastConversationUrl = absoluteUrl;
    }

    function findClaudeObservedConversationUrl() {
        const performanceApi = window.performance;
        if (performanceApi && typeof performanceApi.getEntriesByType === 'function') {
            performanceApi.getEntriesByType('resource').forEach((entry) => {
                recordClaudeObservedUrl(entry && entry.name);
            });
        }

        const conversationId = getClaudeConversationId();
        if (!conversationId) return '';
        for (let i = STATE.claudeObservedUrls.length - 1; i >= 0; i--) {
            const url = STATE.claudeObservedUrls[i];
            if (getClaudeConversationIdFromText(url) === conversationId && isClaudeConversationResponseUrl(url)) {
                return url;
            }
        }

        const templates = [STATE.claudeLastConversationUrl].concat(STATE.claudeObservedUrls.slice().reverse());
        for (let i = 0; i < templates.length; i++) {
            if (!templates[i] || !/\/chat_conversations\//i.test(templates[i])) continue;
            try {
                const parsed = new URL(templates[i], window.location.href);
                parsed.pathname = parsed.pathname.replace(
                    /(\/chat_conversations\/)[a-f0-9-]{20,}/i,
                    `$1${conversationId}`
                );
                if (getClaudeConversationIdFromText(parsed.href) === conversationId) {
                    recordClaudeDebugEvent('conversation-url-derived', {
                        conversationId,
                        url: parsed.href
                    });
                    return parsed.href;
                }
            } catch (error) {
                // Continue to the next known conversation URL template.
            }
        }
        return '';
    }

    function getClaudeCanonicalConversationUrl(url, conversationId) {
        if (!url || !conversationId) return '';
        try {
            const parsed = new URL(url, window.location.href);
            const escapedConversationId = conversationId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const match = parsed.pathname.match(new RegExp(
                `^(.*\\/chat_conversations\\/${escapedConversationId})(?:\\/.*)?$`,
                'i'
            ));
            if (!match) return '';
            parsed.pathname = match[1];
            parsed.hash = '';
            parsed.search = '';
            parsed.searchParams.set('tree', 'true');
            parsed.searchParams.set('rendering_mode', 'messages');
            parsed.searchParams.set('render_all_tools', 'true');
            parsed.searchParams.set('consistency', 'strong');
            return parsed.href;
        } catch (error) {
            return '';
        }
    }

    function getClaudeOriginalFetch() {
        const pageWindow = getPageWindow();
        const pageFetch = pageWindow && pageWindow.fetch;
        if (typeof pageFetch !== 'function') return null;
        return pageFetch.__aiTocClaudeOriginalFetch || pageFetch;
    }

    function getClaudeOrganizationIdFromText(value) {
        const match = String(value || '').match(/\/api\/organizations\/([a-f0-9-]{20,})/i);
        return match && match[1] ? match[1] : '';
    }

    function collectClaudeOrganizationCandidates() {
        const candidates = [];
        const add = (value) => {
            const normalized = String(value || '').trim();
            if (/^[a-f0-9-]{20,}$/i.test(normalized) && !candidates.includes(normalized)) {
                candidates.push(normalized);
            }
        };
        STATE.claudeOrganizationCandidates.forEach(add);
        add(getChatGptCookie('lastActiveOrg'));
        [STATE.claudeLastConversationUrl].concat(STATE.claudeObservedUrls).forEach((url) => {
            add(getClaudeOrganizationIdFromText(url));
        });
        try {
            window.performance.getEntriesByType('resource').forEach((entry) => {
                add(getClaudeOrganizationIdFromText(entry && entry.name));
            });
        } catch (error) {
            // Resource timing can be unavailable in privacy-restricted contexts.
        }
        STATE.claudeOrganizationCandidates = candidates.slice();
        return candidates;
    }

    function fetchClaudeOrganizationCandidates() {
        if (STATE.claudeOrganizationRequest) return STATE.claudeOrganizationRequest;
        const fetchFn = getClaudeOriginalFetch();
        if (!fetchFn) return Promise.resolve([]);

        STATE.claudeOrganizationStatus = 'loading';
        STATE.claudeOrganizationRequest = fetchFn.call(getPageWindow(), '/api/organizations', {
            method: 'GET',
            credentials: 'include',
            headers: { accept: 'application/json' }
        })
            .then((response) => {
                if (!response.ok) throw new Error(`http-${response.status}`);
                return response.json();
            })
            .then((organizations) => {
                if (!Array.isArray(organizations)) throw new Error('invalid-response');
                const ranked = organizations
                    .filter((organization) => organization && organization.uuid)
                    .sort((left, right) => {
                        const leftChat = Array.isArray(left.capabilities) && left.capabilities.includes('chat');
                        const rightChat = Array.isArray(right.capabilities) && right.capabilities.includes('chat');
                        return Number(rightChat) - Number(leftChat);
                    })
                    .map((organization) => String(organization.uuid));
                STATE.claudeOrganizationCandidates = Array.from(new Set(
                    collectClaudeOrganizationCandidates().concat(ranked)
                ));
                STATE.claudeOrganizationStatus = `ok:${ranked.length}`;
                return STATE.claudeOrganizationCandidates.slice();
            })
            .catch((error) => {
                STATE.claudeOrganizationStatus = error && error.message ? error.message : 'error';
                return collectClaudeOrganizationCandidates();
            })
            .finally(() => {
                STATE.claudeOrganizationRequest = null;
            });
        return STATE.claudeOrganizationRequest;
    }

    function buildClaudeConversationUrl(organizationId, conversationId) {
        if (!organizationId || !conversationId) return '';
        const path = `/api/organizations/${encodeURIComponent(organizationId)}` +
            `/chat_conversations/${encodeURIComponent(conversationId)}`;
        const url = new URL(path, window.location.origin);
        url.searchParams.set('tree', 'true');
        url.searchParams.set('rendering_mode', 'messages');
        url.searchParams.set('render_all_tools', 'true');
        url.searchParams.set('consistency', 'strong');
        return url.href;
    }

    function getClaudeConversationRequestUrls(conversationId, includeOrganizationList) {
        const urls = [];
        const add = (url) => {
            const canonical = getClaudeCanonicalConversationUrl(url, conversationId);
            if (canonical && !urls.includes(canonical)) urls.push(canonical);
        };
        add(findClaudeObservedConversationUrl());
        collectClaudeOrganizationCandidates().forEach((organizationId) => {
            add(buildClaudeConversationUrl(organizationId, conversationId));
        });
        if (!includeOrganizationList) return Promise.resolve(urls);
        return fetchClaudeOrganizationCandidates().then((organizationIds) => {
            organizationIds.forEach((organizationId) => {
                add(buildClaudeConversationUrl(organizationId, conversationId));
            });
            return urls;
        });
    }

    function scheduleClaudeHydrateRetry(context, url, reason) {
        if (context !== getClaudeMessageContext() || STATE.claudeHydrateAttempts >= 4) return;
        if (STATE.claudeHydrateRetryTimer) return;
        recordClaudeDebugEvent('hydrate-retry-scheduled', {
            reason,
            attempt: STATE.claudeHydrateAttempts,
            url
        });
        STATE.claudeHydrateRetryTimer = window.setTimeout(() => {
            STATE.claudeHydrateRetryTimer = 0;
            if (context !== getClaudeMessageContext()) return;
            STATE.claudeHydrateInFlight = false;
            hydrateClaudeConversationFromObservedResource();
        }, Math.min(1800, 400 * Math.max(1, STATE.claudeHydrateAttempts)));
    }

    function requestClaudeConversationIndex(conversationId, context, source, onRequestUrl) {
        if (!conversationId || !context) return Promise.resolve(false);
        const existing = STATE.claudeConversationRequests.get(context);
        if (existing) return existing;
        const fetchFn = getClaudeOriginalFetch();
        if (!fetchFn) return Promise.reject(new Error('fetch-unavailable'));

        const request = getClaudeConversationRequestUrls(conversationId, false)
            .then((knownUrls) => {
                const tryUrls = (urls, tried) => {
                    const remaining = urls.filter((url) => !tried.has(url));
                    const tryNext = (index) => {
                        if (index >= remaining.length) return Promise.resolve(false);
                        const url = remaining[index];
                        tried.add(url);
                        if (typeof onRequestUrl === 'function') onRequestUrl(url);
                        return fetchFn.call(getPageWindow(), url, {
                            method: 'GET',
                            credentials: 'include',
                            headers: { accept: 'application/json' }
                        }).then((response) => {
                            if (!response.ok) return tryNext(index + 1);
                            return response.json().then((data) => {
                                const applied = applyClaudeConversationData(data, source, context);
                                return applied ? true : tryNext(index + 1);
                            }, () => tryNext(index + 1));
                        }, () => tryNext(index + 1));
                    };
                    return tryNext(0);
                };

                const tried = new Set();
                return tryUrls(knownUrls, tried).then((loaded) => {
                    if (loaded) return true;
                    return getClaudeConversationRequestUrls(conversationId, true)
                        .then((allUrls) => tryUrls(allUrls, tried));
                });
            })
            .then((loaded) => {
                if (!loaded) throw new Error('no-authoritative-response');
                return true;
            })
            .finally(() => {
                STATE.claudeConversationRequests.delete(context);
            });
        STATE.claudeConversationRequests.set(context, request);
        return request;
    }

    function prefetchClaudeConversationFromLink(target) {
        if (!target || !target.closest) return;
        const link = target.closest('a[href]');
        if (!link) return;
        const conversationId = getClaudeConversationIdFromText(link.href || link.getAttribute('href'));
        if (!conversationId || conversationId === getClaudeConversationId()) return;
        const context = `claude:${conversationId}`;
        if (STATE.claudeConversationCache.has(context) || STATE.claudeConversationRequests.has(context)) return;
        const lastAttemptedAt = STATE.claudePrefetchAttemptedAt.get(context) || 0;
        if (Date.now() - lastAttemptedAt < 15000) return;
        STATE.claudePrefetchAttemptedAt.set(context, Date.now());
        while (STATE.claudePrefetchAttemptedAt.size > 30) {
            STATE.claudePrefetchAttemptedAt.delete(STATE.claudePrefetchAttemptedAt.keys().next().value);
        }

        recordClaudeDebugEvent('prefetch-start', { context });
        requestClaudeConversationIndex(conversationId, context, 'sidebar-prefetch')
            .then(() => recordClaudeDebugEvent('prefetch-complete', { context }))
            .catch((error) => {
                recordClaudeDebugEvent('prefetch-error', {
                    context,
                    error: error && error.message ? error.message : 'read-error'
                });
                if (context === getClaudeMessageContext()) scheduleScan(0);
            });
    }

    function installClaudeConversationPrefetch() {
        if (!window.location.hostname.includes('claude.ai') || STATE.claudePrefetchInstalled) return;
        STATE.claudePrefetchInstalled = true;
        document.addEventListener('pointerover', (event) => prefetchClaudeConversationFromLink(event.target), true);
        document.addEventListener('focusin', (event) => prefetchClaudeConversationFromLink(event.target), true);
        document.addEventListener('pointerdown', (event) => prefetchClaudeConversationFromLink(event.target), true);
    }

    function hydrateClaudeConversationFromObservedResource() {
        if (!window.location.hostname.includes('claude.ai')) return;
        const context = getClaudeMessageContext();
        const totalRows = getClaudeVirtualTotalRows();
        if (
            STATE.claudeRemoteContext === context &&
            STATE.claudeRemoteMessages.length &&
            (!totalRows || STATE.claudeRenderablePathIndexes.length >= totalRows) &&
            (
                Date.now() - STATE.claudeRemoteUpdatedAt < 30000 ||
                !/^memory-cache:/.test(STATE.claudeRemoteSource)
            )
        ) return;

        const conversationId = getClaudeConversationId();
        if (!conversationId) return;
        if (STATE.claudeHydrateContext !== context) {
            STATE.claudeHydrateContext = context;
            STATE.claudeHydrateAttempts = 0;
            STATE.claudeHydrateInFlight = false;
        }
        if (STATE.claudeConversationRequests.has(context) || STATE.claudeHydrateAttempts >= 4) return;
        STATE.claudeHydrateInFlight = true;
        STATE.claudeHydrateAttempts += 1;
        STATE.claudeRemoteStatus = 'direct-current-branch:loading';
        recordClaudeDebugEvent('hydrate-start', {
            attempt: STATE.claudeHydrateAttempts,
            totalRows,
            currentRemoteMessages: STATE.claudeRemoteMessages.length
        });

        requestClaudeConversationIndex(
            conversationId,
            context,
            'direct-current-branch',
            (url) => {
                if (context === getClaudeMessageContext()) STATE.claudeHydrateUrl = url;
            }
        )
            .catch((error) => {
                const isCurrentContext = context === getClaudeMessageContext();
                if (isCurrentContext) {
                    STATE.claudeRemoteStatus = `direct-current-branch:${error && error.message ? error.message : 'read-error'}`;
                }
                recordClaudeDebugEvent('hydrate-error', {
                    ignoredAsStale: !isCurrentContext,
                    error: error && error.message ? error.message : 'read-error'
                });
                scheduleClaudeHydrateRetry(
                    context,
                    STATE.claudeHydrateUrl,
                    error && error.message ? error.message : 'read-error'
                );
            })
            .finally(() => {
                if (STATE.claudeHydrateContext === context) {
                    STATE.claudeHydrateInFlight = false;
                }
            });
    }

    function installClaudeResourceObserver() {
        if (!window.location.hostname.includes('claude.ai')) return;
        if (STATE.claudeResourceObserver) return;

        const inspectResources = (entries) => {
            entries.forEach((entry) => recordClaudeObservedUrl(entry && entry.name));
            hydrateClaudeConversationFromObservedResource();
        };

        const performanceApi = window.performance;
        if (performanceApi && typeof performanceApi.getEntriesByType === 'function') {
            inspectResources(performanceApi.getEntriesByType('resource'));
        }

        const Observer = window.PerformanceObserver;
        if (typeof Observer !== 'function') return;
        try {
            STATE.claudeResourceObserver = new Observer((list) => {
                inspectResources(list.getEntries());
            });
            STATE.claudeResourceObserver.observe({ type: 'resource', buffered: true });
        } catch (error) {
            STATE.claudeResourceObserver = null;
        }
    }

    function readClaudeConversationResponse(response, requestedUrl, source) {
        const responseUrl = response && response.url ? response.url : requestedUrl;
        if (responseUrl && /chat_conversations/i.test(String(responseUrl))) {
            STATE.claudeLastConversationUrl = String(responseUrl);
        }
        if (!response || !isClaudeConversationResponseUrl(responseUrl)) return;
        const conversationId = getClaudeConversationIdFromText(responseUrl);
        const context = conversationId ? `claude:${conversationId}` : getClaudeMessageContext();
        response.clone().json()
            .then((data) => applyClaudeConversationData(data, source, context))
            .catch(() => {
                if (context === getClaudeMessageContext()) {
                    STATE.claudeRemoteStatus = `${source}:read-error`;
                }
            });
    }

    function installClaudeConversationInterceptors() {
        if (!window.location.hostname.includes('claude.ai')) return;
        if (STATE.claudeConversationInterceptorInstalled) return;
        STATE.claudeConversationInterceptorInstalled = true;

        const pageWindow = getPageWindow();
        const originalFetch = pageWindow.fetch;
        if (typeof originalFetch === 'function') {
            const interceptedClaudeFetch = function interceptedClaudeFetch() {
                const input = arguments[0];
                const requestedUrl = typeof input === 'string'
                    ? input
                    : input && input.url ? input.url : '';
                recordClaudeObservedUrl(requestedUrl);
                if (requestedUrl && /chat_conversations/i.test(String(requestedUrl))) {
                    STATE.claudeLastConversationUrl = String(requestedUrl);
                }
                const result = originalFetch.apply(this, arguments);
                Promise.resolve(result)
                    .then((response) => readClaudeConversationResponse(response, requestedUrl, 'page-fetch'))
                    .catch(() => {});
                return result;
            };
            interceptedClaudeFetch.__aiTocClaudeOriginalFetch = originalFetch.__aiTocClaudeOriginalFetch || originalFetch;
            pageWindow.fetch = interceptedClaudeFetch;
        }

        const OriginalXHR = pageWindow.XMLHttpRequest;
        if (typeof OriginalXHR === 'function' && OriginalXHR.prototype && !OriginalXHR.prototype.__aiTocClaudeConversationPatched) {
            const xhrProto = OriginalXHR.prototype;
            const originalOpen = xhrProto.open;
            const originalSend = xhrProto.send;
            xhrProto.open = function interceptedClaudeOpen(method, url) {
                this.__aiTocClaudeConversationUrl = typeof url === 'string' ? url : String(url || '');
                recordClaudeObservedUrl(this.__aiTocClaudeConversationUrl);
                return originalOpen.apply(this, arguments);
            };
            xhrProto.send = function interceptedClaudeSend() {
                if (!this.__aiTocClaudeConversationListener) {
                    this.__aiTocClaudeConversationListener = true;
                    this.addEventListener('load', () => {
                        const requestUrl = this.__aiTocClaudeConversationUrl || '';
                        if (requestUrl && /chat_conversations/i.test(requestUrl)) {
                            STATE.claudeLastConversationUrl = requestUrl;
                        }
                        if (!isClaudeConversationResponseUrl(requestUrl)) return;
                        const conversationId = getClaudeConversationIdFromText(requestUrl);
                        const context = conversationId ? `claude:${conversationId}` : getClaudeMessageContext();
                        try {
                            const data = JSON.parse(this.responseText);
                            applyClaudeConversationData(data, 'page-xhr', context);
                        } catch (error) {
                            if (context === getClaudeMessageContext()) {
                                STATE.claudeRemoteStatus = 'page-xhr:read-error';
                            }
                        }
                    });
                }
                return originalSend.apply(this, arguments);
            };
            xhrProto.__aiTocClaudeConversationPatched = true;
        }
    }

    function replaceClaudeCatalog(messages, context, source) {
        STATE.claudeCatalogMessages = snapshotChatGptCatalogMessages(messages);
        STATE.claudeCatalogContext = context;
        STATE.claudeCatalogSource = source;
    }

    function areClaudeCatalogMessagesEqual(left, right) {
        if (!left || !right) return false;
        const leftKeys = getMessageIdentityKeys(left);
        const rightKeys = getMessageIdentityKeys(right);
        if (leftKeys.length && rightKeys.length && leftKeys.some((key) => rightKeys.includes(key))) return true;
        const leftText = getComparableMessageText(left.text);
        const rightText = getComparableMessageText(right.text);
        return !!leftText && leftText === rightText;
    }

    function findClaudeMessageSequence(haystack, needle) {
        if (!needle.length || needle.length > haystack.length) return -1;
        for (let start = 0; start <= haystack.length - needle.length; start++) {
            let matches = true;
            for (let index = 0; index < needle.length; index++) {
                if (!areClaudeCatalogMessagesEqual(haystack[start + index], needle[index])) {
                    matches = false;
                    break;
                }
            }
            if (matches) return start;
        }
        return -1;
    }

    function getClaudeSequenceOverlap(left, right) {
        const maxOverlap = Math.min(left.length, right.length);
        for (let length = maxOverlap; length > 0; length--) {
            let matches = true;
            for (let index = 0; index < length; index++) {
                if (!areClaudeCatalogMessagesEqual(left[left.length - length + index], right[index])) {
                    matches = false;
                    break;
                }
            }
            if (matches) return length;
        }
        return 0;
    }

    function updateClaudeCatalogAnchors(catalog, batch, startIndex) {
        const updated = catalog.map((message, index) => snapshotChatGptCatalogMessage(message, index));
        batch.forEach((message, batchIndex) => {
            const catalogIndex = startIndex + batchIndex;
            if (catalogIndex < 0 || catalogIndex >= updated.length) return;
            const snapshot = snapshotChatGptCatalogMessage(message, catalogIndex);
            snapshot.remoteIndex = catalogIndex;
            updated[catalogIndex] = snapshot;
        });
        return updated;
    }

    function mergeClaudeDirectDomCatalog(directMessages, context) {
        if (!directMessages.length) return;
        if (STATE.claudeCatalogContext !== context || !STATE.claudeCatalogMessages.length) {
            replaceClaudeCatalog(directMessages, context, 'claude-direct-dom');
            return;
        }

        const catalog = STATE.claudeCatalogMessages;
        const batch = snapshotChatGptCatalogMessages(directMessages);
        const batchInCatalog = findClaudeMessageSequence(catalog, batch);
        if (batchInCatalog >= 0) {
            STATE.claudeCatalogMessages = updateClaudeCatalogAnchors(catalog, batch, batchInCatalog);
            STATE.claudeCatalogSource = 'claude-direct-dom-retained';
            return;
        }

        const catalogInBatch = findClaudeMessageSequence(batch, catalog);
        if (catalogInBatch >= 0) {
            replaceClaudeCatalog(batch, context, 'claude-direct-dom-expanded');
            return;
        }

        const appendOverlap = getClaudeSequenceOverlap(catalog, batch);
        if (appendOverlap > 0) {
            replaceClaudeCatalog(
                [...catalog, ...batch.slice(appendOverlap)],
                context,
                'claude-direct-dom-appended'
            );
            return;
        }

        const prependOverlap = getClaudeSequenceOverlap(batch, catalog);
        if (prependOverlap > 0) {
            replaceClaudeCatalog(
                [...batch.slice(0, batch.length - prependOverlap), ...catalog],
                context,
                'claude-direct-dom-prepended'
            );
            return;
        }

        STATE.claudeCatalogSource = 'claude-direct-dom-retained-no-overlap';
    }

    function bindLiveMessagesToClaudeCatalog(catalogMessages, liveMessages) {
        const liveByIdentity = new Map();
        const liveByText = new Map();
        const catalogTextCounts = new Map();
        const usedLiveMessages = new Set();

        catalogMessages.forEach((message) => {
            const comparable = getComparableMessageText(message.text);
            if (comparable) catalogTextCounts.set(comparable, (catalogTextCounts.get(comparable) || 0) + 1);
        });
        liveMessages.forEach((message) => {
            getMessageIdentityKeys(message).forEach((key) => {
                if (!liveByIdentity.has(key)) liveByIdentity.set(key, message);
            });
            const comparable = getComparableMessageText(message.text);
            if (comparable) {
                const group = liveByText.get(comparable) || [];
                group.push(message);
                liveByText.set(comparable, group);
            }
        });

        const rebound = catalogMessages.map((catalogMessage, index) => {
            const snapshot = snapshotChatGptCatalogMessage(catalogMessage, index);
            let liveMessage = null;
            const identityKeys = getMessageIdentityKeys(snapshot);
            for (let i = 0; i < identityKeys.length; i++) {
                const candidate = liveByIdentity.get(identityKeys[i]);
                if (candidate && !usedLiveMessages.has(candidate)) {
                    liveMessage = candidate;
                    break;
                }
            }

            if (!liveMessage) {
                const comparable = getComparableMessageText(snapshot.text);
                const candidates = comparable ? liveByText.get(comparable) || [] : [];
                if (catalogTextCounts.get(comparable) === 1 && candidates.length === 1) {
                    liveMessage = candidates[0];
                }
            }
            if (!liveMessage || usedLiveMessages.has(liveMessage)) return snapshot;
            usedLiveMessages.add(liveMessage);
            snapshot.anchor = liveMessage.anchor && liveMessage.anchor.isConnected ? liveMessage.anchor : null;
            snapshot.container = liveMessage.container && liveMessage.container.isConnected ? liveMessage.container : null;
            snapshot.identityKeys = createMessageIdentityKeys.apply(
                null,
                getMessageIdentityKeys(snapshot).concat(getMessageIdentityKeys(liveMessage))
            );
            snapshot.identityKey = snapshot.identityKeys[0] || '';
            snapshot.anchorSource = 'claude-live-anchor';
            return snapshot;
        });
        STATE.claudeCatalogMessages = snapshotChatGptCatalogMessages(rebound);
        return rebound;
    }

    const SITE_ADAPTERS = {
        chatgpt: {
            id: 'chatgpt',
            title: 'ChatGPT 索引',
            label: 'GPT',
            selector: CHATGPT_USER_SELECTOR,
            matches() {
                return window.location.hostname.includes('chatgpt.com');
            },
            beforeCollect() {
                const context = getChatGptMessageCacheContext();
                if (STATE.chatGptRouteContext !== context) {
                    resetChatGptConversationState(context, 'before-collect');
                }
                if (STATE.chatGptCatalogContext && STATE.chatGptCatalogContext !== context) {
                    STATE.chatGptCatalogMessages = [];
                    STATE.chatGptCatalogContext = '';
                    STATE.chatGptCatalogSource = '';
                    STATE.chatGptPathIndexByIdentity = new Map();
                    clearChatGptPendingRefresh();
                }
            },
            resolveMessageContainer(line) {
                return line.closest([
                    '[data-message-author-role]',
                    '[data-chatgpt-search-message-ids]',
                    '[data-turn-key]',
                    'div.self-end.bg-token-bg-tertiary'
                ].join(', ')) ||
                    resolveGroupedMessageContainer(line, this.selector);
            },
            getMessageLabel(line, container) {
                const text = extractChatGptUserQueryText(line);
                return text || extractImageLabel(container);
            },
            getScrollReferenceTargets(messages) {
                const catalogTargets = getDefaultScrollReferenceTargets(messages, this.selector);
                const liveTargets = getChatGptLiveMessageElements()
                    .filter((element) => !element.closest('#ai-toc-v2_2'));
                const genericTargets = liveTargets.length
                    ? []
                    : getChatGptGenericTextAlignmentMatches().map((match) => match.element);
                return Array.from(new Set(catalogTargets.concat(liveTargets, genericTargets)));
            },
            collectExtraMessages() {
                return [];
            },
            mergeMessages(liveMessages) {
                const context = getChatGptMessageCacheContext();
                const waitingForCurrentConversation = !!getChatGptConversationId() &&
                    !(
                        STATE.remoteMessageContext === context &&
                        STATE.remoteMessageIsAuthoritative &&
                        STATE.remoteMessages.length
                    ) &&
                    Date.now() - STATE.chatGptRouteChangedAt < 2000;
                if (waitingForCurrentConversation) {
                    STATE.lastTocSource = 'chatgpt-awaiting-current-conversation';
                    return [];
                }
                annotateMessagesWithNativeToc(liveMessages);
                if (
                    STATE.remoteMessageContext === context &&
                    STATE.remoteMessageIsAuthoritative &&
                    STATE.remoteMessages.length
                ) {
                    const mergedMessages = mergeChatGptAuthoritativeBranchWithLiveTail(
                        STATE.remoteMessages,
                        liveMessages,
                        context
                    );
                    const sourceSuffix = STATE.pendingLiveMessages ? '+live-pending' : '';
                    replaceChatGptCatalog(
                        mergedMessages,
                        context,
                        `${STATE.remoteMessageSource}-current-branch${sourceSuffix}`
                    );
                    STATE.lastTocSource = STATE.chatGptCatalogSource;
                    return bindLiveMessagesToChatGptCatalog(STATE.chatGptCatalogMessages, liveMessages);
                }

                const nativeTocMessages = collectChatGptNativeTocMessages();
                if (nativeTocMessages.length) {
                    replaceChatGptCatalog(nativeTocMessages, context, 'native-prompt-toc');
                    STATE.lastTocSource = 'native-prompt-toc';
                    return bindLiveMessagesToChatGptCatalog(STATE.chatGptCatalogMessages, liveMessages);
                }

                if (STATE.chatGptCatalogContext === context && STATE.chatGptCatalogMessages.length) {
                    STATE.lastTocSource = `${STATE.chatGptCatalogSource}+retained`;
                    if (STATE.chatGptCatalogSource === 'live-turn-cache') {
                        return mergeLiveMessagesIntoChatGptCatalog(liveMessages, context);
                    }
                    return bindLiveMessagesToChatGptCatalog(STATE.chatGptCatalogMessages, liveMessages);
                }

                STATE.lastTocSource = 'live-turn-cache';
                return mergeLiveMessagesIntoChatGptCatalog(liveMessages, context);
            }
        },
        gemini: {
            id: 'gemini',
            title: 'Gemini 索引',
            label: 'Gem',
            selector: '.query-text-line',
            matches() {
                return window.location.hostname.includes('gemini.google.com');
            },
            resolveMessageContainer(line) {
                return resolveGroupedMessageContainer(line, this.selector);
            },
            getMessageLabel(line, container) {
                const text = normalizeMessageText(line);
                return text || extractImageLabel(container);
            },
            getScrollReferenceTargets(messages) {
                return getDefaultScrollReferenceTargets(messages, this.selector);
            },
            collectExtraMessages(knownSignatures, usedContainers, isPanelMutationFn) {
                const results = [];
                const seenContainers = new Set();
                const images = Array.from(document.querySelectorAll('img'));

                images.forEach((img) => {
                    if (!img.isConnected || isPanelMutationFn(img)) return;

                    let current = img.parentElement;
                    while (current && current !== document.body && current !== document.documentElement) {
                        const signature = getContainerSignature(current);
                        if (knownSignatures.has(signature)) {
                            if (!current.querySelector(this.selector) && !usedContainers.has(current) && !seenContainers.has(current)) {
                                const text = extractImageLabel(current);
                                if (text) {
                                    results.push({
                                        container: current,
                                        anchor: img,
                                        text
                                    });
                                    seenContainers.add(current);
                                }
                            }
                            return;
                        }
                        current = current.parentElement;
                    }
                });

                return results;
            }
        },
        claude: {
            id: 'claude',
            title: 'Claude 索引',
            label: 'Cl',
            selector: CLAUDE_USER_SELECTOR,
            matches() {
                return window.location.hostname.includes('claude.ai');
            },
            beforeCollect() {
                const context = getClaudeMessageContext();
                if (STATE.claudeRouteContext !== context) {
                    resetClaudeConversationState(context, 'before-collect');
                }
                if (STATE.claudeCatalogContext && STATE.claudeCatalogContext !== context) {
                    STATE.claudeCatalogMessages = [];
                    STATE.claudeCatalogContext = '';
                    STATE.claudeCatalogSource = '';
                    STATE.claudeHydrateUrl = '';
                }
                if (STATE.claudeRemoteContext && STATE.claudeRemoteContext !== context) {
                    STATE.claudeRemoteMessages = [];
                    STATE.claudeRemotePath = [];
                    STATE.claudeRenderablePathIndexes = [];
                    STATE.claudeRemoteContext = '';
                    STATE.claudeRemoteSource = '';
                    STATE.claudeRemoteStatus = '';
                }
                hydrateClaudeConversationFromObservedResource();
            },
            resolveMessageContainer(line) {
                return resolveClaudeMessageContainer(line);
            },
            getMessageLabel(line, container) {
                if (isClaudeComposerElement(line) || isClaudeComposerElement(container)) return '';

                const textElement = getClaudeMessageTextElement(container || line);
                const text = normalizeMessageText(textElement);
                return text || extractImageLabel(container || line);
            },
            getScrollReferenceTargets(messages) {
                const directMessages = collectClaudeDirectDomMessages();
                return getDefaultScrollReferenceTargets(directMessages.length ? directMessages : messages, '[data-testid="user-message"]');
            },
            collectExtraMessages() {
                return [];
            },
            mergeMessages(liveMessages) {
                const context = getClaudeMessageContext();
                const directMessages = collectClaudeDirectDomMessages();
                if (STATE.claudeRemoteContext === context && STATE.claudeRemoteMessages.length) {
                    replaceClaudeCatalog(
                        STATE.claudeRemoteMessages,
                        context,
                        `${STATE.claudeRemoteSource || 'claude-api'}-current-branch`
                    );
                    const rebound = bindLiveMessagesToClaudeCatalog(STATE.claudeCatalogMessages, directMessages);
                    STATE.lastTocSource = STATE.claudeCatalogSource;
                    return rebound;
                }
                if (getClaudeConversationId()) {
                    STATE.lastTocSource = 'claude-awaiting-current-conversation';
                    return [];
                }
                if (directMessages.length) {
                    mergeClaudeDirectDomCatalog(directMessages, context);
                    STATE.lastTocSource = STATE.claudeCatalogSource;
                    return bindLiveMessagesToClaudeCatalog(STATE.claudeCatalogMessages, directMessages);
                }
                if (STATE.claudeCatalogContext === context && STATE.claudeCatalogMessages.length) {
                    STATE.lastTocSource = 'claude-catalog-temporarily-retained';
                    return STATE.claudeCatalogMessages;
                }
                STATE.lastTocSource = 'claude-live-dom-fallback';
                return liveMessages;
            }
        }
    };

    function selectAdapter() {
        const adapters = Object.values(SITE_ADAPTERS);
        for (let i = 0; i < adapters.length; i++) {
            if (adapters[i].matches()) return adapters[i];
        }
        return SITE_ADAPTERS.gemini;
    }

    const ADAPTER = selectAdapter();

    // Shared DOM and scroll utilities
    function createIcon(key, className) {
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '20');
        svg.setAttribute('height', '20');
        svg.setAttribute('fill', 'currentColor');
        if (className) svg.setAttribute('class', className);

        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', PATHS[key] || '');
        svg.appendChild(path);
        return svg;
    }

    function injectStyles() {
        const styleId = 'ai-toc-style-v2_3';
        if (document.getElementById(styleId)) return;

        const maxH = CONFIG.displayCount * 36;
        const css = `
            #ai-toc-v2_2 {
                position: fixed;
                top: 80px;
                right: 24px;
                width: ${CONFIG.panelWidth}px;
                background: #1e1f20;
                color: #e3e3e3;
                border-radius: 24px;
                z-index: 2147483647;
                overflow: hidden;
                box-shadow: 0 4px 8px 3px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.3);
                font-family: Roboto, sans-serif;
                display: flex;
                flex-direction: column;
                height: auto;
                max-height: 85vh;
                border: 1px solid #444746;
                opacity: 0;
                transition:
                    opacity 0.3s,
                    left 0.22s ease,
                    top 0.22s ease,
                    width 0.22s ease,
                    height 0.22s ease,
                    max-height 0.22s ease,
                    border-radius 0.22s ease,
                    transform 0.26s ease;
                contain: content;
            }
            #ai-toc-v2_2.toc-visible { opacity: 1; }
            #ai-toc-v2_2.notranslate { translate: no; }
            #ai-toc-v2_2.toc-dragging {
                transition: none !important;
                cursor: grabbing;
            }
            #ai-toc-v2_2.toc-slide-opening {
                transition: transform 0.26s ease, opacity 0.18s ease;
                transform: translateX(var(--toc-slide-x, 0));
            }
            #ai-toc-v2_2.toc-slide-opening.toc-slide-open {
                transform: translateX(0);
            }
            #ai-toc-v2_2.toc-collapsed {
                width: 48px;
                height: 48px;
                max-height: 48px;
                border-radius: 999px;
                cursor: grab;
            }
            #ai-toc-v2_2.toc-collapsed .toc-header {
                padding: 0;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            #ai-toc-v2_2.toc-collapsed .toc-title,
            #ai-toc-v2_2.toc-collapsed .toc-actions .toc-btn:not(.toc-collapse-btn),
            #ai-toc-v2_2.toc-collapsed .toc-search,
            #ai-toc-v2_2.toc-collapsed .toc-navigation-status,
            #ai-toc-v2_2.toc-collapsed #toc-list {
                display: none;
            }
            #ai-toc-v2_2.toc-collapsed .toc-row {
                align-items: center;
                justify-content: center;
                margin-bottom: 0;
                width: 100%;
                height: 100%;
            }
            .toc-header { padding: 16px 16px 8px 16px; background: #1e1f20; flex-shrink: 0; }
            .toc-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
            .toc-title { font-weight: 500; font-size: 14px; color: #e3e3e3; padding-left: 4px; }
            .toc-actions { display: flex; gap: 4px; }
            #ai-toc-v2_2.toc-collapsed .toc-actions {
                width: 100%;
                height: 100%;
                align-items: center;
                justify-content: center;
                gap: 0;
            }
            .toc-btn {
                background: transparent;
                border: none;
                color: #c4c7c5;
                cursor: pointer;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.2s;
            }
            .toc-btn svg { display: block; }
            .toc-bubble-label {
                display: block;
                font-size: 12px;
                font-weight: 600;
                line-height: 1;
                letter-spacing: 0;
            }
            .toc-btn:hover { background: rgba(255,255,255,0.1); color: #e3e3e3; }
            .toc-spin { animation: spin 1s linear infinite; }
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            .toc-search { position: relative; margin-bottom: 4px; }
            .toc-search input {
                width: 100%;
                background: #2b2c2e;
                border: 1px solid transparent;
                color: #e3e3e3;
                padding: 10px 16px 10px 40px;
                border-radius: 24px;
                box-sizing: border-box;
                outline: none;
                font-size: 13px;
            }
            .toc-search input:focus { background: #1e1f20; border-color: #a8c7fa; }
            .toc-search-icon {
                position: absolute;
                left: 12px;
                top: 50%;
                transform: translateY(-50%);
                color: #c4c7c5;
                display: flex;
            }
            .toc-clear-btn {
                position: absolute;
                right: 6px;
                top: 50%;
                transform: translateY(-50%);
                display: none;
            }
            .toc-search.has-value .toc-clear-btn {
                display: flex;
            }
            .toc-search.has-value input {
                padding-right: 40px;
            }
            #toc-list {
                list-style: none;
                padding: 0;
                margin: 0;
                flex-grow: 1;
                overflow-y: scroll;
                max-height: ${maxH}px;
                padding-bottom: 8px;
                scrollbar-gutter: stable;
                scrollbar-width: thin;
                scrollbar-color: #444746 transparent;
            }
            #toc-list::-webkit-scrollbar {
                width: 8px;
                display: block;
            }
            #toc-list::-webkit-scrollbar-track {
                background: transparent;
            }
            #toc-list::-webkit-scrollbar-thumb {
                background: #444746;
                border-radius: 4px;
                border: 2px solid #1e1f20;
            }
            .toc-item {
                padding: 8px 16px;
                margin: 0 4px;
                border-radius: 16px;
                cursor: pointer;
                font-size: 13px;
                color: #c4c7c5;
                display: flex;
                align-items: center;
                transition: background 0.1s;
            }
            .toc-item:hover { background: rgba(232,234,237,0.08); color: #e3e3e3; }
            .toc-item.toc-active { background: #2f353b; color: #e3e3e3; }
            .toc-icon { margin-right: 12px; color: #a8c7fa; display: flex; align-items: center; }
            .toc-item.toc-active .toc-icon { color: #8ab4f8; }
            .toc-icon svg { width: 10px; height: 10px; }
            .toc-text { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .toc-hidden { display: none !important; }
            .toc-status { padding: 20px; text-align: center; color: #8e918f; font-size: 12px; }
            .toc-navigation-status { display: flex; align-items: center; gap: 8px; height: 24px; margin-top: 8px; color: #bdc1c6; font-size: 12px; }
            .toc-navigation-status[hidden] { display: flex; visibility: hidden; pointer-events: none; }
            .toc-navigation-status .toc-navigation-label { flex: 1; min-width: 0; overflow-wrap: anywhere; }
            .toc-navigation-retry { background: transparent; color: #a8c7fa; border: 0; padding: 4px; cursor: pointer; font: inherit; flex-shrink: 0; }
            .toc-wait-spinner { display: inline-block; width: 10px; height: 10px; box-sizing: border-box; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: toc-wait-spin .8s linear infinite; flex-shrink: 0; }
            .toc-wait-spinner[hidden] { display: none; }
            .toc-item.toc-pending .toc-icon svg { display: none; }
            .toc-item.toc-pending .toc-icon::after { content: ''; width: 10px; height: 10px; box-sizing: border-box; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: toc-wait-spin .8s linear infinite; }
            @keyframes toc-wait-spin { to { transform: rotate(360deg); } }
            @media (prefers-reduced-motion: reduce) { .toc-wait-spinner, .toc-item.toc-pending .toc-icon::after { animation: none; } }
        `;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = css;
        document.head.appendChild(style);
    }

    function getPageScroller() {
        return document.scrollingElement || document.documentElement || document.body;
    }

    function isScrollableElement(el) {
        if (!el || el === document.body || el === document.documentElement) return false;
        if (el.scrollHeight <= el.clientHeight + 4) return false;
        const overflowY = getComputedStyle(el).overflowY;
        return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
    }

    function isWindowScrollTarget(target) {
        const pageScroller = getPageScroller();
        return !target || target === window || target === document || target === document.body ||
            target === document.documentElement || target === pageScroller;
    }

    function getScrollTop(target) {
        return isWindowScrollTarget(target) ? (window.pageYOffset || getPageScroller().scrollTop || 0) : target.scrollTop;
    }

    function getScrollHeight(target) {
        return isWindowScrollTarget(target) ? getPageScroller().scrollHeight : target.scrollHeight;
    }

    function getScrollMaxTop(target) {
        if (isWindowScrollTarget(target)) {
            return Math.max(0, getPageScroller().scrollHeight - window.innerHeight);
        }
        return Math.max(0, target.scrollHeight - target.clientHeight);
    }

    function getScrollableAncestors(element) {
        const ancestors = [];
        let current = element;

        while (current && current !== document.body && current !== document.documentElement) {
            if (isScrollableElement(current)) {
                ancestors.push(current);
            }
            current = current.parentElement;
        }

        if (getScrollMaxTop(window) > 0) {
            ancestors.push(window);
        }

        return ancestors;
    }

    function getChatGptFallbackScrollContainer() {
        if (ADAPTER.id !== 'chatgpt') return null;

        const minimumHeight = Math.max(240, window.innerHeight * 0.42);
        const minimumWidth = Math.max(320, window.innerWidth * 0.32);
        const candidates = Array.from(document.querySelectorAll('main, [role="main"], div, section'))
            .filter((element) => {
                if (!(element instanceof HTMLElement) || !element.isConnected) return false;
                if (element.closest('#ai-toc-v2_2, nav, aside')) return false;
                const rect = element.getBoundingClientRect();
                if (rect.width < minimumWidth || rect.height < minimumHeight) return false;
                if (rect.bottom <= 0 || rect.top >= window.innerHeight) return false;
                if (getScrollMaxTop(element) <= 0) return false;
                const overflowY = window.getComputedStyle(element).overflowY;
                return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay' || overflowY === 'hidden';
            })
            .map((element) => {
                const rect = element.getBoundingClientRect();
                const range = getScrollMaxTop(element);
                const viewportCoverage = Math.min(rect.width, window.innerWidth) *
                    Math.min(rect.height, window.innerHeight);
                const conversationSignals = (
                    element.querySelector('form, textarea, [contenteditable="true"]') ? 1 : 0
                ) + (
                    element.matches('main, [role="main"]') || element.querySelector('main, [role="main"]') ? 1 : 0
                );
                return {
                    element,
                    range,
                    score: viewportCoverage + Math.min(range, 200000) * 8 + conversationSignals * 100000
                };
            })
            .sort((left, right) => right.score - left.score || right.range - left.range);

        return candidates.length ? candidates[0].element : null;
    }

    function getViewportRect(target) {
        if (isWindowScrollTarget(target)) {
            return { top: 0, bottom: window.innerHeight, height: window.innerHeight };
        }
        const rect = target.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, height: rect.height };
    }

    function scrollTargetTo(target, top, behavior) {
        const nextTop = Math.max(0, Math.min(typeof top === 'number' ? top : 0, getScrollMaxTop(target)));
        if (isWindowScrollTarget(target)) {
            window.scrollTo({ top: nextTop, behavior });
            return;
        }

        if (typeof target.scrollTo === 'function') {
            target.scrollTo({ top: nextTop, behavior });
        } else {
            target.scrollTop = nextTop;
        }
    }

    function scrollTargetToInstant(target, top) {
        const nextTop = Math.max(0, Math.min(typeof top === 'number' ? top : 0, getScrollMaxTop(target)));
        if (isWindowScrollTarget(target)) {
            window.scrollTo(0, nextTop);
            const pageScroller = getPageScroller();
            if (pageScroller) pageScroller.scrollTop = nextTop;
            return;
        }

        target.scrollTop = nextTop;
    }

    function findScrollContainerForElement(element) {
        const ancestors = getScrollableAncestors(element);
        if (!ancestors.length) return window;

        if (ADAPTER.id === 'chatgpt') {
            const minimumConversationHeight = Math.min(320, Math.max(160, window.innerHeight * 0.3));
            const conversationContainer = ancestors.find((candidate) => (
                !isWindowScrollTarget(candidate) &&
                candidate.clientHeight >= minimumConversationHeight &&
                getScrollMaxTop(candidate) > 0
            ));
            if (conversationContainer) return conversationContainer;

            const nearestScrollable = ancestors.find((candidate) => !isWindowScrollTarget(candidate));
            if (nearestScrollable) return nearestScrollable;
        }

        let best = ancestors[0];
        let bestRange = getScrollMaxTop(best);

        for (let i = 1; i < ancestors.length; i++) {
            const candidate = ancestors[i];
            const range = getScrollMaxTop(candidate);
            if (range >= bestRange) {
                best = candidate;
                bestRange = range;
            }
        }

        return best;
    }

    function getScrollContainer() {
        const sampleTargets = ADAPTER.getScrollReferenceTargets(STATE.messages);
        const stats = new Map();
        sampleTargets.forEach((target) => {
            if (!target) return;
            getScrollableAncestors(target).forEach((ancestor, index) => {
                const current = stats.get(ancestor) || { count: 0, range: 0, depth: index };
                current.count += 1;
                current.range = Math.max(current.range, getScrollMaxTop(ancestor));
                current.depth = Math.min(current.depth, index);
                stats.set(ancestor, current);
            });
        });

        if (!stats.size) {
            return ADAPTER.id === 'chatgpt' ? (getChatGptFallbackScrollContainer() || window) : window;
        }

        if (ADAPTER.id === 'chatgpt') {
            const minimumConversationHeight = Math.min(320, Math.max(160, window.innerHeight * 0.3));
            const conversationCandidates = Array.from(stats.entries())
                .filter(([candidate, value]) => (
                    !isWindowScrollTarget(candidate) &&
                    candidate.clientHeight >= minimumConversationHeight &&
                    value.range > 0
                ))
                .sort((left, right) => (
                    right[1].count - left[1].count ||
                    left[1].depth - right[1].depth ||
                    right[1].range - left[1].range
                ));
            if (conversationCandidates.length) return conversationCandidates[0][0];
        }

        let best = window;
        let bestStats = { count: -1, range: -1, depth: Infinity };

        stats.forEach((value, key) => {
            if (
                value.count > bestStats.count ||
                (value.count === bestStats.count && value.range > bestStats.range) ||
                (value.count === bestStats.count && value.range === bestStats.range && value.depth < bestStats.depth)
            ) {
                best = key;
                bestStats = value;
            }
        });

        return best;
    }

    function scheduleScan(delay) {
        if (STATE.scanTimer) {
            window.clearTimeout(STATE.scanTimer);
        }
        STATE.scanTimer = window.setTimeout(() => {
            STATE.scanTimer = 0;
            scanContent();
        }, typeof delay === 'number' ? delay : TIMINGS.scanDelay);
    }

    function schedulePositionRefresh() {
        STATE.positionsDirty = true;
        if (STATE.positionTimer) return;

        STATE.positionTimer = window.setTimeout(() => {
            STATE.positionTimer = 0;
            if (STATE.messages.length) {
                refreshPositionCache();
                scheduleActiveSync();
            }
        }, TIMINGS.positionRefresh);
    }

    function refreshPositionCache() {
        const messages = STATE.messages;
        if (!messages.length) {
            STATE.positionCache = [];
            STATE.positionsDirty = false;
            return;
        }

        const container = getActiveScrollContainer();
        const viewportTop = getViewportRect(container).top;
        const scrollTop = getScrollTop(container);
        const positions = new Array(messages.length);
        let lastTop = 0;

        for (let i = 0; i < messages.length; i++) {
            const anchor = getMessageTarget(messages[i]);
            if (!anchor || !anchor.isConnected) {
                positions[i] = lastTop;
                continue;
            }

            const rect = anchor.getBoundingClientRect();
            const top = scrollTop + rect.top - viewportTop;
            positions[i] = top;
            lastTop = top;
        }

        STATE.positionCache = positions;
        STATE.positionsDirty = false;
    }

    function getActiveScrollContainer() {
        return STATE.scrollContainer || getScrollContainer();
    }

    function getLastMessageIndex() {
        return Math.max(0, STATE.messages.length - 1);
    }

    function clampMessageIndex(index) {
        return Math.min(index, getLastMessageIndex());
    }

    function clampNumber(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function readStorageValue(key) {
        try {
            return window.localStorage.getItem(key);
        } catch (error) {
            return null;
        }
    }

    function writeStorageValue(key, value) {
        try {
            window.localStorage.setItem(key, value);
        } catch (error) {
            // Storage can be blocked in privacy modes; the panel should still work.
        }
    }

    function readStoredPosition(key) {
        const raw = readStorageValue(key);
        if (!raw) return null;

        try {
            const parsed = JSON.parse(raw);
            if (typeof parsed.left !== 'number' || typeof parsed.top !== 'number') return null;
            return parsed;
        } catch (error) {
            return null;
        }
    }

    function readStoredExpandedPosition() {
        return readStoredPosition(STORAGE_KEYS.expandedPosition) || readStoredPosition(STORAGE_KEYS.panelPosition);
    }

    function readStoredBubblePosition() {
        const raw = readStorageValue(STORAGE_KEYS.bubblePosition);
        if (!raw) return null;

        try {
            const parsed = JSON.parse(raw);
            if (parsed.side !== 'left' && parsed.side !== 'right') return null;
            if (typeof parsed.top !== 'number') return null;
            return parsed;
        } catch (error) {
            return null;
        }
    }

    function getConstrainedPanelPosition(panel, left, top, size) {
        const rect = panel.getBoundingClientRect();
        const margin = CONFIG.panelMargin;
        const width = size && typeof size.width === 'number' ? size.width : (rect.width || panel.offsetWidth || CONFIG.bubbleSize);
        const height = size && typeof size.height === 'number' ? size.height : (rect.height || panel.offsetHeight || CONFIG.bubbleSize);
        const maxLeft = Math.max(margin, window.innerWidth - width - margin);
        const maxTop = Math.max(margin, window.innerHeight - height - margin);

        return {
            left: clampNumber(left, margin, maxLeft),
            top: clampNumber(top, margin, maxTop)
        };
    }

    function getPositionSide(position) {
        if (!position) return null;
        return position.left + CONFIG.panelWidth / 2 < window.innerWidth / 2 ? 'left' : 'right';
    }

    function getExpandedPositionFromBubble(panel, side) {
        const rect = panel.getBoundingClientRect();
        const left = side === 'left'
            ? CONFIG.panelMargin
            : window.innerWidth - CONFIG.panelWidth - CONFIG.panelMargin;
        return getConstrainedPanelPosition(panel, left, rect.top, { width: CONFIG.panelWidth, height: rect.height || CONFIG.bubbleSize });
    }

    function resolveExpandedPositionForBubble(panel, side, storedPosition) {
        if (storedPosition && getPositionSide(storedPosition) === side) {
            return storedPosition;
        }
        return getExpandedPositionFromBubble(panel, side);
    }

    function applyPanelPosition(panel, position) {
        const next = getConstrainedPanelPosition(panel, position.left, position.top);
        panel.style.left = `${next.left}px`;
        panel.style.top = `${next.top}px`;
        panel.style.right = 'auto';
        return next;
    }

    function getNearestBubbleSide(panel) {
        const rect = panel.getBoundingClientRect();
        return rect.left + rect.width / 2 < window.innerWidth / 2 ? 'left' : 'right';
    }

    function getConstrainedBubblePosition(panel, position) {
        const margin = CONFIG.panelMargin;
        const height = CONFIG.bubbleSize;
        return {
            side: position.side === 'left' ? 'left' : 'right',
            top: clampNumber(position.top, margin, Math.max(margin, window.innerHeight - height - margin))
        };
    }

    function applyBubblePosition(panel, position) {
        const next = getConstrainedBubblePosition(panel, position);
        const width = CONFIG.bubbleSize;
        panel.dataset.side = next.side;
        panel.style.left = next.side === 'left'
            ? `${CONFIG.panelMargin}px`
            : `${Math.max(CONFIG.panelMargin, window.innerWidth - width - CONFIG.panelMargin)}px`;
        panel.style.top = `${next.top}px`;
        panel.style.right = 'auto';
        return next;
    }

    function getBubblePositionFromCurrentPanel(panel) {
        const rect = panel.getBoundingClientRect();
        return {
            side: getNearestBubbleSide(panel),
            top: rect.top
        };
    }

    function saveExpandedPanelPosition(panel) {
        if (!panel) return;
        const rect = panel.getBoundingClientRect();
        const position = applyPanelPosition(panel, { left: rect.left, top: rect.top });
        writeStorageValue(STORAGE_KEYS.expandedPosition, JSON.stringify(position));
    }

    function saveBubblePosition(panel) {
        if (!panel) return;
        const position = applyBubblePosition(panel, {
            side: panel.dataset.side || getNearestBubbleSide(panel),
            top: panel.getBoundingClientRect().top
        });
        writeStorageValue(STORAGE_KEYS.bubblePosition, JSON.stringify(position));
    }

    function saveCurrentPanelPosition(panel) {
        if (!panel) return;
        if (panel.classList.contains('toc-collapsed')) {
            saveBubblePosition(panel);
        } else {
            saveExpandedPanelPosition(panel);
        }
    }

    function constrainPanelToViewport(panel, persist) {
        if (!panel) return;
        if (panel.classList.contains('toc-collapsed')) {
            applyBubblePosition(panel, {
                side: panel.dataset.side || getNearestBubbleSide(panel),
                top: panel.getBoundingClientRect().top
            });
            if (persist) saveBubblePosition(panel);
            return;
        }

        const rect = panel.getBoundingClientRect();
        applyPanelPosition(panel, { left: rect.left, top: rect.top });
        if (persist) saveExpandedPanelPosition(panel);
    }

    function beginSlideExpand(panel, side) {
        panel.style.setProperty('--toc-slide-x', side === 'left' ? 'calc(-100% - 16px)' : 'calc(100% + 16px)');
        panel.classList.add('toc-slide-opening');
        panel.classList.remove('toc-slide-open');
    }

    function finishSlideExpand(panel) {
        window.requestAnimationFrame(() => {
            panel.classList.add('toc-slide-open');
        });

        window.setTimeout(() => {
            panel.classList.remove('toc-slide-opening', 'toc-slide-open');
            panel.style.removeProperty('--toc-slide-x');
        }, 300);
    }

    function setPanelCollapsed(panel, collapsed, persist) {
        if (!panel) return;
        const wasCollapsed = panel.classList.contains('toc-collapsed');
        const bubblePosition = persist === false
            ? (readStoredBubblePosition() || getBubblePositionFromCurrentPanel(panel))
            : getBubblePositionFromCurrentPanel(panel);
        const openingFromBubble = wasCollapsed && !collapsed;
        const openingSide = openingFromBubble ? (panel.dataset.side || getNearestBubbleSide(panel)) : null;
        const storedExpandedPosition = collapsed ? null : readStoredExpandedPosition();
        const expandedPosition = openingFromBubble
            ? resolveExpandedPositionForBubble(panel, openingSide, storedExpandedPosition)
            : storedExpandedPosition;

        if (collapsed && !wasCollapsed) {
            saveExpandedPanelPosition(panel);
        }

        if (openingFromBubble) {
            beginSlideExpand(panel, openingSide);
        }

        panel.classList.toggle('toc-collapsed', collapsed);

        const button = panel.querySelector('.toc-collapse-btn');
        if (button) {
            button.title = collapsed ? '\u5c55\u5f00\u9762\u677f' : '\u6298\u53e0\u9762\u677f';
            button.setAttribute('aria-label', button.title);
            button.setAttribute('aria-expanded', String(!collapsed));
            if (collapsed) {
                setButtonText(button, getBubbleLabel(), 'toc-bubble-label');
            } else {
                setButtonIcon(button, 'collapse');
            }
        }

        if (persist !== false) {
            writeStorageValue(STORAGE_KEYS.collapsed, collapsed ? '1' : '0');
        }

        if (collapsed) {
            const snapBubble = () => {
                const next = applyBubblePosition(panel, bubblePosition);
                if (persist !== false) writeStorageValue(STORAGE_KEYS.bubblePosition, JSON.stringify(next));
                clearAutoCollapseTimer();
            };
            window.requestAnimationFrame(snapBubble);
            window.setTimeout(snapBubble, 240);
            return;
        }

        if (expandedPosition) {
            applyPanelPosition(panel, expandedPosition);
        } else {
            constrainPanelToViewport(panel, false);
        }
        if (openingFromBubble) {
            finishSlideExpand(panel);
        }
        scheduleAutoCollapse();
    }

    function togglePanelCollapsed() {
        const panel = getPanelElement();
        if (!panel) return;
        setPanelCollapsed(panel, !panel.classList.contains('toc-collapsed'));
    }

    function getPanelConversationContext() {
        let id = '';
        if (ADAPTER.id === 'chatgpt') id = getChatGptConversationId();
        else if (ADAPTER.id === 'claude') id = getClaudeConversationId();
        else if (ADAPTER.id === 'gemini') {
            const match = window.location.pathname.match(/^\/(?:u\/\d+\/)?app\/([^/]+)\/?$/);
            id = match ? match[1] : '';
        }
        return id ? `${ADAPTER.id}:${id}` : '';
    }

    function syncPanelForConversation(panel = getPanelElement()) {
        if (!panel) return false;
        const context = getPanelConversationContext();
        if (!context) {
            STATE.panelConversationContext = '';
            return false;
        }
        if (STATE.panelConversationContext === context) return false;
        STATE.panelConversationContext = context;
        STATE.cancelBoundaryNavigation?.();
        STATE.tocUserScrollUntil = 0;
        STATE.activeIndex = -1;
        STATE.forcedActiveIndex = -1;
        cancelClickNavigationTracking();
        setPanelCollapsed(panel, false, false);
        scheduleActiveSync();
        // Recheck after the expansion transition, when the list has its final height.
        window.setTimeout(() => {
            if (getPanelConversationContext() === context && !panel.classList.contains('toc-collapsed')) {
                scheduleActiveSync();
            }
        }, 260);
        return true;
    }

    function restorePanelState(panel) {
        if (syncPanelForConversation(panel)) return;
        const collapsed = readStorageValue(STORAGE_KEYS.collapsed) === '1';
        setPanelCollapsed(panel, collapsed, false);
        if (!collapsed) scheduleAutoCollapse();
    }

    // DOM observation and message ordering
    function getMutationElement(node) {
        if (!node) return null;
        if (node.nodeType === Node.ELEMENT_NODE) return node;
        return node.parentElement || null;
    }

    function isPanelMutation(node) {
        const element = getMutationElement(node);
        return !!(element && element.closest('#ai-toc-v2_2'));
    }

    function isRelevantMessageMutation(node) {
        const element = getMutationElement(node);
        if (!element || isPanelMutation(element)) return false;

        if (element.matches && element.matches(ADAPTER.selector)) return true;
        if (element.querySelector && element.querySelector(ADAPTER.selector)) return true;
        if (element.closest && element.closest(ADAPTER.selector)) return true;
        return false;
    }

    function isRelevantChatGptNativeTocMutation(node) {
        if (ADAPTER.id !== 'chatgpt') return false;
        const element = getMutationElement(node);
        if (!element || isPanelMutation(element)) return false;
        if (element.matches && element.matches('button[aria-label^="Prompt "]')) return true;
        return !!(element.querySelector && element.querySelector('button[aria-label^="Prompt "]'));
    }

    function mutationAffectsMessages(mutation) {
        if (isRelevantMessageMutation(mutation.target) || isRelevantChatGptNativeTocMutation(mutation.target)) return true;

        for (const node of mutation.addedNodes) {
            if (isRelevantMessageMutation(node) || isRelevantChatGptNativeTocMutation(node)) return true;
        }

        for (const node of mutation.removedNodes) {
            if (isRelevantMessageMutation(node) || isRelevantChatGptNativeTocMutation(node)) return true;
        }

        return false;
    }

    function startObserver() {
        if (STATE.observer || !document.body) return;

        STATE.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutationAffectsMessages(mutation)) {
                    scheduleScan();
                    return;
                }
            }
        });

        STATE.observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    function getContainerSignature(element) {
        if (!element || !element.tagName) return '';
        const className = typeof element.className === 'string' ? element.className.trim().replace(/\s+/g, ' ') : '';
        return `${element.tagName}|${className}`;
    }

    function compareMessageOrder(a, b) {
        const aNode = getMessageTarget(a);
        const bNode = getMessageTarget(b);
        if (!aNode || !bNode || aNode === bNode) return 0;

        const position = aNode.compareDocumentPosition(bNode);
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
    }

    function getElementScrollTop(target, container) {
        if (!target || !target.isConnected) return;
        const viewport = getViewportRect(container);
        const currentTop = getScrollTop(container);
        const rect = target.getBoundingClientRect();
        const offset = Math.min(160, viewport.height * 0.28);
        const activationBias = 24;
        return Math.max(0, Math.min(currentTop + rect.top - viewport.top - offset + activationBias, getScrollMaxTop(container)));
    }

    function getExactUserElementScrollTop(target, container) {
        if (!target || !target.isConnected) return;
        const viewport = getViewportRect(container);
        const rect = target.getBoundingClientRect();
        const offset = Math.min(120, Math.max(72, viewport.height * 0.12));
        return Math.max(0, Math.min(getScrollTop(container) + rect.top - viewport.top - offset, getScrollMaxTop(container)));
    }

    function getExactUserViewportTop(container) {
        const viewport = getViewportRect(container);
        return viewport.top + Math.min(120, Math.max(72, viewport.height * 0.12));
    }

    function isExactUserTarget(target) {
        return !!(target && target.matches && target.matches(ADAPTER.selector));
    }

    function getMessageScrollTopByIndex(index, container) {
        if (index < 0 || index >= STATE.messages.length) return;

        const message = STATE.messages[index];
        const target = getMessageTarget(message);
        if (!target || !target.isConnected) return;

        const viewport = getViewportRect(container);
        const currentTop = getScrollTop(container);
        const rect = target.getBoundingClientRect();
        const absoluteTop = currentTop + rect.top - viewport.top;
        const offset = Math.min(160, viewport.height * 0.28);

        let thresholdOffset = 28;
        if (index < STATE.messages.length - 1) {
            const nextMessage = STATE.messages[index + 1];
            const nextTarget = getMessageTarget(nextMessage);
            if (nextTarget && nextTarget.isConnected) {
                const nextRect = nextTarget.getBoundingClientRect();
                const nextAbsoluteTop = currentTop + nextRect.top - viewport.top;
                const gap = Math.max(0, nextAbsoluteTop - absoluteTop);
                thresholdOffset = Math.min(64, Math.max(28, gap * 0.25));
            }
        }

        return Math.max(0, Math.min(absoluteTop + thresholdOffset - offset, getScrollMaxTop(container)));
    }

    // Navigation and active-item state
    function resolveTargetScrollTop(target, container, index) {
        return typeof index === 'number'
            ? getMessageScrollTopByIndex(index, container)
            : getElementScrollTop(target, container);
    }

    function clearJumpSyncTimer() {
        if (STATE.jumpSyncTimer) {
            window.clearTimeout(STATE.jumpSyncTimer);
            STATE.jumpSyncTimer = 0;
        }
    }

    function clearVirtualSeekTimer() {
        if (STATE.virtualSeekTimer) {
            window.clearTimeout(STATE.virtualSeekTimer);
            STATE.virtualSeekTimer = 0;
        }
    }

    function scheduleJumpCorrection(target, remainingAttempts, index) {
        clearJumpSyncTimer();
        if (!target || !target.isConnected || remainingAttempts <= 0) return;

        STATE.jumpSyncTimer = window.setTimeout(() => {
            STATE.jumpSyncTimer = 0;
            const currentContainer = findScrollContainerForElement(target);
            if (STATE.scrollContainer !== currentContainer) bindScrollSync(currentContainer);

            const exactTop = isExactUserTarget(target)
                ? getExactUserElementScrollTop(target, currentContainer)
                : resolveTargetScrollTop(target, currentContainer, index);
            if (typeof exactTop !== 'number') return;

            const currentTop = getScrollTop(currentContainer);
            if (Math.abs(currentTop - exactTop) > 4) {
                scrollTargetTo(currentContainer, exactTop, 'auto');
            }

            if (STATE.lastNavigationDebug && typeof STATE.lastNavigationDebug === 'object') {
                const rect = target.getBoundingClientRect();
                STATE.lastNavigationDebug.targetViewportTop = Math.round(getExactUserViewportTop(currentContainer));
                STATE.lastNavigationDebug.finalRect = {
                    top: Math.round(rect.top),
                    bottom: Math.round(rect.bottom),
                    height: Math.round(rect.height)
                };
            }

            scheduleActiveSync();
            scheduleJumpCorrection(target, remainingAttempts - 1, index);
        }, TIMINGS.jumpCorrection);
    }

    function scrollMessageIntoView(message, index) {
        const target = getMessageTarget(message);
        if (!target || !target.isConnected) return;

        const container = findScrollContainerForElement(target);
        if (STATE.scrollContainer !== container) bindScrollSync(container);

        const initialTop = resolveTargetScrollTop(target, container, index);
        if (typeof initialTop !== 'number') return;

        scrollTargetTo(container, initialTop, 'auto');
        scheduleJumpCorrection(target, 4, index);
    }

    function findLiveUserElementByIdentityKeys(identityKeys) {
        if (!identityKeys || !identityKeys.length) return null;

        for (let i = 0; i < identityKeys.length; i++) {
            const messageId = getMessageIdFromIdentityKey(identityKeys[i]);
            if (!messageId) continue;

            const escapedId = escapeCssValue(messageId);
            const candidates = document.querySelectorAll([
                `[data-chatgpt-search-message-ids="${escapedId}"]`,
                `[data-chatgpt-search-message-ids~="${escapedId}"]`,
                `[data-turn-key="${escapedId}"] [data-chatgpt-search-message-ids]`,
                `[data-message-author-role="user"][data-message-id="${escapedId}"]`,
                `[data-testid^="user-message"][data-message-id="${escapedId}"]`,
                `[data-testid^="user-message"][data-message-uuid="${escapedId}"]`,
                `[data-message-id="${escapedId}"] [data-testid^="user-message"]`,
                `[data-message-uuid="${escapedId}"] [data-testid^="user-message"]`
            ].join(', '));
            for (const direct of candidates) {
                if (!direct.isConnected) continue;
                const anchor = resolveChatGptModernUserAnchor(direct);
                if (anchor) return anchor;
            }
        }

        const users = Array.from(document.querySelectorAll(ADAPTER.selector));
        for (let i = 0; i < users.length; i++) {
            const key = getMessageIdentityKeyFromElement(users[i]);
            if (identityKeys.includes(key)) return users[i];
        }

        return null;
    }

    function isExactTextAnchorForMessage(element, message) {
        if (!element || !message) return false;
        if (!element.matches || !element.matches(CHATGPT_USER_SELECTOR)) return false;
        return isComparableTextMatch(
            getComparableMessageText(message.text),
            getComparableMessageText(extractChatGptUserQueryText(element))
        );
    }

    function findLiveUserElementForMessage(message, index) {
        const identityMatch = findLiveUserElementByIdentityKeys(getMessageIdentityKeys(message));
        if (identityMatch) return { element: identityMatch, source: 'id' };

        if (ADAPTER.id === 'claude') {
            const comparable = getComparableMessageText(message.text);
            const catalogMatches = STATE.messages.filter((candidate) => (
                getComparableMessageText(candidate.text) === comparable
            ));
            const liveMatches = Array.from(document.querySelectorAll(ADAPTER.selector)).filter((element) => {
                if (isClaudeComposerElement(element)) return false;
                const container = ADAPTER.resolveMessageContainer(element);
                const textElement = getClaudeMessageTextElement(container || element);
                return getComparableMessageText(normalizeMessageText(textElement)) === comparable;
            });
            if (catalogMatches.length === 1 && liveMatches.length === 1) {
                return { element: liveMatches[0], source: 'unique-text' };
            }
            return null;
        }

        const slotMatch = findLiveUserElementInSlot(message, index);
        if (slotMatch) return slotMatch;

        return null;
    }

    function getClaudeFeedRoot() {
        return document.querySelector('[role="feed"]') ||
            document.querySelector('[data-rocksteady-sizer]') ||
            document.querySelector('[data-autoscroll-container="true"]') ||
            document;
    }

    function getClaudeVirtualRowElement(element) {
        if (!element || !element.closest) return null;
        const row = element.closest('[data-rs-index], [data-index], [aria-posinset]');
        const feed = getClaudeFeedRoot();
        return row && (feed === document || feed.contains(row)) ? row : null;
    }

    function getClaudeVirtualRowIndex(element) {
        const row = getClaudeVirtualRowElement(element) || element;
        if (!row || !row.getAttribute) return null;
        const values = [row.getAttribute('data-rs-index'), row.getAttribute('data-index')];
        for (let i = 0; i < values.length; i++) {
            const value = Number.parseInt(values[i], 10);
            if (Number.isFinite(value)) return value;
        }
        const ariaPosition = Number.parseInt(row.getAttribute('aria-posinset'), 10);
        return Number.isFinite(ariaPosition) ? ariaPosition - 1 : null;
    }

    function getClaudeMountedVirtualRows() {
        const feed = getClaudeFeedRoot();
        const candidates = Array.from(feed.querySelectorAll('[data-rs-index], [data-index], [aria-posinset]'));
        const byIndex = new Map();
        candidates.forEach((element) => {
            const row = getClaudeVirtualRowElement(element) || element;
            const rowIndex = getClaudeVirtualRowIndex(row);
            if (!Number.isFinite(rowIndex) || byIndex.has(rowIndex)) return;
            byIndex.set(rowIndex, {
                index: rowIndex,
                element: row,
                userElement: collectClaudeUserMessageElements(row)[0] || null
            });
        });
        const rows = Array.from(byIndex.values()).sort((left, right) => left.index - right.index);
        STATE.claudeVirtualRows = rows.map((row) => ({
            index: row.index,
            user: !!row.userElement,
            text: row.userElement ? normalizeMessageText(getClaudeMessageTextElement(row.userElement)).slice(0, 80) : ''
        }));
        return rows;
    }

    function getClaudeViewportVirtualRows(rows, container) {
        if (!rows.length) return [];
        const groups = [];
        let current = [rows[0]];
        for (let index = 1; index < rows.length; index++) {
            if (rows[index].index === rows[index - 1].index + 1) {
                current.push(rows[index]);
            } else {
                groups.push(current);
                current = [rows[index]];
            }
        }
        groups.push(current);
        if (groups.length === 1 || !container || !container.getBoundingClientRect) return groups[0];

        const containerRect = container.getBoundingClientRect();
        const viewportCenter = containerRect.top + container.clientHeight / 2;
        let bestGroup = groups[0];
        let bestDistance = Infinity;
        groups.forEach((group) => {
            const centers = group.map((row) => {
                const rect = row.element.getBoundingClientRect();
                return rect.top + rect.height / 2;
            });
            const center = centers.reduce((sum, value) => sum + value, 0) / centers.length;
            const distance = Math.abs(center - viewportCenter);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestGroup = group;
            }
        });
        return bestGroup;
    }

    function getClaudeVirtualTotalRows() {
        const feed = getClaudeFeedRoot();
        const candidates = Array.from(feed.querySelectorAll('[aria-setsize]'));
        let total = 0;
        candidates.forEach((element) => {
            const value = Number.parseInt(element.getAttribute('aria-setsize'), 10);
            if (Number.isFinite(value)) total = Math.max(total, value);
        });
        if (!total && STATE.claudeRenderablePathIndexes.length) {
            total = STATE.claudeRenderablePathIndexes.length;
        }
        STATE.claudeVirtualTotalRows = total;
        return total;
    }

    function getClaudeComparableText(text) {
        const visibleText = String(text || '')
            .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/```[a-zA-Z0-9_-]*\n?/g, ' ')
            .replace(/[*_`~>#]/g, '')
            .replace(/^[\s-]+/gm, ' ');
        return getComparableMessageText(visibleText);
    }

    function getClaudePathTextMatches(text) {
        const comparable = getClaudeComparableText(text);
        if (!comparable) return [];
        const matches = [];
        STATE.claudeRemotePath.forEach((entry, pathIndex) => {
            if (entry.role !== 'human') return;
            if (getClaudeComparableText(entry.text) === comparable) matches.push(pathIndex);
        });
        return matches;
    }

    function getClaudeMeasuredRowAnchors(rows) {
        const anchors = [];
        rows.forEach((row) => {
            if (!row.userElement) return;
            const text = normalizeMessageText(getClaudeMessageTextElement(row.userElement));
            const matches = getClaudePathTextMatches(text);
            if (matches.length === 1) anchors.push({ row: row.index, path: matches[0] });
        });
        return anchors.sort((left, right) => left.row - right.row);
    }

    function getClaudePredictedVirtualRow(message, rows) {
        const pathIndex = message && Number.isFinite(message.pathIndex)
            ? message.pathIndex
            : message && Number.isFinite(message.observedIndex) ? message.observedIndex : null;
        let predicted = message && Number.isFinite(message.virtualRowIndex)
            ? message.virtualRowIndex
            : null;
        if (!Number.isFinite(pathIndex)) return predicted;

        const anchors = getClaudeMeasuredRowAnchors(rows || getClaudeMountedVirtualRows());
        let lower = null;
        let upper = null;
        anchors.forEach((anchor) => {
            if (anchor.path === pathIndex) predicted = anchor.row;
            if (anchor.path < pathIndex && (!lower || anchor.path > lower.path)) lower = anchor;
            if (anchor.path > pathIndex && (!upper || anchor.path < upper.path)) upper = anchor;
        });
        if (Number.isFinite(predicted) && (!lower || !upper)) return predicted;
        if (lower && upper) {
            const lowerOffset = lower.path - lower.row;
            const upperOffset = upper.path - upper.row;
            if (lowerOffset === upperOffset) return pathIndex - lowerOffset;
        }
        return predicted;
    }

    function findClaudeDirectUserElement(message, index, targetRow) {
        const elements = collectClaudeUserMessageElements(document);
        const targetText = getClaudeComparableText(message && message.text);
        const matchesTargetText = (element) => {
            const textElement = getClaudeMessageTextElement(element);
            const candidateText = getClaudeComparableText(normalizeMessageText(textElement));
            return !!candidateText && !!targetText && candidateText === targetText;
        };

        const identityMatch = findLiveUserElementByIdentityKeys(getMessageIdentityKeys(message));
        if (identityMatch) {
            const identityContainer = resolveClaudeMessageContainer(identityMatch) || identityMatch;
            if (!isClaudeComposerElement(identityContainer) && matchesTargetText(identityContainer)) {
                return { element: identityContainer, source: 'virtual-id' };
            }
        }

        const textMatches = elements.filter(matchesTargetText);
        if (Number.isFinite(targetRow)) {
            const rowMatch = textMatches.find((element) => getClaudeVirtualRowIndex(element) === targetRow);
            if (rowMatch) return { element: rowMatch, source: 'virtual-row-text', rowIndex: targetRow };
        }
        const catalogTextMatches = STATE.messages.filter((candidate) => (
            getClaudeComparableText(candidate.text) === targetText
        ));
        if (catalogTextMatches.length === 1 && textMatches.length === 1) {
            return {
                element: textMatches[0],
                source: 'virtual-unique-text',
                rowIndex: getClaudeVirtualRowIndex(textMatches[0])
            };
        }
        return null;
    }

    function getClaudeVirtualScrollContainer() {
        const feed = getClaudeFeedRoot();
        const declared = document.querySelector('[data-autoscroll-container="true"]');
        if (isClaudeScrollableContainer(declared)) return declared;
        let current = feed && feed !== document ? feed : null;
        while (current && current !== document.body) {
            if (isClaudeScrollableContainer(current)) return current;
            current = current.parentElement;
        }
        return findClaudeScrollContainer() || getPageScroller();
    }

    function waitForClaudeVirtualSettle(previousKey, token, timeout) {
        return new Promise((resolve) => {
            const started = Date.now();
            let lastKey = previousKey;
            let stableSince = started;
            let finished = false;
            const finish = () => {
                if (finished) return;
                finished = true;
                window.clearTimeout(guard);
                resolve();
            };
            const guard = window.setTimeout(finish, timeout + 120);
            const poll = () => {
                if (finished || token !== STATE.claudeJumpToken) return finish();
                const key = getClaudeMountedVirtualRows().map((row) => row.index).join(',');
                const now = Date.now();
                if (key !== lastKey) {
                    lastKey = key;
                    stableSince = now;
                }
                if (now - stableSince >= 90 || now - started >= timeout) return finish();
                window.requestAnimationFrame(poll);
            };
            window.requestAnimationFrame(poll);
        });
    }

    async function navigateClaudeVirtualMessage(message, index) {
        const token = ++STATE.claudeJumpToken;
        let rows = getClaudeMountedVirtualRows();
        let targetRow = getClaudePredictedVirtualRow(message, rows);
        let directMatch = findClaudeDirectUserElement(message, index, targetRow);
        if (directMatch) {
            STATE.lastNavigationDebug = {
                mode: `claude-${directMatch.source}`,
                index,
                targetRow,
                attempts: 0,
                identityKeys: getMessageIdentityKeys(message),
                targetText: normalizeMessageText(directMatch.element).slice(0, 80)
            };
            return scrollClaudeUserElementIntoView(directMatch.element);
        }

        const container = getClaudeVirtualScrollContainer();
        const totalRows = getClaudeVirtualTotalRows();
        if (!container || !Number.isFinite(targetRow) || totalRows < 1) {
            STATE.lastNavigationDebug = {
                mode: 'claude-virtual-target-unavailable',
                index,
                targetRow,
                totalRows,
                remoteMessages: STATE.claudeRemoteMessages.length,
                remotePathMessages: STATE.claudeRemotePath.length,
                mountedRows: rows.map((row) => row.index),
                text: message.text.slice(0, 80)
            };
            return false;
        }

        targetRow = Math.max(0, Math.min(Math.round(targetRow), totalRows - 1));
        const entryScrollTop = container.scrollTop || 0;
        const attempts = [];
        let lowerPixel = 0;
        let upperPixel = Math.max(0, container.scrollHeight - container.clientHeight);
        let lowerRow = 0;
        let upperRow = Math.max(0, totalRows - 1);

        for (let attempt = 0; attempt < 8 && token === STATE.claudeJumpToken; attempt++) {
            rows = getClaudeMountedVirtualRows();
            targetRow = getClaudePredictedVirtualRow(message, rows);
            targetRow = Math.max(0, Math.min(Math.round(targetRow), totalRows - 1));
            directMatch = findClaudeDirectUserElement(message, index, targetRow);
            if (directMatch) {
                STATE.lastNavigationDebug = {
                    mode: `claude-${directMatch.source}`,
                    index,
                    targetRow,
                    totalRows,
                    attempts,
                    entryScrollTop: Math.round(entryScrollTop),
                    identityKeys: getMessageIdentityKeys(message),
                    targetText: normalizeMessageText(directMatch.element).slice(0, 80)
                };
                return scrollClaudeUserElementIntoView(directMatch.element);
            }

            const viewportRows = getClaudeViewportVirtualRows(rows, container);
            const mountedIndexes = viewportRows.map((row) => row.index);
            const minimum = mountedIndexes.length ? Math.min.apply(null, mountedIndexes) : null;
            const maximum = mountedIndexes.length ? Math.max.apply(null, mountedIndexes) : null;
            const currentPixel = container.scrollTop || 0;
            if (Number.isFinite(maximum) && maximum < targetRow && maximum >= lowerRow) {
                lowerRow = maximum;
                lowerPixel = currentPixel;
            }
            if (Number.isFinite(minimum) && minimum > targetRow && minimum <= upperRow) {
                upperRow = minimum;
                upperPixel = currentPixel;
            }

            const fraction = upperRow === lowerRow
                ? 0
                : (targetRow - lowerRow) / (upperRow - lowerRow);
            const maximumScroll = Math.max(0, container.scrollHeight - container.clientHeight);
            const destination = Math.max(0, Math.min(
                Math.round(lowerPixel + (upperPixel - lowerPixel) * Math.max(0, Math.min(1, fraction))),
                maximumScroll
            ));
            const beforeKey = mountedIndexes.join(',');
            attempts.push({
                attempt: attempt + 1,
                targetRow,
                mounted: mountedIndexes,
                from: Math.round(currentPixel),
                to: destination
            });
            if (typeof container.scrollTo === 'function') {
                container.scrollTo({ top: destination, behavior: 'auto' });
            } else {
                container.scrollTop = destination;
            }
            await waitForClaudeVirtualSettle(beforeKey, token, 420);
        }

        if (token !== STATE.claudeJumpToken) return false;
        STATE.lastNavigationDebug = {
            mode: 'claude-virtual-target-not-mounted',
            index,
            targetRow,
            totalRows,
            attempts,
            remoteMessages: STATE.claudeRemoteMessages.length,
            remotePathMessages: STATE.claudeRemotePath.length,
            text: message.text.slice(0, 80)
        };
        return false;
    }

    function scrollClaudeUserElementIntoView(element) {
        const target = resolveClaudeMessageContainer(element) || element;
        if (!target || !target.isConnected || typeof target.scrollIntoView !== 'function') return false;
        target.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant', __bypassLock: true });
        const container = getScrollableAncestors(target)[0] || window;
        bindScrollSync(container);
        if (STATE.lastNavigationDebug && typeof STATE.lastNavigationDebug === 'object') {
            const rect = target.getBoundingClientRect();
            STATE.lastNavigationDebug.scrollContainer = describeClaudeScrollContainer(
                isWindowScrollTarget(container) ? getPageScroller() : container
            );
            STATE.lastNavigationDebug.finalRect = {
                top: Math.round(rect.top),
                bottom: Math.round(rect.bottom),
                height: Math.round(rect.height)
            };
        }
        scheduleActiveSync();
        return true;
    }

    function scrollExactUserElementIntoView(element, index, behavior) {
        if (!element || !element.isConnected) return false;

        const container = findScrollContainerForElement(element);
        if (STATE.scrollContainer !== container) bindScrollSync(container);

        const isModernChatGptUser = ADAPTER.id === 'chatgpt' &&
            element.matches &&
            element.matches(CHATGPT_MODERN_USER_BUBBLE_SELECTOR) &&
            !!element.closest(CHATGPT_MODERN_USER_SELECTOR);
        if (isModernChatGptUser) {
            clearJumpSyncTimer();
            try {
                element.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
            } catch (error) {
                element.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'auto' });
            }
            if (STATE.lastNavigationDebug && typeof STATE.lastNavigationDebug === 'object') {
                const rect = element.getBoundingClientRect();
                STATE.lastNavigationDebug.scrollMethod = 'id-native-scroll-into-view';
                STATE.lastNavigationDebug.scrollContainer = isWindowScrollTarget(container)
                    ? 'window'
                    : describeClaudeScrollContainer(container);
                STATE.lastNavigationDebug.scrollTop = Math.round(getScrollTop(container));
                STATE.lastNavigationDebug.finalRect = {
                    top: Math.round(rect.top),
                    bottom: Math.round(rect.bottom),
                    height: Math.round(rect.height)
                };
            }
            scheduleActiveSync();
            return true;
        }

        const exactTop = getExactUserElementScrollTop(element, container);
        if (typeof exactTop !== 'number') return false;

        if (behavior === 'smooth') {
            scrollTargetTo(container, exactTop, 'smooth');
        } else {
            scrollTargetToInstant(container, exactTop);
        }
        scheduleJumpCorrection(element, 4, index);
        const rect = element.getBoundingClientRect();
        if (STATE.lastNavigationDebug && typeof STATE.lastNavigationDebug === 'object') {
            STATE.lastNavigationDebug.scrollContainer = isWindowScrollTarget(container)
                ? 'window'
                : describeClaudeScrollContainer(container);
            STATE.lastNavigationDebug.scrollTop = Math.round(getScrollTop(container));
            STATE.lastNavigationDebug.targetViewportTop = Math.round(getExactUserViewportTop(container));
            STATE.lastNavigationDebug.finalRect = {
                top: Math.round(rect.top),
                bottom: Math.round(rect.bottom),
                height: Math.round(rect.height)
            };
        }

        scheduleActiveSync();
        return true;
    }

    function pokeChatGptLazyMount(container, slot) {
        if (slot && slot.isConnected) {
            slot.getBoundingClientRect();
        }
        if (container && !isWindowScrollTarget(container)) {
            container.dispatchEvent(new Event('scroll', { bubbles: true }));
        }
        window.dispatchEvent(new Event('scroll'));
        window.dispatchEvent(new Event('resize'));
        if (slot && slot.isConnected) {
            window.requestAnimationFrame(() => {
                slot.getBoundingClientRect();
                if (container && !isWindowScrollTarget(container)) {
                    container.dispatchEvent(new Event('scroll', { bubbles: true }));
                }
            });
        }
    }

    function getMessageAbsoluteTop(message, container) {
        const target = getMessageTarget(message);
        if (!target || !target.isConnected) return;

        const viewport = getViewportRect(container);
        const rect = target.getBoundingClientRect();
        return getScrollTop(container) + rect.top - viewport.top;
    }

    function getElementAbsoluteTop(element, container) {
        if (!element || !element.isConnected) return;

        const viewport = getViewportRect(container);
        const rect = element.getBoundingClientRect();
        return getScrollTop(container) + rect.top - viewport.top;
    }

    function getMessageRemoteIndex(message, index) {
        if (message && typeof message.nativeTocIndex === 'number') return message.nativeTocIndex;
        return message && typeof message.remoteIndex === 'number' ? message.remoteIndex : index;
    }

    function getChatGptMessageSlotRoot() {
        const roots = Array.from(document.querySelectorAll('[class*="convSearchResultHighlightRoot"]'));
        return roots.sort((a, b) => b.children.length - a.children.length)[0] || null;
    }

    function hasCompleteChatGptIndexedSlotLayout(root) {
        if (!root) return false;
        const expectedUserCount = STATE.remoteMessages.length || STATE.messages.length || 0;
        if (!expectedUserCount) return false;
        return root.children.length >= 1 + expectedUserCount * 2;
    }

    function getChatGptTurnShellSortIndex(element, fallback) {
        const testId = element.getAttribute('data-testid') || '';
        const match = /^conversation-turn-(\d+)/.exec(testId);
        if (match && match[1]) {
            const parsed = Number.parseInt(match[1], 10);
            if (!Number.isNaN(parsed)) return parsed;
        }
        return fallback;
    }

    function getChatGptTurnShells() {
        const root = document.querySelector('#thread, main#main') || document;
        const selector = [
            '[data-turn-key]',
            'section[data-turn]',
            '[data-testid^="conversation-turn"]',
            '[data-turn-id-container]',
            '[data-turn-id]'
        ].join(', ');
        const shells = Array.from(root.querySelectorAll(selector))
            .filter((element) => {
                if (!(element instanceof HTMLElement)) return false;
                if (element.closest('#ai-toc-v2_2, .gh-root, .gh-main-panel')) return false;
                return true;
            })
            .filter((element, index, all) => !all.some((other) => other !== element && other.contains(element)));

        return shells
            .map((element, index) => ({ element, index: getChatGptTurnShellSortIndex(element, index) }))
            .sort((a, b) => a.index - b.index)
            .map((item) => item.element);
    }

    function getChatGptTurnShellByIdentityKeys(identityKeys) {
        if (!identityKeys || !identityKeys.length) return null;

        const root = document.querySelector('#thread, main#main') || document;
        for (let i = 0; i < identityKeys.length; i++) {
            const id = getMessageIdFromIdentityKey(identityKeys[i]);
            if (!id) continue;

            const escapedId = escapeCssValue(id);
            const shell = root.querySelector(
                `[data-turn-key="${escapedId}"], ` +
                `[data-turn-id-container="${escapedId}"], [data-turn-id="${escapedId}"]`
            );
            if (shell instanceof HTMLElement && shell.isConnected) return shell;
        }

        return null;
    }

    function getChatGptTurnShellRole(shell) {
        if (!shell) return '';
        const directTurn = shell.getAttribute('data-turn') || '';
        if (directTurn) return directTurn;
        if (shell.querySelector && shell.querySelector(CHATGPT_MODERN_USER_BUBBLE_SELECTOR)) return 'user';

        const roleElement = getChatGptSlotRoleElement(shell);
        return roleElement ? roleElement.getAttribute('data-message-author-role') || '' : '';
    }

    function getChatGptUserTurnShellElement(remoteIndex) {
        if (typeof remoteIndex !== 'number' || remoteIndex < 0) return null;

        const shells = getChatGptTurnShells();
        if (!shells.length) return null;
        const expectedUserCount = STATE.remoteMessages.length || STATE.messages.length || 0;
        if (!expectedUserCount) return null;

        const explicitUserShells = shells.filter((shell) => getChatGptTurnShellRole(shell) === 'user');
        if (explicitUserShells.length >= expectedUserCount && explicitUserShells[remoteIndex]) {
            return explicitUserShells[remoteIndex];
        }

        const alternatingUserIndex = remoteIndex * 2;
        if (shells.length >= expectedUserCount * 2 - 1 && shells[alternatingUserIndex]) {
            return shells[alternatingUserIndex];
        }

        if (expectedUserCount > 0 && shells.length >= expectedUserCount) return shells[remoteIndex] || null;
        return null;
    }

    function getChatGptUserSlotElement(remoteIndex) {
        const root = getChatGptMessageSlotRoot();
        if (hasCompleteChatGptIndexedSlotLayout(root) && typeof remoteIndex === 'number' && remoteIndex >= 0) {
            const slot = root.children[1 + remoteIndex * 2] || null;
            if (slot) return slot;
        }
        return getChatGptUserTurnShellElement(remoteIndex);
    }

    function getChatGptSlotSource(slot, remoteIndex) {
        if (!slot) return '';

        if (slot.matches && slot.matches('[data-turn-key], [data-turn-id-container], [data-turn-id]')) {
            return 'turn-id';
        }

        const root = getChatGptMessageSlotRoot();
        if (
            hasCompleteChatGptIndexedSlotLayout(root) &&
            typeof remoteIndex === 'number' &&
            root.children[1 + remoteIndex * 2] === slot
        ) {
            return 'conv-root';
        }
        return getChatGptTurnShells().includes(slot) ? 'turn-shell' : 'unknown';
    }

    function getChatGptSlotRoleElement(slot, role) {
        if (!slot || !slot.isConnected) return null;

        if (!role || role === 'user') {
            const modernContainers = slot.matches && slot.matches(CHATGPT_MODERN_USER_SELECTOR)
                ? [slot]
                : slot.querySelectorAll(CHATGPT_MODERN_USER_SELECTOR);
            for (const modernContainer of modernContainers) {
                const anchor = resolveChatGptModernUserAnchor(modernContainer);
                if (anchor) return anchor;
            }
        }

        const selector = role
            ? (role === 'user'
                ? '[data-message-author-role="user"]'
                : `[data-message-author-role="${escapeCssValue(role)}"]`)
            : `[data-message-author-role], ${CHATGPT_MODERN_USER_SELECTOR}`;
        if (slot.matches && slot.matches(selector)) return slot;
        return slot.querySelector ? slot.querySelector(selector) : null;
    }

    function getChatGptSlotDebug(slot) {
        const roleElement = getChatGptSlotRoleElement(slot);
        const rect = slot && slot.getBoundingClientRect ? slot.getBoundingClientRect() : null;
        return {
            role: roleElement ? roleElement.getAttribute('data-message-author-role') : '',
            messageId: roleElement ? roleElement.getAttribute('data-message-id') : '',
            turnId: slot && slot.getAttribute
                ? (slot.getAttribute('data-turn-key') ||
                    slot.getAttribute('data-turn-id-container') ||
                    slot.getAttribute('data-turn-id') || '')
                : '',
            text: roleElement ? normalizeMessageText(roleElement).slice(0, 80) : '',
            top: rect ? Math.round(rect.top) : null,
            height: rect ? Math.round(rect.height) : null,
            hasLastKnownHeight: !!(slot && String(slot.className || '').includes('last-known-height'))
        };
    }

    function findLiveUserElementInSlot(message, index) {
        if (!message) return null;

        const remoteIndex = getMessageRemoteIndex(message, index);
        const slot = getChatGptUserSlotElement(remoteIndex);
        if (!slot || !slot.isConnected) return null;

        const userElement = getChatGptSlotRoleElement(slot, 'user');
        if (!userElement || !userElement.isConnected) return null;

        const identityKeys = getMessageIdentityKeys(message);
        const domIdentityKey = getMessageIdentityKeyFromElement(userElement);
        if (domIdentityKey && identityKeys.includes(domIdentityKey)) {
            return {
                element: userElement,
                source: 'slot-id',
                liveIndex: null,
                domIdentityKey,
                slotText: extractChatGptUserQueryText(userElement).slice(0, 80)
            };
        }

        const remoteText = getComparableMessageText(message.text);
        const liveText = getComparableMessageText(extractChatGptUserQueryText(userElement));
        const textMatches = isComparableTextMatch(remoteText, liveText);
        if (!textMatches) return null;

        if (domIdentityKey) {
            message.identityKeys = createMessageIdentityKeys.apply(
                null,
                identityKeys.concat([domIdentityKey])
            );
        }

        return {
            element: userElement,
            source: 'slot-text-id',
            liveIndex: null,
            domIdentityKey: domIdentityKey || '',
            slotText: extractChatGptUserQueryText(userElement).slice(0, 80)
        };
    }

    function getChatGptMessageSlotSummary() {
        const root = getChatGptMessageSlotRoot();
        if (!root) {
            return getChatGptTurnShells().map((element, childIndex) => {
                const roleElement = getChatGptSlotRoleElement(element);
                const rect = element.getBoundingClientRect();
                return {
                    childIndex,
                    userIndex: getChatGptTurnShellRole(element) === 'user' ? childIndex : null,
                    source: 'turn-shell',
                    role: roleElement ? roleElement.getAttribute('data-message-author-role') : getChatGptTurnShellRole(element),
                    messageId: roleElement ? roleElement.getAttribute('data-message-id') : '',
                    text: roleElement ? normalizeMessageText(roleElement).slice(0, 80) : '',
                    hasLastKnownHeight: String(element.className || '').includes('last-known-height'),
                    top: Math.round(rect.top),
                    height: Math.round(rect.height)
                };
            });
        }

        return Array.from(root.children).map((element, childIndex) => {
            const roleElement = getChatGptSlotRoleElement(element);
            const rect = element.getBoundingClientRect();
            return {
                childIndex,
                userIndex: childIndex > 0 && (childIndex - 1) % 2 === 0 ? (childIndex - 1) / 2 : null,
                source: 'conv-root',
                role: roleElement ? roleElement.getAttribute('data-message-author-role') : '',
                messageId: roleElement ? roleElement.getAttribute('data-message-id') : '',
                text: roleElement ? normalizeMessageText(roleElement).slice(0, 80) : '',
                hasLastKnownHeight: String(element.className || '').includes('last-known-height'),
                top: Math.round(rect.top),
                height: Math.round(rect.height)
            };
        });
    }

    function scrollChatGptUserSlotIntoView(remoteIndex, index, behavior) {
        const slot = getChatGptUserSlotElement(remoteIndex);
        if (!slot || !slot.isConnected) return false;

        const container = findScrollContainerForElement(slot);
        if (STATE.scrollContainer !== container) bindScrollSync(container);

        const viewport = getViewportRect(container);
        const offset = Math.max(80, viewport.height * 0.35);
        const slotTop = getElementAbsoluteTop(slot, container);
        if (typeof slotTop !== 'number') return false;

        const nextTop = Math.max(0, Math.min(slotTop - offset, getScrollMaxTop(container)));
        scrollTargetTo(container, nextTop, behavior || 'auto');
        pokeChatGptLazyMount(container, slot);

        STATE.lastNavigationDebug = {
            mode: 'slot-seek',
            index,
            remoteIndex,
            childIndex: 1 + remoteIndex * 2,
            currentTop: Math.round(getScrollTop(container)),
            nextTop: Math.round(nextTop),
            viewportOffset: Math.round(offset),
            slotTop: Math.round(slotTop),
            slotHeight: Math.round(slot.getBoundingClientRect().height),
            slotHasLastKnownHeight: String(slot.className || '').includes('last-known-height'),
            lazyMountPoked: true
        };
        return true;
    }

    function estimateVirtualMessageScrollTop(index, container) {
        const messages = STATE.messages;
        const maxTop = getScrollMaxTop(container);
        const viewport = getViewportRect(container);
        const currentTop = getScrollTop(container);
        const connected = [];

        getCurrentTextAlignmentMatches().forEach((match) => {
            const top = getElementAbsoluteTop(match.element, container);
            if (typeof top === 'number') {
                connected.push({
                    index: match.remoteIndex,
                    top,
                    source: match.source
                });
            }
        });

        messages.forEach((message, messageIndex) => {
            const top = getMessageAbsoluteTop(message, container);
            if (typeof top === 'number') connected.push({ index: messageIndex, top, source: 'message-anchor' });
        });

        connected.sort((a, b) => {
            if (a.index !== b.index) return a.index - b.index;
            return a.top - b.top;
        });

        const deduped = [];
        connected.forEach((item) => {
            const last = deduped[deduped.length - 1];
            if (last && last.index === item.index) return;
            deduped.push(item);
        });

        if (!deduped.length) {
            const ratio = messages.length > 1 ? index / (messages.length - 1) : 0;
            return Math.max(0, Math.min(maxTop, maxTop * ratio));
        }

        const first = deduped[0];
        const last = deduped[deduped.length - 1];
        const step = Math.max(240, viewport.height * 0.85);

        if (index < first.index) return Math.max(0, currentTop - step);
        if (index > last.index) return Math.min(maxTop, currentTop + step);

        for (let i = 0; i < deduped.length - 1; i++) {
            const before = deduped[i];
            const after = deduped[i + 1];
            if (index < before.index || index > after.index) continue;

            const span = Math.max(1, after.index - before.index);
            const ratio = (index - before.index) / span;
            return Math.max(0, Math.min(maxTop, before.top + (after.top - before.top) * ratio));
        }

        const ratio = messages.length > 1 ? index / (messages.length - 1) : 0;
        return Math.max(0, Math.min(maxTop, maxTop * ratio));
    }

    function getDirectionalSeekScroll(index, container) {
        const matches = getCurrentTextAlignmentMatches();
        const maxTop = getScrollMaxTop(container);
        const currentTop = getScrollTop(container);
        const viewport = getViewportRect(container);
        const step = Math.max(320, viewport.height * 0.62);
        const visibleIndexes = matches.map((match) => match.remoteIndex);

        let direction = 1;
        let reason = 'no-visible-index';

        const lower = matches
            .filter((match) => match.remoteIndex < index)
            .sort((a, b) => b.remoteIndex - a.remoteIndex)[0] || null;
        const higher = matches
            .filter((match) => match.remoteIndex > index)
            .sort((a, b) => a.remoteIndex - b.remoteIndex)[0] || null;

        if (lower && !higher) {
            direction = 1;
            reason = 'target-after-visible';
        } else if (!lower && higher) {
            direction = -1;
            reason = 'target-before-visible';
        } else if (lower && higher) {
            const lowerDistance = index - lower.remoteIndex;
            const higherDistance = higher.remoteIndex - index;
            direction = higherDistance <= lowerDistance ? -1 : 1;
            reason = direction < 0 ? 'between-closer-to-higher' : 'between-closer-to-lower';
        }

        return {
            top: Math.max(0, Math.min(maxTop, currentTop + direction * step)),
            currentTop,
            direction,
            reason,
            visibleIndexes
        };
    }

    function findMessageIndexByIdentityKeys(identityKeys) {
        if (!identityKeys || !identityKeys.length) return -1;
        for (let i = 0; i < STATE.messages.length; i++) {
            const keys = getMessageIdentityKeys(STATE.messages[i]);
            for (let j = 0; j < keys.length; j++) {
                if (identityKeys.includes(keys[j])) return i;
            }
        }
        return -1;
    }

    function waitForMilliseconds(delay) {
        return new Promise((resolve) => window.setTimeout(resolve, delay));
    }

    function isVisibleElement(element) {
        if (!(element instanceof HTMLElement)) return false;
        if (!element.isConnected) return false;

        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;

        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function isElementInViewport(element, container) {
        if (!element || !element.getBoundingClientRect) return false;

        const rect = element.getBoundingClientRect();
        const viewport = getViewportRect(container);
        return rect.bottom > viewport.top && rect.top < viewport.bottom;
    }

    function getClosestElementToViewportCenter(elements, container) {
        const viewport = getViewportRect(container);
        const center = viewport.top + viewport.height / 2;

        return elements
            .map((element) => {
                const rect = element.getBoundingClientRect();
                return {
                    element,
                    distance: Math.abs(rect.top + rect.height / 2 - center)
                };
            })
            .sort((a, b) => a.distance - b.distance)[0]?.element || null;
    }

    function findChatGptNativeTocUserQueryCandidate(text, preferActive) {
        const container = getActiveScrollContainer();
        const users = getChatGptLiveUserElements()
            .filter((element) => isVisibleElement(element) && isElementInViewport(element, container));
        const matches = users.filter((element) => isCompatibleNativeTocText(extractChatGptUserQueryText(element), text));
        if (!matches.length) return null;
        if (preferActive || matches.length > 1) return getClosestElementToViewportCenter(matches, container);
        return matches[0];
    }

    function resolveChatGptNativeTocEntryForMessage(message, index) {
        if (!message || !window.location.hostname.includes('chatgpt.com')) return null;

        const nativeIndex = typeof message.nativeTocIndex === 'number'
            ? message.nativeTocIndex
            : getMessageRemoteIndex(message, index);
        let entry = getChatGptNativeTocEntryForIndex(nativeIndex);
        if (entry) return entry;

        const compatibleEntries = getChatGptNativeTocEntries().filter((candidate) => (
            isCompatibleNativeTocText(message.text, candidate.text)
        ));
        return compatibleEntries.length === 1 ? compatibleEntries[0] : null;
    }

    async function waitForChatGptNativeTocUserQuery(entry, message, timeout) {
        const endAt = Date.now() + timeout;
        while (Date.now() < endAt) {
            await waitForMilliseconds(80);
            const slot = getChatGptUserSlotElement(entry.index);
            const slotUser = getChatGptSlotRoleElement(slot, 'user');
            if (slotUser && isCompatibleNativeTocText(extractChatGptUserQueryText(slotUser), message.text || entry.text)) {
                return slotUser;
            }
            const activeIndex = getChatGptActiveNativeTocIndex();
            const candidate = findChatGptNativeTocUserQueryCandidate(
                message.text || entry.text,
                activeIndex === entry.index
            );
            if (candidate) return candidate;
        }
        return null;
    }

    function attachResolvedUserElementToMessage(message, element, anchorSource) {
        const domIdentityKey = getMessageIdentityKeyFromElement(element);
        if (domIdentityKey) {
            message.identityKeys = createMessageIdentityKeys.apply(
                null,
                getMessageIdentityKeys(message).concat([domIdentityKey])
            );
            message.identityKey = message.identityKeys[0] || message.identityKey;
        }
        message.anchor = element;
        message.container = ADAPTER.resolveMessageContainer(element);
        message.anchorSource = anchorSource;
        return domIdentityKey;
    }

    async function navigateWithChatGptNativeToc(message, index) {
        const entry = resolveChatGptNativeTocEntryForMessage(message, index);
        if (!entry || !entry.button) return false;

        const identityKeys = getMessageIdentityKeys(message);
        if (entry.element && entry.element.isConnected) {
            const domIdentityKey = attachResolvedUserElementToMessage(message, entry.element, 'native-toc-mounted');
            STATE.lastNavigationDebug = {
                mode: 'native-toc-mounted',
                index,
                remoteIndex: getMessageRemoteIndex(message, index),
                nativeTocIndex: entry.index,
                identityKeys,
                domIdentityKey,
                nativeText: entry.text,
                targetText: normalizeMessageText(entry.element).slice(0, 80)
            };
            scrollExactUserElementIntoView(entry.element, index, 'auto');
            return true;
        }

        STATE.lastNavigationDebug = {
            mode: 'native-toc-start',
            index,
            remoteIndex: getMessageRemoteIndex(message, index),
            nativeTocIndex: entry.index,
            identityKeys,
            nativeText: entry.text,
            text: message.text.slice(0, 80)
        };

        try {
            entry.button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        } catch (error) {
            // The button click still works when the horizontal prompt strip cannot scroll.
        }
        entry.button.click();

        const target = await waitForChatGptNativeTocUserQuery(entry, message, 1800);
        if (!target) {
            const activeNativeTocIndex = getChatGptActiveNativeTocIndex();
            STATE.lastNavigationDebug = {
                mode: activeNativeTocIndex === entry.index ? 'native-toc-active-only' : 'native-toc-timeout',
                index,
                remoteIndex: getMessageRemoteIndex(message, index),
                nativeTocIndex: entry.index,
                identityKeys,
                activeNativeTocIndex,
                nativeText: entry.text,
                text: message.text.slice(0, 80)
            };
            return false;
        }

        const domIdentityKey = attachResolvedUserElementToMessage(message, target, 'native-toc');
        STATE.lastNavigationDebug = {
            mode: 'native-toc-hit',
            index,
            remoteIndex: getMessageRemoteIndex(message, index),
            nativeTocIndex: entry.index,
            identityKeys,
            activeNativeTocIndex: getChatGptActiveNativeTocIndex(),
            domIdentityKey,
            nativeText: entry.text,
            targetText: normalizeMessageText(target).slice(0, 80)
        };
        scrollExactUserElementIntoView(target, index, 'auto');
        scheduleActiveSync();
        return true;
    }

    function scrollChatGptSlotForRevive(slot) {
        if (!slot || !slot.isConnected) return false;

        const container = findScrollContainerForElement(slot);
        if (STATE.scrollContainer !== container) bindScrollSync(container);

        const viewport = getViewportRect(container);
        const slotTop = getElementAbsoluteTop(slot, container);
        if (typeof slotTop === 'number') {
            scrollTargetToInstant(container, slotTop - viewport.height * 0.45);
        } else {
            try {
                slot.scrollIntoView({ block: 'center', behavior: 'instant' });
            } catch (error) {
                try {
                    slot.scrollIntoView({ block: 'center' });
                } catch (innerError) {
                    return false;
                }
            }
        }

        pokeChatGptLazyMount(container, slot);
        if (container && !isWindowScrollTarget(container)) {
            container.dispatchEvent(new Event('scroll', { bubbles: true }));
        }
        window.dispatchEvent(new Event('resize'));
        return true;
    }

    function resolveMountedChatGptRemoteTarget(message, index) {
        const identityKeys = getMessageIdentityKeys(message);
        const identityMatch = findLiveUserElementByIdentityKeys(identityKeys);
        if (identityMatch) return { element: identityMatch, source: 'remote-id' };

        const turnShell = getChatGptTurnShellByIdentityKeys(identityKeys);
        const turnUser = getChatGptSlotRoleElement(turnShell, 'user');
        if (turnUser) return { element: turnUser, source: 'remote-turn-id' };

        const slotMatch = findLiveUserElementInSlot(message, index);
        if (slotMatch) return slotMatch;

        const remoteIndex = getMessageRemoteIndex(message, index);
        const alignedMatch = getCurrentTextAlignmentMatches().find((match) => match.remoteIndex === remoteIndex);
        if (alignedMatch && alignedMatch.source === 'message-id') {
            return { element: alignedMatch.element, source: 'remote-aligned-id' };
        }

        if (alignedMatch) {
            const comparable = getChatGptRenderedComparableText(message.text);
            const duplicateCount = STATE.remoteMessages.filter((candidate) => (
                getChatGptRenderedComparableText(candidate.text) === comparable
            )).length;
            if (duplicateCount === 1) {
                return { element: alignedMatch.element, source: 'remote-unique-text' };
            }
        }

        return null;
    }

    async function seekMountedChatGptRemoteTarget(message, index) {
        const remoteIndex = getMessageRemoteIndex(message, index);
        const total = STATE.remoteMessages.length || STATE.messages.length;
        if (remoteIndex < 0 || !total) return null;

        let matches = getCurrentTextAlignmentMatches();
        const sampleElement = matches.length ? matches[0].element : null;
        let container = sampleElement
            ? findScrollContainerForElement(sampleElement)
            : (getChatGptFallbackScrollContainer() || getActiveScrollContainer());
        if (getScrollMaxTop(container) <= 0) {
            const fallbackContainer = getChatGptFallbackScrollContainer();
            if (fallbackContainer) container = fallbackContainer;
        }
        if (STATE.scrollContainer !== container) bindScrollSync(container);

        const viewport = getViewportRect(container);
        let lower = { index: -1, top: 0 };
        let upper = { index: total, top: getScrollMaxTop(container) + viewport.height };
        let previousTop = -1;

        for (let attempt = 0; attempt < 36; attempt++) {
            const mounted = resolveMountedChatGptRemoteTarget(message, index);
            if (mounted) return mounted;

            matches = getCurrentTextAlignmentMatches();
            const turnMatches = getCurrentChatGptTurnAlignmentMatches();
            const positionalMatches = matches.concat(turnMatches);
            let targetTurnTop = null;
            positionalMatches.forEach((match) => {
                const top = getElementAbsoluteTop(match.element, container);
                if (typeof top !== 'number') return;
                if (match.remoteIndex === remoteIndex) {
                    targetTurnTop = typeof targetTurnTop === 'number' ? Math.min(targetTurnTop, top) : top;
                }
                if (match.remoteIndex < remoteIndex && match.remoteIndex > lower.index) {
                    lower = { index: match.remoteIndex, top };
                }
                if (match.remoteIndex > remoteIndex && match.remoteIndex < upper.index) {
                    upper = { index: match.remoteIndex, top };
                }
            });

            const indexSpan = Math.max(1, upper.index - lower.index);
            const ratio = clampNumber((remoteIndex - lower.index) / indexSpan, 0, 1);
            const targetAbsoluteTop = lower.top + (upper.top - lower.top) * ratio;
            const offset = Math.min(120, Math.max(72, viewport.height * 0.12));
            const maxTop = getScrollMaxTop(container);
            const visibleRemoteIndexes = Array.from(new Set(positionalMatches.map((match) => match.remoteIndex)))
                .sort((left, right) => left - right);
            const minimumVisibleIndex = visibleRemoteIndexes.length ? visibleRemoteIndexes[0] : null;
            const maximumVisibleIndex = visibleRemoteIndexes.length
                ? visibleRemoteIndexes[visibleRemoteIndexes.length - 1]
                : null;
            let seekStrategy = 'estimated-position';
            let nextTop;
            if (typeof targetTurnTop === 'number') {
                seekStrategy = 'target-turn';
                nextTop = targetTurnTop - viewport.height * 0.7;
            } else if (maximumVisibleIndex !== null && maximumVisibleIndex < remoteIndex) {
                seekStrategy = 'load-next-segment';
                nextTop = maxTop;
            } else if (minimumVisibleIndex !== null && minimumVisibleIndex > remoteIndex) {
                seekStrategy = 'load-previous-segment';
                nextTop = 0;
            } else {
                nextTop = targetAbsoluteTop - offset;
            }
            nextTop = clampNumber(nextTop, 0, maxTop);
            const currentTop = getScrollTop(container);

            if (Math.abs(nextTop - currentTop) < 24 && seekStrategy === 'estimated-position') {
                const direction = positionalMatches.length &&
                    positionalMatches.every((match) => match.remoteIndex > remoteIndex) ? -1 : 1;
                nextTop = clampNumber(
                    currentTop + direction * Math.max(240, viewport.height * 0.55),
                    0,
                    maxTop
                );
            }
            if (nextTop === previousTop && nextTop !== 0 && nextTop !== maxTop) {
                nextTop = clampNumber(nextTop + (remoteIndex > lower.index ? 96 : -96), 0, maxTop);
            }

            STATE.lastNavigationDebug = {
                mode: 'remote-id-index-seek',
                index,
                remoteIndex,
                attempt: attempt + 1,
                identityKeys: getMessageIdentityKeys(message),
                currentTop: Math.round(currentTop),
                nextTop: Math.round(nextTop),
                lowerIndex: lower.index,
                lowerTop: Math.round(lower.top),
                upperIndex: upper.index,
                upperTop: Math.round(upper.top),
                visibleRemoteIndexes,
                seekStrategy,
                targetTurnTop: typeof targetTurnTop === 'number' ? Math.round(targetTurnTop) : null,
                scrollMaxTop: Math.round(maxTop),
                scrollContainer: isWindowScrollTarget(container)
                    ? 'window'
                    : describeClaudeScrollContainer(container),
                targetText: message.text.slice(0, 80)
            };

            previousTop = nextTop;
            scrollTargetToInstant(container, nextTop);
            pokeChatGptLazyMount(container, null);
            await waitForMilliseconds(220);
        }

        return null;
    }

    async function waitForMountedChatGptRemoteTarget(message, index, timeout) {
        const endAt = Date.now() + timeout;
        while (Date.now() < endAt) {
            await waitForMilliseconds(60);
            scanContent();
            const nextIndex = findMessageIndexByIdentityKeys(getMessageIdentityKeys(message));
            const nextMessage = nextIndex >= 0 ? STATE.messages[nextIndex] : message;
            const target = resolveMountedChatGptRemoteTarget(nextMessage, nextIndex >= 0 ? nextIndex : index);
            if (target) {
                return {
                    match: target,
                    message: nextMessage,
                    index: nextIndex >= 0 ? nextIndex : index
                };
            }
        }
        return null;
    }

    function getCommittedChatGptNavigationFiber(fiber) {
        let root = fiber;
        while (root && root.return) root = root.return;
        const currentRoot = root?.stateNode?.current;
        if (!currentRoot) return null;
        // DOM fiber pointers can refer to the previous tree after a React commit.
        const stack = [currentRoot];
        const seen = new Set();
        for (let visited = 0; stack.length && visited < 20000; visited++) {
            const candidate = stack.pop();
            if (!candidate || seen.has(candidate)) continue;
            seen.add(candidate);
            if (candidate === fiber || candidate === fiber.alternate) return candidate;
            if (candidate.sibling) stack.push(candidate.sibling);
            if (candidate.child) stack.push(candidate.child);
        }
        return null;
    }

    function getChatGptMessageNavigationApi() {
        const pageDocument = getPageWindow().document;
        const roots = pageDocument.querySelectorAll('[data-thread-user-message-navigation-content]');
        for (const root of roots) {
            if (root.closest('[inert], [aria-hidden="true"]')) continue;
            const key = Object.keys(root).find((name) => name.startsWith('__reactFiber$'));
            let fiber = key ? root[key] : null;
            for (let depth = 0; fiber && depth < 30; depth++, fiber = fiber.return) {
                let props = fiber.memoizedProps;
                if (typeof props?.ref?.current?.scrollToMessage !== 'function') continue;
                const committed = getCommittedChatGptNavigationFiber(fiber);
                if (!committed) continue;
                props = committed.memoizedProps;
                const api = props && props.ref && props.ref.current;
                if (!api || typeof api.scrollToMessage !== 'function') continue;
                if (props.conversationId && props.conversationId !== getChatGptConversationId()) continue;
                return { api, fiber: committed, entries: props.entries, alternateEntries: committed.alternate?.memoizedProps?.entries };
            }
        }
        return null;
    }

    function describeChatGptNavigationEntries(entries, messageId) {
        if (!Array.isArray(entries)) return { count: null, schemaConfirmed: false, targetPaths: [] };
        const targetPaths = [];
        let indexedEntries = 0;
        let messageIdCount = 0;
        // Inspect exactly the identity array used by the observed scrollToMessage implementation.
        entries.forEach((entry, entryIndex) => {
            const ids = entry && entry.turn && entry.turn.messageIds;
            if (!Array.isArray(ids)) return;
            indexedEntries++;
            messageIdCount += ids.length;
            ids.forEach((id, idIndex) => {
                if (id === messageId) targetPaths.push(`entries.${entryIndex}.turn.messageIds.${idIndex}`);
            });
        });
        return {
            count: entries.length,
            schemaConfirmed: indexedEntries === entries.length,
            indexedEntries,
            messageIdCount,
            targetPaths
        };
    }

    function findChatGptHistorySearchSource(navigation) {
        const expectedContext = `chatgpt:${getChatGptConversationId()}`;
        const stack = [navigation.fiber].filter(Boolean);
        const seen = new Set();
        for (let visited = 0; stack.length && visited < 8000; visited++) {
            const fiber = stack.pop();
            if (!fiber || seen.has(fiber)) continue;
            seen.add(fiber);
            const source = fiber.memoizedProps?.conversationSource;
            if (source?.contextId === expectedContext && typeof source.search === 'function') return source;
            // Stay within this conversation's subtree, including search registration components.
            if (fiber !== navigation.fiber && fiber.sibling) {
                stack.push(fiber.sibling);
            }
            if (fiber.child) stack.push(fiber.child);
        }
        return null;
    }

    function chatGptNavigationHasMessage(navigation, identityKeys) {
        const ids = new Set(identityKeys.map(getMessageIdFromIdentityKey));
        return Array.isArray(navigation.entries) && navigation.entries.some((entry) => (
            Array.isArray(entry?.turn?.messageIds) && entry.turn.messageIds.some((id) => ids.has(id))
        ));
    }

    function syncChatGptNavigationFeedback() {
        if (ADAPTER.id !== 'chatgpt') return;
        const panel = getPanelElement();
        if (!panel) return;
        const status = STATE.chatGptNavigationStatus;
        const banner = panel.querySelector('.toc-navigation-status');
        if (banner) {
            if (banner.hidden !== !status) banner.hidden = !status;
            const label = banner.querySelector('.toc-navigation-label');
            const text = status === 'error'
                ? '跳转准备失败' : '正在准备跳转…';
            if (label.textContent !== text) label.textContent = text;
            const spinner = banner.querySelector('.toc-wait-spinner');
            const retry = banner.querySelector('.toc-navigation-retry');
            if (spinner.hidden !== (status !== 'loading')) spinner.hidden = status !== 'loading';
            if (retry.hidden !== (status !== 'error')) retry.hidden = status !== 'error';
        }
        const pending = STATE.chatGptPendingClick;
        for (const item of panel.querySelectorAll('.toc-item')) {
            const message = STATE.messages[Number(item.dataset.index)];
            const keys = message ? getMessageIdentityKeys(message) : [];
            const waiting = !!pending && pending === STATE.lastTocClick &&
                pending.identityKeys.some(key => keys.includes(key));
            if (item.classList.contains('toc-pending') !== waiting) item.classList.toggle('toc-pending', waiting);
            if (waiting && item.getAttribute('aria-busy') !== 'true') item.setAttribute('aria-busy', 'true');
            else if (!waiting && item.hasAttribute('aria-busy')) item.removeAttribute('aria-busy');
        }
    }

    function setChatGptNavigationStatus(status) {
        if (STATE.chatGptNavigationStatus === status) return;
        STATE.chatGptNavigationStatus = status;
        syncChatGptNavigationFeedback();
    }

    function clearChatGptHistoryWarmup() {
        window.clearTimeout(STATE.chatGptHistoryWarmupTimer);
        STATE.chatGptHistoryWarmupTimer = 0;
        STATE.chatGptHistoryWarmupContext = '';
        STATE.chatGptHistoryWarmupDebug = null;
        STATE.chatGptHistoryLoad?.controller.abort();
        STATE.chatGptHistoryLoad = null;
        STATE.chatGptPendingClick = null;
        setChatGptNavigationStatus('');
    }

    function loadChatGptNativeHistory(source) {
        const context = getChatGptMessageCacheContext();
        const pending = STATE.chatGptHistoryLoad;
        if (pending?.context === context) return pending.promise;
        pending?.controller.abort();
        const controller = new AbortController();
        const job = { context, controller, promise: null };
        STATE.chatGptHistoryLoad = job;
        job.promise = (async () => {
            let timer;
            const cancelled = new Promise((_, reject) => {
                controller.signal.addEventListener('abort', () => reject(new Error('history-load-cancelled')), { once: true });
            });
            const watch = window.setInterval(() => {
                if (context !== getChatGptMessageCacheContext()) controller.abort();
            }, 100);
            try {
                await Promise.race([
                    Promise.resolve().then(() => {
                        controller.signal.throwIfAborted();
                        return source.search({ query: '' }, { signal: controller.signal });
                    }),
                    cancelled,
                    new Promise((_, reject) => {
                        timer = window.setTimeout(() => {
                            reject(new Error('history-load-timeout'));
                            controller.abort();
                        }, 15000);
                    })
                ]);
            } finally {
                window.clearTimeout(timer);
                window.clearInterval(watch);
                if (STATE.chatGptHistoryLoad === job) STATE.chatGptHistoryLoad = null;
            }
        })();
        return job.promise;
    }

    function scheduleChatGptHistoryWarmup(attempt = 0) {
        if (ADAPTER.id !== 'chatgpt' || !getChatGptConversationId()) return;
        const context = getChatGptMessageCacheContext();
        if (STATE.chatGptHistoryWarmupTimer || STATE.chatGptHistoryWarmupContext === context) return;
        STATE.chatGptHistoryWarmupTimer = window.setTimeout(() => {
            STATE.chatGptHistoryWarmupTimer = 0;
            if (context !== getChatGptMessageCacheContext()) return;
            const navigation = getChatGptMessageNavigationApi();
            const mountedIds = new Set((navigation?.entries || []).flatMap(entry => entry?.turn?.messageIds || []));
            const message = STATE.messages.find(message => {
                const keys = getMessageIdentityKeys(message);
                if (findLiveUserElementByIdentityKeys(keys)?.isConnected) return false;
                return keys.some(key => {
                    const id = getMessageIdFromIdentityKey(key);
                    return id && !mountedIds.has(id);
                });
            });
            // A new chat's mounted first message needs no native history preload.
            if (!message) {
                if (!STATE.chatGptHistoryLoad && !STATE.chatGptPendingClick) setChatGptNavigationStatus('');
                return;
            }
            if (!navigation || !findChatGptHistorySearchSource(navigation)) {
                if (attempt < 7) {
                    scheduleChatGptHistoryWarmup(attempt + 1);
                }
                else {
                    // Missing startup prerequisites are not a failed history request.
                    // A later render may retry once the page has installed its API.
                    STATE.chatGptHistoryWarmupDebug = { context, mode: 'history-warmup-deferred' };
                }
                return;
            }
            STATE.chatGptHistoryWarmupContext = context;
            const debug = { context, startedAt: Date.now() };
            STATE.chatGptHistoryWarmupDebug = debug;
            // Only populate the page's native history; do not invoke any scrolling API.
            void prepareChatGptMessageNavigation(navigation, getMessageIdentityKeys(message),
                () => context === getChatGptMessageCacheContext(), debug).then(result => {
                debug.durationMs = Date.now() - debug.startedAt;
                if (result) debug.mode = 'history-warmup-ready';
                if (context === getChatGptMessageCacheContext()) setChatGptNavigationStatus(result ? '' : 'error');
            });
        }, attempt ? 750 : 250);
    }

    async function prepareChatGptMessageNavigation(navigation, identityKeys, isCurrent, debug) {
        if (chatGptNavigationHasMessage(navigation, identityKeys)) return navigation;
        const source = findChatGptHistorySearchSource(navigation);
        if (!source) {
            debug.mode = 'remote-message-history-source-unavailable';
            if (isCurrent()) setChatGptNavigationStatus('error');
            return null;
        }
        debug.mode = 'remote-message-history-loading';
        setChatGptNavigationStatus('loading');
        debug.historyEntriesBefore = Array.isArray(navigation.entries) ? navigation.entries.length : null;
        const startedAt = Date.now();
        debug.historyLoadShared = !!STATE.chatGptHistoryLoad;
        try {
            // The observed search wrapper awaits ensureHistory before processing its query.
            // An empty query loads history without selecting a text-based search result.
            await loadChatGptNativeHistory(source);
            debug.historyLoadDurationMs = Date.now() - startedAt;
            const deadline = Date.now() + 2500;
            while (isCurrent() && Date.now() < deadline) {
                const refreshed = getChatGptMessageNavigationApi();
                if (refreshed) {
                    debug.historyEntriesAfter = Array.isArray(refreshed.entries) ? refreshed.entries.length : null;
                    if (chatGptNavigationHasMessage(refreshed, identityKeys)) {
                        debug.historyLoaded = true;
                        setChatGptNavigationStatus('');
                        return refreshed;
                    }
                }
                await waitForMilliseconds(60);
            }
            if (isCurrent()) debug.mode = 'remote-message-history-target-missing';
        } catch (error) {
            if (isCurrent()) {
                debug.mode = 'remote-message-history-error';
                debug.error = String(error && error.message || error);
            }
        }
        if (isCurrent()) setChatGptNavigationStatus('error');
        return null;
    }

    async function navigateWithChatGptMessageApi(navigation, message, index) {
        const click = STATE.lastTocClick;
        STATE.chatGptPendingClick = click;
        syncChatGptNavigationFeedback();
        try {
            return await performChatGptMessageNavigation(navigation, message, index);
        } finally {
            if (STATE.chatGptPendingClick === click) {
                STATE.chatGptPendingClick = null;
                syncChatGptNavigationFeedback();
            }
        }
    }

    async function performChatGptMessageNavigation(navigation, message, index) {
        const context = getChatGptMessageCacheContext();
        const click = STATE.lastTocClick;
        const isCurrent = () => context === getChatGptMessageCacheContext() && click === STATE.lastTocClick;
        const identityKeys = getMessageIdentityKeys(message);
        const debug = {
            mode: 'remote-message-api-start', index, identityKeys,
            scrollMethod: 'native-scrollToMessage',
            remoteIndex: getMessageRemoteIndex(message, index)
        };
        STATE.lastNavigationDebug = debug;
        clearJumpSyncTimer();
        clearVirtualSeekTimer();
        navigation = await prepareChatGptMessageNavigation(navigation, identityKeys, isCurrent, debug);
        if (!navigation || !isCurrent()) return true;
        const api = navigation.api;
        for (const identityKey of identityKeys) {
            if (!isCurrent()) return true;
            const id = getMessageIdFromIdentityKey(identityKey);
            if (!id) continue;
            debug.requestedMessageId = id;
            debug.nativeEntries = describeChatGptNavigationEntries(navigation.entries, id);
            debug.alternateNativeEntries = describeChatGptNavigationEntries(navigation.alternateEntries, id);
            const startedAt = Date.now();
            let timer;
            try {
                // The page resolves message ID -> turn key and owns virtual mounting.
                await Promise.race([
                    api.scrollToMessage(id),
                    new Promise((_, reject) => {
                        timer = window.setTimeout(() => reject(new Error('navigation-timeout')), 6000);
                    })
                ]);
            } catch (error) {
                if (isCurrent()) {
                    debug.mode = 'remote-message-api-error';
                    debug.error = String(error && error.message || error);
                }
                return true;
            } finally {
                window.clearTimeout(timer);
            }
            debug.apiDurationMs = Date.now() - startedAt;
            const deadline = Date.now() + 1800;
            let visibleSince = 0;
            let everMounted = false;
            debug.viewportSamples = [];
            while (isCurrent() && Date.now() < deadline) {
                const target = findLiveUserElementByIdentityKeys([identityKey]);
                if (target && target.isConnected) {
                    everMounted = true;
                    attachResolvedUserElementToMessage(message, target, 'native-message-api');
                    debug.mode = 'remote-message-api-verifying';
                    debug.matchedIdentityKey = identityKey;
                    const rect = target.getBoundingClientRect();
                    const container = findScrollContainerForElement(target);
                    const containerRect = container?.getBoundingClientRect?.();
                    const viewportTop = Math.max(0, containerRect?.top || 0);
                    const viewportBottom = Math.min(window.innerHeight, containerRect?.bottom ?? window.innerHeight);
                    const aligned = rect.height > 0 && rect.top >= viewportTop - 8 && rect.top < viewportBottom - 8;
                    debug.finalRect = { top: Math.round(rect.top), bottom: Math.round(rect.bottom) };
                    debug.viewportSamples.push({ elapsedMs: Date.now() - startedAt, ...debug.finalRect, aligned });
                    if (!aligned) visibleSince = 0;
                    else if (!visibleSince) visibleSince = Date.now();
                    if (visibleSince && Date.now() - visibleSince >= 450) {
                        debug.mode = 'remote-message-api-visible';
                        scheduleActiveSync();
                        return true;
                    }
                } else {
                    visibleSince = 0;
                }
                await waitForMilliseconds(100);
            }
            if (isCurrent()) debug.mode = everMounted ? 'remote-message-api-not-aligned' : 'remote-message-api-target-unmounted';
        }
        return true;
    }

    async function navigateWithChatGptRemoteToc(message, index) {
        const navigationApi = getChatGptMessageNavigationApi();
        if (navigationApi) return navigateWithChatGptMessageApi(navigationApi, message, index);
        const identityKeys = getMessageIdentityKeys(message);
        const remoteIndex = getMessageRemoteIndex(message, index);
        let liveMatch = resolveMountedChatGptRemoteTarget(message, index);
        if (liveMatch) {
            const domIdentityKey = attachResolvedUserElementToMessage(message, liveMatch.element, liveMatch.source || 'remote-mounted');
            STATE.lastNavigationDebug = {
                mode: `remote-${liveMatch.source || 'mounted'}-hit`,
                index,
                remoteIndex,
                identityKeys,
                domIdentityKey,
                targetText: normalizeMessageText(liveMatch.element).slice(0, 80),
                slotText: liveMatch.slotText || ''
            };
            scrollExactUserElementIntoView(liveMatch.element, index, 'auto');
            return true;
        }

        const slot = getChatGptTurnShellByIdentityKeys(identityKeys) || getChatGptUserSlotElement(remoteIndex);
        if (!slot || !slot.isConnected) {
            STATE.lastNavigationDebug = {
                mode: 'remote-slot-missing-seek-start',
                index,
                remoteIndex,
                identityKeys,
                hasConvRoot: !!getChatGptMessageSlotRoot(),
                turnShells: getChatGptTurnShells().length,
                text: message.text.slice(0, 80)
            };
            const soughtTarget = await seekMountedChatGptRemoteTarget(message, index);
            if (!soughtTarget) {
                STATE.lastNavigationDebug = Object.assign({}, STATE.lastNavigationDebug, {
                    mode: 'remote-id-index-seek-timeout'
                });
                return false;
            }
            const domIdentityKey = attachResolvedUserElementToMessage(
                message,
                soughtTarget.element,
                soughtTarget.source || 'remote-id-index-seek'
            );
            STATE.lastNavigationDebug = {
                mode: `remote-${soughtTarget.source || 'id-index-seek'}-hit`,
                index,
                remoteIndex,
                identityKeys,
                domIdentityKey,
                targetText: normalizeMessageText(soughtTarget.element).slice(0, 80)
            };
            scrollExactUserElementIntoView(soughtTarget.element, index, 'auto');
            scheduleActiveSync();
            return true;
        }

        const slotDebug = getChatGptSlotDebug(slot);
        const slotSource = getChatGptSlotSource(slot, remoteIndex);
        STATE.lastNavigationDebug = {
            mode: 'remote-slot-revive-start',
            index,
            remoteIndex,
            childIndex: 1 + remoteIndex * 2,
            slotSource,
            identityKeys,
            slotRole: slotDebug.role,
            slotMessageId: slotDebug.messageId,
            slotTurnId: slotDebug.turnId,
            slotText: slotDebug.text,
            slotHasLastKnownHeight: slotDebug.hasLastKnownHeight,
            slotHeight: slotDebug.height,
            text: message.text.slice(0, 80)
        };
        if (!scrollChatGptSlotForRevive(slot)) return false;

        let resolved = await waitForMountedChatGptRemoteTarget(message, index, 2600);
        if (!resolved) {
            const latestSlot = getChatGptTurnShellByIdentityKeys(identityKeys) || getChatGptUserSlotElement(remoteIndex);
            const latestSlotDebug = getChatGptSlotDebug(latestSlot);
            STATE.lastNavigationDebug = {
                mode: 'remote-slot-timeout',
                index,
                remoteIndex,
                childIndex: 1 + remoteIndex * 2,
                slotSource: getChatGptSlotSource(latestSlot, remoteIndex),
                identityKeys,
                slotRole: latestSlotDebug.role,
                slotMessageId: latestSlotDebug.messageId,
                slotTurnId: latestSlotDebug.turnId,
                slotText: latestSlotDebug.text,
                slotHasLastKnownHeight: latestSlotDebug.hasLastKnownHeight,
                slotHeight: latestSlotDebug.height,
                text: message.text.slice(0, 80)
            };
            const soughtTarget = await seekMountedChatGptRemoteTarget(message, index);
            if (!soughtTarget) return false;
            resolved = {
                match: soughtTarget,
                message,
                index
            };
        }

        liveMatch = resolved.match;
        const resolvedMessage = resolved.message;
        const resolvedIndex = resolved.index;
        const domIdentityKey = attachResolvedUserElementToMessage(
            resolvedMessage,
            liveMatch.element,
            liveMatch.source || 'remote-revived'
        );
        STATE.clickLockIndex = resolvedIndex;
        setActiveIndex(resolvedIndex);
        STATE.lastNavigationDebug = {
            mode: `remote-${liveMatch.source || 'revived'}-hit`,
            index: resolvedIndex,
            requestedIndex: index,
            remoteIndex: getMessageRemoteIndex(resolvedMessage, resolvedIndex),
            identityKeys,
            domIdentityKey,
            targetText: normalizeMessageText(liveMatch.element).slice(0, 80),
            slotText: liveMatch.slotText || ''
        };
        scrollExactUserElementIntoView(liveMatch.element, resolvedIndex, 'auto');
        scheduleActiveSync();
        return true;
    }

    function seekVirtualMessageIntoView(identityKeys, attemptsLeft) {
        clearVirtualSeekTimer();
        if (!identityKeys || !identityKeys.length || attemptsLeft <= 0) return;

        STATE.virtualSeekTimer = window.setTimeout(() => {
            STATE.virtualSeekTimer = 0;
            scanContent();

            const index = findMessageIndexByIdentityKeys(identityKeys);
            const message = index >= 0 ? STATE.messages[index] : null;
            if (!message) return;

            const liveMatch = findLiveUserElementForMessage(message, index);
            if (liveMatch) {
                STATE.clickLockIndex = index;
                setActiveIndex(index);
                message.anchor = liveMatch.element;
                message.container = ADAPTER.resolveMessageContainer(liveMatch.element);
                STATE.lastNavigationDebug = {
                    mode: liveMatch.source === 'id' ? 'virtual-id-hit' : `virtual-${liveMatch.source}-hit`,
                    index,
                    attemptsLeft,
                    identityKeys,
                    anchorSource: liveMatch.source,
                    liveIndex: typeof liveMatch.liveIndex === 'number' ? liveMatch.liveIndex : null,
                    domIdentityKey: liveMatch.domIdentityKey || '',
                    targetText: normalizeMessageText(liveMatch.element).slice(0, 80),
                    slotText: liveMatch.slotText || ''
                };
                scrollExactUserElementIntoView(liveMatch.element, index, 'auto');
                scheduleActiveSync();
                return;
            }

            const remoteIndex = getMessageRemoteIndex(message, index);
            const slot = getChatGptUserSlotElement(remoteIndex);
            if (slot && slot.isConnected) {
                const shouldNudgeSlot = String(slot.className || '').includes('last-known-height') &&
                    attemptsLeft > 0 &&
                    attemptsLeft % 5 === 0;
                if (shouldNudgeSlot) {
                    scrollChatGptUserSlotIntoView(remoteIndex, index, 'auto');
                } else {
                    pokeChatGptLazyMount(findScrollContainerForElement(slot), slot);
                }
                const slotDebug = getChatGptSlotDebug(slot);
                STATE.lastNavigationDebug = {
                    mode: shouldNudgeSlot ? 'slot-nudge' : 'slot-wait',
                    index,
                    remoteIndex,
                    childIndex: 1 + remoteIndex * 2,
                    attemptsLeft,
                    identityKeys,
                    slotRole: slotDebug.role,
                    slotMessageId: slotDebug.messageId,
                    slotText: slotDebug.text,
                    slotHasLastKnownHeight: slotDebug.hasLastKnownHeight,
                    slotHeight: slotDebug.height,
                    lazyMountPoked: true
                };
            } else {
                const container = getActiveScrollContainer();
                const seek = getDirectionalSeekScroll(index, container);
                STATE.lastNavigationDebug = {
                    mode: 'virtual-seek-step-fallback',
                    index,
                    attemptsLeft,
                    identityKeys,
                    nextTop: Math.round(seek.top),
                    currentTop: Math.round(seek.currentTop),
                    direction: seek.direction,
                    reason: seek.reason,
                    visibleRemoteIndexes: seek.visibleIndexes
                };
                scrollTargetTo(container, seek.top, 'auto');
            }
            scheduleActiveSync();
            seekVirtualMessageIntoView(identityKeys, attemptsLeft - 1);
        }, TIMINGS.virtualSeekInterval);
    }

    function scrollVirtualMessageIntoView(message, index) {
        const identityKeys = getMessageIdentityKeys(message);
        if (!identityKeys.length) return;

        clearVirtualSeekTimer();

        const liveMatch = findLiveUserElementForMessage(message, index);
        if (liveMatch) {
            STATE.lastNavigationDebug = {
                mode: liveMatch.source === 'id' ? 'already-mounted-id-hit' : `already-mounted-${liveMatch.source}-hit`,
                index,
                identityKeys,
                anchorSource: liveMatch.source,
                liveIndex: typeof liveMatch.liveIndex === 'number' ? liveMatch.liveIndex : null,
                domIdentityKey: liveMatch.domIdentityKey || '',
                targetText: normalizeMessageText(liveMatch.element).slice(0, 80),
                slotText: liveMatch.slotText || ''
            };
            scrollExactUserElementIntoView(liveMatch.element, index, 'auto');
            return;
        }

        const remoteIndex = getMessageRemoteIndex(message, index);
        if (!scrollChatGptUserSlotIntoView(remoteIndex, index, 'auto')) {
            const container = getActiveScrollContainer();
            const seek = getDirectionalSeekScroll(index, container);
            STATE.lastNavigationDebug = {
                mode: 'virtual-seek-start-fallback',
                index,
                identityKeys,
                nextTop: Math.round(seek.top),
                currentTop: Math.round(seek.currentTop),
                direction: seek.direction,
                reason: seek.reason,
                visibleRemoteIndexes: seek.visibleIndexes,
                text: message.text.slice(0, 80)
            };
            scrollTargetTo(container, seek.top, 'auto');
        } else {
            STATE.lastNavigationDebug.identityKeys = identityKeys;
            STATE.lastNavigationDebug.text = message.text.slice(0, 80);
        }
        seekVirtualMessageIntoView(identityKeys, TIMINGS.virtualSeekMaxAttempts);
    }

    function holdManualActiveIndex(index, duration) {
        STATE.manualActiveIndex = index;
        scheduleManualActiveRelease(typeof duration === 'number' ? duration : TIMINGS.manualRelease);
    }

    function clearManualActiveIndex() {
        STATE.manualActiveIndex = -1;
        if (STATE.scrollSettleTimer) {
            window.clearTimeout(STATE.scrollSettleTimer);
            STATE.scrollSettleTimer = 0;
        }
    }

    function cancelClickNavigationTracking() {
        STATE.clickLockIndex = -1;
        clearManualActiveIndex();
        clearJumpSyncTimer();
        clearVirtualSeekTimer();
    }

    function beginForcedBoundaryNavigation(index) {
        cancelClickNavigationTracking();
        STATE.forcedActiveIndex = index;
    }

    function finishForcedBoundaryNavigation(btn, iconKey) {
        btn.disabled = false;
        setButtonIcon(btn, iconKey);
        STATE.forcedActiveIndex = -1;
        clearManualActiveIndex();
        scanContent();
        scheduleAutoCollapse();
    }

    function getActiveThreshold(container) {
        const viewport = getViewportRect(container);
        return getScrollTop(container) + Math.min(160, viewport.height * 0.28);
    }

    function isIndexAligned(index, container) {
        if (index < 0 || index >= STATE.messages.length) return false;

        if (STATE.positionsDirty || STATE.positionCache.length !== STATE.messages.length) {
            refreshPositionCache();
        }

        const positions = STATE.positionCache;
        const threshold = getActiveThreshold(container);
        const currentTop = positions[index];
        const nextTop = index < positions.length - 1 ? positions[index + 1] : Infinity;
        const tolerance = 12;

        return currentTop <= threshold + tolerance && nextTop > threshold - tolerance;
    }

    function findMessageIndexByRemoteIndex(messages, remoteIndex) {
        if (typeof remoteIndex !== 'number') return -1;

        return messages.findIndex((message, index) => (
            getMessageRemoteIndex(message, index) === remoteIndex ||
            message.remoteIndex === remoteIndex ||
            message.nativeTocIndex === remoteIndex ||
            message.stableOrder === remoteIndex
        ));
    }

    function findMessageIndexForLiveChatGptElement(messages, element, fallbackRemoteIndex) {
        const identityKey = getMessageIdentityKeyFromElement(element);
        if (identityKey) {
            const identityIndex = messages.findIndex((message) => getMessageIdentityKeys(message).includes(identityKey));
            if (identityIndex >= 0) return identityIndex;
        }

        const remoteIndex = findMessageIndexByRemoteIndex(messages, fallbackRemoteIndex);
        if (remoteIndex >= 0) return remoteIndex;

        const liveText = extractChatGptUserQueryText(element);
        const comparable = getComparableMessageText(liveText);
        if (!comparable) return -1;

        const compatibleIndexes = messages.reduce((indexes, message, index) => {
            if (isComparableTextMatch(getComparableMessageText(message.text), comparable)) {
                indexes.push(index);
            }
            return indexes;
        }, []);
        return compatibleIndexes.length === 1 ? compatibleIndexes[0] : -1;
    }

    function getChatGptActiveCandidates(messages, container) {
        const candidates = [];
        const seen = new Set();

        messages.forEach((message, index) => {
            const remoteIndex = getMessageRemoteIndex(message, index);
            const slot = getChatGptUserSlotElement(remoteIndex);
            if (!slot || !slot.isConnected) return;

            const top = getElementAbsoluteTop(slot, container);
            if (typeof top !== 'number') return;

            candidates.push({
                index,
                top,
                source: getChatGptSlotSource(slot, remoteIndex) || 'message-slot'
            });
        });

        getCurrentTextAlignmentMatches().forEach((match) => {
            const element = match.element;
            if (!element || !element.isConnected || !isVisibleElement(element)) return;

            const index = findMessageIndexForLiveChatGptElement(messages, element, match.remoteIndex);
            if (index < 0) return;

            const top = getElementAbsoluteTop(element, container);
            if (typeof top !== 'number') return;

            candidates.push({
                index,
                top,
                source: match.source || 'live-text'
            });
        });

        getCurrentChatGptTurnAlignmentMatches().forEach((match) => {
            const element = match.element;
            if (!element || !element.isConnected || !isVisibleElement(element)) return;

            const top = getElementAbsoluteTop(element, container);
            if (typeof top !== 'number') return;

            candidates.push({
                index: match.remoteIndex,
                top,
                source: `${match.source}-${match.role || 'message'}`
            });
        });

        messages.forEach((message, index) => {
            const target = getMessageTarget(message);
            if (!target || !target.isConnected || !isVisibleElement(target)) return;

            const top = getMessageAbsoluteTop(message, container);
            if (typeof top !== 'number') return;

            candidates.push({
                index,
                top,
                source: message.anchorSource || 'message-anchor'
            });
        });

        return candidates
            .sort((a, b) => {
                if (a.top !== b.top) return a.top - b.top;
                return a.index - b.index;
            })
            .filter((candidate) => {
                if (seen.has(candidate.index)) return false;
                seen.add(candidate.index);
                return true;
            });
    }

    function findChatGptActiveMessageIndex(messages) {
        const container = getActiveScrollContainer();
        const candidates = getChatGptActiveCandidates(messages, container);
        if (!candidates.length) {
            const previousIndex = STATE.activeIndex >= 0 ? clampMessageIndex(STATE.activeIndex) : -1;
            STATE.lastActiveDebug = {
                mode: previousIndex >= 0 ? 'hold-previous-no-visible-candidates' : 'no-candidates',
                index: previousIndex
            };
            return previousIndex;
        }

        const threshold = getActiveThreshold(container);
        let active = null;
        for (let i = 0; i < candidates.length; i++) {
            if (candidates[i].top <= threshold + 12) {
                active = candidates[i];
            } else {
                break;
            }
        }

        if (!active) {
            const previousIndex = STATE.activeIndex >= 0 ? clampMessageIndex(STATE.activeIndex) : -1;
            active = previousIndex >= 0 && previousIndex < candidates[0].index
                ? { index: previousIndex, top: threshold, source: 'hold-previous-before-next-turn' }
                : candidates[0];
        }

        STATE.lastActiveDebug = {
            mode: 'chatgpt-visible-candidates',
            index: active.index,
            threshold: Math.round(threshold),
            candidates: candidates.slice(0, 8).map((candidate) => ({
                index: candidate.index,
                top: Math.round(candidate.top),
                source: candidate.source
            }))
        };
        return active.index;
    }

    function findClaudeActiveMessageIndex(messages) {
        const container = getActiveScrollContainer();
        const candidates = messages.reduce((result, message, index) => {
            const target = getMessageTarget(message);
            if (!target || !target.isConnected || !isVisibleElement(target)) return result;
            const top = getMessageAbsoluteTop(message, container);
            if (typeof top === 'number') result.push({ index, top });
            return result;
        }, []).sort((a, b) => a.top - b.top);

        if (!candidates.length) {
            return STATE.activeIndex >= 0 ? clampMessageIndex(STATE.activeIndex) : -1;
        }

        const threshold = getActiveThreshold(container);
        let active = candidates[0];
        for (let i = 0; i < candidates.length; i++) {
            if (candidates[i].top <= threshold + 12) active = candidates[i];
            else break;
        }
        return active.index;
    }

    function scheduleManualActiveRelease(delay) {
        if (STATE.scrollSettleTimer) {
            window.clearTimeout(STATE.scrollSettleTimer);
        }
        STATE.scrollSettleTimer = window.setTimeout(() => {
            STATE.scrollSettleTimer = 0;

            if (STATE.manualActiveIndex >= 0) {
                const manualIndex = clampMessageIndex(STATE.manualActiveIndex);
                const targetMessage = STATE.messages[manualIndex];
                const target = getMessageTarget(targetMessage);
                if (target && target.isConnected) {
                    const currentContainer = findScrollContainerForElement(target);
                    const exactTop = getMessageScrollTopByIndex(manualIndex, currentContainer);
                    const aligned = isIndexAligned(manualIndex, currentContainer);
                    if (typeof exactTop === 'number' && (Math.abs(getScrollTop(currentContainer) - exactTop) > 4 || !aligned)) {
                        scrollTargetTo(currentContainer, exactTop, 'auto');
                        scheduleManualActiveRelease(TIMINGS.manualRelease);
                        scheduleActiveSync();
                        return;
                    }
                }
            }

            clearManualActiveIndex();
            scheduleActiveSync();
        }, typeof delay === 'number' ? delay : TIMINGS.manualRelease);
    }

    function resolveActiveIndex(index) {
        if (STATE.forcedActiveIndex >= 0) {
            return clampMessageIndex(STATE.forcedActiveIndex);
        }
        if (STATE.clickLockIndex >= 0) {
            return clampMessageIndex(STATE.clickLockIndex);
        }
        if (STATE.manualActiveIndex < 0) return index;

        const manualIndex = clampMessageIndex(STATE.manualActiveIndex);
        const container = getActiveScrollContainer();
        if (isIndexAligned(manualIndex, container)) {
            clearManualActiveIndex();
            return manualIndex;
        }

        return manualIndex;
    }

    function handleScrollSync() {
        if (STATE.manualActiveIndex >= 0) {
            scheduleManualActiveRelease(TIMINGS.manualRelease);
        }
        scheduleActiveSync();
    }

    function setButtonIcon(btn, iconKey, className) {
        while (btn.firstChild) btn.removeChild(btn.firstChild);
        btn.appendChild(createIcon(iconKey, className));
    }

    function getBubbleLabel() {
        return ADAPTER.label || ADAPTER.id;
    }

    function setButtonText(btn, text, className) {
        while (btn.firstChild) btn.removeChild(btn.firstChild);
        const label = document.createElement('span');
        label.className = className || '';
        label.textContent = text;
        btn.appendChild(label);
    }

    function markTocUserScroll(duration) {
        STATE.tocUserScrollUntil = Date.now() + (typeof duration === 'number' ? duration : TIMINGS.tocFollowPause);
    }

    function pauseTocFollowForNavigation() {
        markTocUserScroll(5000);
    }

    function shouldPauseTocFollow() {
        return Date.now() < STATE.tocUserScrollUntil;
    }

    function getTocList() {
        return document.getElementById('toc-list');
    }

    function getPanelElement() {
        return document.getElementById('ai-toc-v2_2');
    }

    function setTocListScrollTop(list, top) {
        STATE.tocSyncing = true;
        list.scrollTop = top;
        window.setTimeout(() => {
            STATE.tocSyncing = false;
        }, 0);
    }

    function syncItemIntoView(list, item) {
        if (!list || !item) return;
        if (shouldPauseTocFollow()) return;

        if (list.clientHeight <= 0) return;
        const listRect = list.getBoundingClientRect();
        const itemRect = item.getBoundingClientRect();
        const itemTop = itemRect.top - listRect.top - list.clientTop + list.scrollTop;
        const itemBottom = itemTop + itemRect.height;
        const viewTop = list.scrollTop;
        const viewBottom = viewTop + list.clientHeight;

        if (itemTop >= viewTop && itemBottom <= viewBottom) return;

        const targetTop = Math.max(0, itemTop - Math.max(0, (list.clientHeight - item.offsetHeight) / 2));
        setTocListScrollTop(list, targetTop);
    }

    function syncTocToTopIfNeeded() {
        // A virtualized page may report scrollTop=0 away from its first message.
        if (STATE.activeIndex !== 0) return;
        const list = getTocList();
        if (!list) return;
        if (shouldPauseTocFollow()) return;

        const container = getActiveScrollContainer();
        if (getScrollTop(container) <= 1) {
            setTocListScrollTop(list, 0);
        }
    }

    function setActiveIndex(index) {
        const list = getTocList();
        if (!list) return;
        if (index === STATE.activeIndex) {
            const currentItem = index >= 0 ? list.children[index] : null;
            if (currentItem && !currentItem.classList.contains('toc-hidden')) {
                syncItemIntoView(list, currentItem);
            }
            return;
        }

        if (STATE.activeIndex >= 0 && list.children[STATE.activeIndex]) {
            list.children[STATE.activeIndex].classList.remove('toc-active');
        }

        STATE.activeIndex = index;
        if (index < 0 || !list.children[index]) return;

        const item = list.children[index];
        item.classList.add('toc-active');
        if (!item.classList.contains('toc-hidden')) {
            syncItemIntoView(list, item);
        }
    }

    function findActiveMessageIndex(messages) {
        if (!messages.length) return -1;

        if (ADAPTER.id === 'chatgpt') {
            const chatGptActiveIndex = findChatGptActiveMessageIndex(messages);
            if (chatGptActiveIndex >= 0) return chatGptActiveIndex;
            return STATE.activeIndex >= 0 ? clampMessageIndex(STATE.activeIndex) : 0;
        }

        if (ADAPTER.id === 'claude') {
            const claudeActiveIndex = findClaudeActiveMessageIndex(messages);
            if (claudeActiveIndex >= 0) return claudeActiveIndex;
            return STATE.activeIndex >= 0 ? clampMessageIndex(STATE.activeIndex) : 0;
        }

        const container = getActiveScrollContainer();
        if (STATE.positionsDirty || STATE.positionCache.length !== messages.length) {
            refreshPositionCache();
        }

        const viewport = getViewportRect(container);
        const threshold = getScrollTop(container) + Math.min(160, viewport.height * 0.28);
        const positions = STATE.positionCache;

        let low = 0;
        let high = positions.length - 1;
        let activeIndex = -1;

        while (low <= high) {
            const mid = (low + high) >> 1;
            if (positions[mid] <= threshold) {
                activeIndex = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        return activeIndex >= 0 ? activeIndex : 0;
    }

    function syncActiveTocItem() {
        if (!STATE.messages.length) {
            setActiveIndex(-1);
            return;
        }
        setActiveIndex(resolveActiveIndex(findActiveMessageIndex(STATE.messages)));
        syncTocToTopIfNeeded();
    }

    function scheduleActiveSync() {
        if (STATE.syncFrame) return;
        STATE.syncFrame = window.requestAnimationFrame(() => {
            STATE.syncFrame = 0;
            syncActiveTocItem();
        });
    }

    function clearAutoCollapseTimer() {
        if (!STATE.autoCollapseTimer) return;
        window.clearTimeout(STATE.autoCollapseTimer);
        STATE.autoCollapseTimer = 0;
    }

    function hasSearchInputValue(panel) {
        const input = panel ? panel.querySelector('.toc-search input') : null;
        return !!(input && input.value.trim());
    }

    function shouldKeepPanelExpanded(panel) {
        if (!panel || panel.classList.contains('toc-collapsed')) return true;
        if (hasSearchInputValue(panel)) return true;
        if (panel.contains(document.activeElement)) return true;
        if (panel.matches(':hover')) return true;
        if (panel.querySelector('.toc-btn:disabled')) return true;
        return false;
    }

    function scheduleAutoCollapse() {
        clearAutoCollapseTimer();
        if (!CONFIG.autoCollapse) return;

        const panel = getPanelElement();
        if (shouldKeepPanelExpanded(panel)) return;

        STATE.autoCollapseTimer = window.setTimeout(() => {
            STATE.autoCollapseTimer = 0;
            const currentPanel = getPanelElement();
            if (!currentPanel || shouldKeepPanelExpanded(currentPanel)) {
                scheduleAutoCollapse();
                return;
            }
            setPanelCollapsed(currentPanel, true);
        }, CONFIG.autoCollapseDelay);
    }

    function notePanelActivity() {
        const panel = getPanelElement();
        if (!panel || panel.classList.contains('toc-collapsed')) return;
        clearAutoCollapseTimer();
        window.setTimeout(scheduleAutoCollapse, 0);
    }

    function bindPanelActivity(panel) {
        panel.addEventListener('pointerenter', clearAutoCollapseTimer);
        panel.addEventListener('pointerleave', scheduleAutoCollapse);
        panel.addEventListener('focusin', clearAutoCollapseTimer);
        panel.addEventListener('focusout', () => window.setTimeout(scheduleAutoCollapse, 0));
        panel.addEventListener('click', notePanelActivity);
        panel.addEventListener('input', notePanelActivity);
        panel.addEventListener('keydown', notePanelActivity);
        panel.addEventListener('wheel', notePanelActivity, { passive: true });
        panel.addEventListener('touchmove', notePanelActivity, { passive: true });
        panel.addEventListener('scroll', notePanelActivity, { passive: true });
    }

    // TOC interactions and global input handling
    function bindScrollSync(preferredContainer) {
        const nextContainer = preferredContainer || getScrollContainer();
        if (STATE.scrollContainer === nextContainer) return;

        if (STATE.scrollContainer) {
            STATE.scrollContainer.removeEventListener('scroll', handleScrollSync);
        }

        nextContainer.addEventListener('scroll', handleScrollSync, { passive: true });
        STATE.scrollContainer = nextContainer;
        STATE.positionsDirty = true;
    }

    function filterList(value) {
        const list = getTocList();
        const items = Array.from(document.querySelectorAll('.toc-item'));
        const keyword = value.trim().toLowerCase();
        let visibleCount = 0;

        items.forEach((item) => {
            const text = item.getAttribute('data-text') || '';
            const hidden = !!keyword && !text.includes(keyword);
            item.classList.toggle('toc-hidden', hidden);
            if (!hidden) visibleCount++;
        });

        setNoResultsState(list, !!keyword && items.length > 0 && visibleCount === 0);
    }

    function setNoResultsState(list, visible) {
        if (!list) return;

        let item = list.querySelector('.toc-no-results');
        if (!visible) {
            if (item) item.remove();
            return;
        }

        if (!item) {
            item = document.createElement('li');
            item.className = 'toc-status toc-no-results';
            item.textContent = '\u65e0\u5339\u914d\u7ed3\u679c';
            list.appendChild(item);
        }
    }

    function updateSearchState(input) {
        const search = input.closest('.toc-search');
        if (search) {
            search.classList.toggle('has-value', !!input.value);
        }
        filterList(input.value);
    }

    function handleSearchInput(event) {
        updateSearchState(event.target);
        notePanelActivity();
    }

    function clearSearchInput() {
        const input = document.querySelector('.toc-search input');
        if (!input) return;

        input.value = '';
        updateSearchState(input);
        input.focus();
        notePanelActivity();
    }

    function handleTocUserWheel() {
        markTocUserScroll(TIMINGS.tocUserScroll);
        notePanelActivity();
    }

    function handleTocListScroll() {
        if (!STATE.tocSyncing) {
            markTocUserScroll(TIMINGS.tocUserScroll);
            notePanelActivity();
        }
    }

    function triggerBottomBoundaryNavigation() {
        const panel = getPanelElement();
        const bottomButton = panel ? panel.querySelector('.toc-actions .toc-btn:last-child') : null;
        if (bottomButton) {
            handleBot.call(bottomButton);
        }
    }

    async function handleTocItemClick(event, list) {
        const item = event.target.closest('.toc-item');
        if (!item || !list.contains(item)) return;

        const index = Number(item.dataset.index);
        const msg = STATE.messages[index];
        if (!msg) return;
        STATE.cancelBoundaryNavigation?.();

        const clickedText = (item.querySelector('.toc-text') ? item.querySelector('.toc-text').textContent : item.textContent || '').trim();
        STATE.lastTocClick = {
            index,
            clickedText,
            messageText: msg.text,
            remoteIndex: getMessageRemoteIndex(msg, index),
            nativeTocIndex: typeof msg.nativeTocIndex === 'number' ? msg.nativeTocIndex : null,
            nativeTocText: msg.nativeTocText || '',
            identityKeys: getMessageIdentityKeys(msg)
        };

        notePanelActivity();
        pauseTocFollowForNavigation();
        STATE.clickLockIndex = index;
        setActiveIndex(index);

        if (ADAPTER.id === 'chatgpt') {
            clearManualActiveIndex();
            const nativeHandled = await navigateWithChatGptNativeToc(msg, index);
            if (nativeHandled) return;

            const remoteHandled = await navigateWithChatGptRemoteToc(msg, index);
            if (remoteHandled) return;

            if (!nativeHandled && !(STATE.lastNavigationDebug && /^remote-/.test(STATE.lastNavigationDebug.mode || ''))) {
                STATE.lastNavigationDebug = {
                    mode: 'chatgpt-navigation-unavailable',
                    index,
                    remoteIndex: getMessageRemoteIndex(msg, index),
                    nativeTocIndex: typeof msg.nativeTocIndex === 'number' ? msg.nativeTocIndex : null,
                    nativeTocMessages: getChatGptNativeTocEntries().length,
                    remoteMessages: STATE.remoteMessages.length,
                    text: msg.text.slice(0, 80)
                };
            }
            return;
        }

        if (ADAPTER.id === 'claude') {
            clearManualActiveIndex();
            await navigateClaudeVirtualMessage(msg, index);
            return;
        }

        holdManualActiveIndex(index, TIMINGS.virtualSeekInterval * TIMINGS.virtualSeekMaxAttempts);

        if (isMessageConnected(msg)) {
            holdManualActiveIndex(index);
            const liveMatch = findLiveUserElementForMessage(msg, index);
            if (liveMatch) {
                STATE.lastNavigationDebug = {
                    mode: liveMatch.source === 'id' ? 'connected-id-hit' : `connected-${liveMatch.source}-hit`,
                    index,
                    identityKeys: getMessageIdentityKeys(msg),
                    anchorSource: liveMatch.source,
                    liveIndex: typeof liveMatch.liveIndex === 'number' ? liveMatch.liveIndex : null,
                    domIdentityKey: liveMatch.domIdentityKey || '',
                    targetText: normalizeMessageText(liveMatch.element).slice(0, 80)
                };
                scrollExactUserElementIntoView(liveMatch.element, index, 'auto');
            } else {
                STATE.lastNavigationDebug = {
                    mode: 'connected-fallback',
                    index,
                    identityKeys: getMessageIdentityKeys(msg),
                    text: msg.text.slice(0, 80)
                };
                scrollMessageIntoView(msg, index);
            }
            return;
        }

        scrollVirtualMessageIntoView(msg, index);
    }

    function bindTocListInteractions(list) {
        list.addEventListener('wheel', handleTocUserWheel, { passive: true });
        list.addEventListener('touchmove', handleTocUserWheel, { passive: true });
        list.addEventListener('scroll', handleTocListScroll, { passive: true });
        list.addEventListener('click', (event) => handleTocItemClick(event, list));
    }

    function shouldIgnoreNavigationRelease(event) {
        const panel = getPanelElement();
        return !!(panel && event.target && panel.contains(event.target));
    }

    function shouldReleaseNavigationForKey(event) {
        const navKeys = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '];
        return navKeys.includes(event.key);
    }

    function hasNavigationTracking() {
        return STATE.clickLockIndex >= 0 || STATE.manualActiveIndex >= 0 || !!STATE.jumpSyncTimer || !!STATE.cancelBoundaryNavigation;
    }

    function handleNavigationReleaseEvent(event) {
        if (!hasNavigationTracking()) return;
        if (shouldIgnoreNavigationRelease(event)) return;
        if (event.type === 'keydown' && !shouldReleaseNavigationForKey(event)) return;

        STATE.cancelBoundaryNavigation?.();
        cancelClickNavigationTracking();
        scheduleActiveSync();
    }

    function bindGlobalInteractionEvents() {
        if (STATE.globalEventsBound) return;

        window.addEventListener('wheel', handleNavigationReleaseEvent, { passive: true });
        window.addEventListener('touchmove', handleNavigationReleaseEvent, { passive: true });
        window.addEventListener('pointerdown', handleNavigationReleaseEvent, { passive: true });
        window.addEventListener('keydown', handleNavigationReleaseEvent);
        STATE.globalEventsBound = true;
    }

    function handleHeaderDragStart(event, panel) {
        if (event.target.tagName === 'INPUT' || event.target.closest('button')) return;

        const startX = event.clientX;
        const startY = event.clientY;
        const rect = panel.getBoundingClientRect();
        const startLeft = rect.left;
        const startTop = rect.top;
        panel.classList.add('toc-dragging');

        function onMove(moveEvent) {
            const next = getConstrainedPanelPosition(
                panel,
                startLeft + (moveEvent.clientX - startX),
                startTop + (moveEvent.clientY - startY)
            );
            panel.style.left = `${next.left}px`;
            panel.style.top = `${next.top}px`;
            panel.style.right = 'auto';
        }

        function onUp() {
            panel.classList.remove('toc-dragging');
            if (panel.classList.contains('toc-collapsed')) {
                applyBubblePosition(panel, getBubblePositionFromCurrentPanel(panel));
            }
            saveCurrentPanelPosition(panel);
            scheduleAutoCollapse();
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    function bindPanelDrag(panel, header) {
        header.addEventListener('mousedown', (event) => handleHeaderDragStart(event, panel));
    }

    function bindWindowResizeRefresh() {
        if (STATE.resizeBound) return;

        window.addEventListener('resize', () => {
            constrainPanelToViewport(getPanelElement(), true);
            schedulePositionRefresh();
        }, { passive: true });
        STATE.resizeBound = true;
    }

    function normalizeBoundaryScrollOptions(options) {
        return Object.assign({
            initialForcedIndex: -1,
            intervalMs: TIMINGS.boundaryInterval,
            onStart() {},
            getTargetTop() {},
            onHeightChange() {},
            getProgressKey() {
                return '';
            },
            isStable() {
                return false;
            },
            onTick() {}
        }, options);
    }

    function getChatGptBottomNavigationApi() {
        const roots = getPageWindow().document.querySelectorAll('[data-thread-user-message-navigation-content]');
        for (const root of roots) {
            if (root.closest('[inert], [aria-hidden="true"]')) continue;
            const key = Object.keys(root).find(name => name.startsWith('__reactFiber$'));
            let fiber = key ? getCommittedChatGptNavigationFiber(root[key]) : null;
            for (let depth = 0; fiber && depth < 30; depth++, fiber = fiber.return) {
                const values = [fiber.memoizedProps?.value];
                let dependency = fiber.dependencies?.firstContext;
                for (let i = 0; dependency && i < 30; i++, dependency = dependency.next) {
                    values.push(dependency.memoizedValue);
                }
                for (const value of values) {
                    if (typeof value?.scrollToBottom !== 'function' ||
                        typeof value.getScrollElement !== 'function' ||
                        typeof value.getUnroundedScrollDistanceFromBottomPx !== 'function') continue;
                    try {
                        const element = value.getScrollElement();
                        if (element?.isConnected && element.contains(root)) return value;
                    } catch (_) { /* Ignore contexts detached during a route change. */ }
                }
            }
        }
        return null;
    }

    function syncBoundaryTocPosition(index) {
        STATE.tocUserScrollUntil = 0;
        setActiveIndex(index);
        const list = getTocList();
        if (!list || index < 0) return;
        // Explicit boundary commands override the pause from a previous TOC click.
        if (index === 0) setTocListScrollTop(list, 0);
        else if (index === getLastMessageIndex()) setTocListScrollTop(list, list.scrollHeight);
    }

    async function navigateChatGptBoundary(btn, direction) {
        const message = direction === 'top' ? STATE.messages[0] : STATE.messages[STATE.messages.length - 1];
        const api = direction === 'top' ? getChatGptMessageNavigationApi() : getChatGptBottomNavigationApi();
        const messageApi = direction === 'top' ? api : getChatGptMessageNavigationApi();
        if (!api || !message || !messageApi) return false;
        const context = getChatGptMessageCacheContext();
        const debug = { direction, mode: 'native-start', startedAt: Date.now() };
        STATE.lastBoundaryDebug = debug;
        const click = { index: direction === 'top' ? 0 : getLastMessageIndex(),
            identityKeys: message ? getMessageIdentityKeys(message) : [], boundary: direction };
        STATE.lastTocClick = click;
        btn.disabled = true;
        setButtonIcon(btn, 'spin', 'toc-spin');
        beginForcedBoundaryNavigation(click.index);
        syncBoundaryTocPosition(click.index);
        let cancelled = false;
        let released = false;
        let resolveCancellation;
        const cancellation = new Promise(resolve => { resolveCancellation = resolve; });
        const release = () => {
            if (released) return;
            released = true;
            btn.disabled = false;
            setButtonIcon(btn, direction);
            if (STATE.cancelBoundaryNavigation === cancel) {
                STATE.cancelBoundaryNavigation = null;
                STATE.forcedActiveIndex = -1;
                scheduleActiveSync();
            }
        };
        const cancel = () => {
            cancelled = true;
            debug.mode = 'native-cancelled';
            if (STATE.lastTocClick === click) STATE.lastTocClick = null;
            resolveCancellation();
            release();
        };
        STATE.cancelBoundaryNavigation = cancel;
        const isCurrent = () => !cancelled && context === getChatGptMessageCacheContext() && STATE.lastTocClick === click;
        const watch = window.setInterval(() => { if (!isCurrent()) cancel(); }, 100);
        let timer;
        try {
            if (direction === 'top') {
                await Promise.race([navigateWithChatGptMessageApi(api, message, 0), cancellation]);
                if (isCurrent()) debug.mode = STATE.lastNavigationDebug?.mode === 'remote-message-api-visible'
                    ? 'native-visible' : 'native-top-unconfirmed';
                if (isCurrent() && debug.mode === 'native-visible') {
                    STATE.clickLockIndex = 0;
                    syncBoundaryTocPosition(0);
                    debug.tocIndex = 0;
                }
            } else {
                // Load and mount the final turn by ID before scrolling to its answer's end.
                // The current scroll region may otherwise contain only an older history window.
                debug.mode = 'native-bottom-loading-last-turn';
                await Promise.race([navigateWithChatGptMessageApi(messageApi, message, click.index), cancellation]);
                if (!isCurrent()) return true;
                debug.lastTurnNavigation = STATE.lastNavigationDebug?.mode;
                if (!['remote-message-api-visible', 'remote-message-api-not-aligned'].includes(debug.lastTurnNavigation)) {
                    debug.mode = 'native-bottom-last-turn-unconfirmed';
                    return true;
                }
                const bottomApi = getChatGptBottomNavigationApi();
                if (!bottomApi) {
                    debug.mode = 'native-bottom-api-unavailable-after-mount';
                    return true;
                }
                await Promise.race([
                    Promise.resolve().then(() => { if (isCurrent()) return bottomApi.scrollToBottom(); }),
                    cancellation,
                    new Promise((_, reject) => {
                        timer = window.setTimeout(() => reject(new Error('native-bottom-timeout')), 6000);
                    })
                ]);
                const deadline = Date.now() + 1800;
                let bottomSamples = 0;
                while (isCurrent() && Date.now() < deadline) {
                    const distance = bottomApi.getUnroundedScrollDistanceFromBottomPx();
                    debug.distanceFromBottom = distance;
                    bottomSamples = Number.isFinite(distance) && Math.abs(distance) <= 2 ? bottomSamples + 1 : 0;
                    if (bottomSamples >= 2) break;
                    await waitForMilliseconds(80);
                }
                if (isCurrent()) {
                    debug.mode = bottomSamples >= 2 ? 'native-bottom-confirmed' : 'native-bottom-unconfirmed';
                    if (bottomSamples >= 2) {
                        const lastIndex = getLastMessageIndex();
                        STATE.clickLockIndex = lastIndex;
                        syncBoundaryTocPosition(lastIndex);
                        debug.tocIndex = lastIndex;
                    }
                }
            }
        } catch (error) {
            if (isCurrent()) {
                debug.mode = 'native-error';
                debug.error = String(error?.message || error);
            }
        } finally {
            window.clearInterval(watch);
            window.clearTimeout(timer);
            debug.durationMs = Date.now() - debug.startedAt;
            release();
        }
        // Do not start competing coordinate scrolling after dispatching a native request.
        return true;
    }

    function runBoundaryScroll(btn, options) {
        const resolvedOptions = normalizeBoundaryScrollOptions(options);
        btn.disabled = true;
        setButtonIcon(btn, 'spin', 'toc-spin');

        const initialForcedIndex = resolvedOptions.initialForcedIndex;
        if (initialForcedIndex >= 0) {
            beginForcedBoundaryNavigation(initialForcedIndex);
            syncBoundaryTocPosition(initialForcedIndex);
        }

        resolvedOptions.onStart();

        let attempts = 0;
        let stableSince = 0;
        let lastHeight = -1;
        let lastProgressKey = '';
        const route = window.location.pathname;
        const cancel = () => {
            clearInterval(timer);
            btn.disabled = false;
            setButtonIcon(btn, resolvedOptions.iconKey);
            if (STATE.cancelBoundaryNavigation === cancel) {
                STATE.cancelBoundaryNavigation = null;
                STATE.forcedActiveIndex = -1;
                scheduleActiveSync();
            }
        };

        const timer = setInterval(() => {
            if (window.location.pathname !== route) { cancel(); return; }
            attempts++;
            const container = ADAPTER.id === 'chatgpt'
                ? (getChatGptFallbackScrollContainer() || getScrollContainer())
                : getScrollContainer();
            if (STATE.scrollContainer !== container) bindScrollSync(container);

            const currentHeight = getScrollHeight(container);
            const heightChanged = currentHeight !== lastHeight;
            const progressKey = resolvedOptions.getProgressKey(container);
            const progressChanged = !!lastProgressKey && progressKey !== lastProgressKey;

            const nextTop = resolvedOptions.getTargetTop(container);
            if (typeof nextTop === 'number') {
                scrollTargetTo(container, nextTop, 'auto');
            }

            if (heightChanged || progressChanged) {
                resolvedOptions.onHeightChange(container, currentHeight);
            }

            const isStable = resolvedOptions.isStable(
                container,
                heightChanged || progressChanged,
                currentHeight
            );

            if (progressChanged) {
                stableSince = 0;
            } else if (isStable) {
                if (!stableSince) stableSince = Date.now();
            } else {
                stableSince = 0;
            }

            lastHeight = currentHeight;
            lastProgressKey = progressKey;

            resolvedOptions.onTick(container, heightChanged, currentHeight);

            if ((stableSince && Date.now() - stableSince >= resolvedOptions.stableMs) || attempts >= resolvedOptions.maxAttempts) {
                clearInterval(timer);
                if (STATE.cancelBoundaryNavigation === cancel) STATE.cancelBoundaryNavigation = null;
                finishForcedBoundaryNavigation(btn, resolvedOptions.iconKey);
            }
        }, resolvedOptions.intervalMs);
        STATE.cancelBoundaryNavigation = cancel;
    }

    // Boundary navigation actions
    function createTopBoundaryScrollOptions() {
        return {
            iconKey: 'top',
            initialForcedIndex: 0,
            stableMs: TIMINGS.topBoundaryStable,
            maxAttempts: TIMINGS.topBoundaryMaxAttempts,
            getTargetTop() {
                return 0;
            },
            getProgressKey() {
                return ADAPTER.id === 'chatgpt'
                    ? getCurrentTextAlignmentMatches().map((match) => match.remoteIndex).join(',')
                    : '';
            },
            onStart() {
                syncTocToTopIfNeeded();
            },
            onHeightChange() {
                scanContent();
            },
            isStable(container, heightChanged) {
                return getScrollTop(container) <= 1 && !heightChanged;
            },
            onTick() {
                syncTocToTopIfNeeded();
                scheduleActiveSync();
            }
        };
    }

    function createBottomBoundaryScrollOptions() {
        return {
            iconKey: 'bottom',
            initialForcedIndex: getLastMessageIndex(),
            stableMs: TIMINGS.bottomBoundaryStable,
            maxAttempts: TIMINGS.bottomBoundaryMaxAttempts,
            getTargetTop(container) {
                return getScrollMaxTop(container);
            },
            getProgressKey() {
                return ADAPTER.id === 'chatgpt'
                    ? getCurrentTextAlignmentMatches().map((match) => match.remoteIndex).join(',')
                    : '';
            },
            onHeightChange() {
                scanContent();
                STATE.forcedActiveIndex = getLastMessageIndex();
            },
            isStable(container, heightChanged) {
                const maxTop = getScrollMaxTop(container);
                return Math.abs(getScrollTop(container) - maxTop) <= 1 && !heightChanged;
            },
            onTick() {
                scheduleActiveSync();
            }
        };
    }

    async function handleTop() {
        STATE.cancelBoundaryNavigation?.();
        if (ADAPTER.id === 'chatgpt' && await navigateChatGptBoundary(this, 'top')) return;
        runBoundaryScroll(this, createTopBoundaryScrollOptions());
    }

    async function handleBot() {
        STATE.cancelBoundaryNavigation?.();
        if (ADAPTER.id === 'chatgpt' && await navigateChatGptBoundary(this, 'bottom')) return;
        runBoundaryScroll(this, createBottomBoundaryScrollOptions());
    }

    // UI builders and TOC rendering
    function createPanelElement() {
        const panel = document.createElement('div');
        panel.id = 'ai-toc-v2_2';
        panel.className = 'notranslate';
        panel.setAttribute('translate', 'no');
        return panel;
    }

    function createActionButton(title, iconKey, handler, className) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className ? `toc-btn ${className}` : 'toc-btn';
        button.title = title;
        button.setAttribute('aria-label', title);
        button.appendChild(createIcon(iconKey));
        button.onclick = handler;
        return button;
    }

    function createHeaderRow() {
        const row = document.createElement('div');
        row.className = 'toc-row';

        const title = document.createElement('span');
        title.className = 'toc-title';
        title.textContent = ADAPTER.title;

        const btnGroup = document.createElement('div');
        btnGroup.className = 'toc-actions';
        btnGroup.append(
            createActionButton('\u6298\u53e0\u9762\u677f', 'collapse', togglePanelCollapsed, 'toc-collapse-btn'),
            createActionButton('回到顶部', 'top', handleTop),
            createActionButton('直达底部', 'bottom', handleBot)
        );

        row.append(title, btnGroup);
        return row;
    }

    function createSearchSection() {
        const searchDiv = document.createElement('div');
        searchDiv.className = 'toc-search';

        const searchIcon = document.createElement('span');
        searchIcon.className = 'toc-search-icon';
        searchIcon.appendChild(createIcon('search'));

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = '搜索...';
        input.addEventListener('input', handleSearchInput);

        const clearButton = createActionButton('\u6e05\u7a7a\u641c\u7d22', 'clear', clearSearchInput, 'toc-clear-btn');

        searchDiv.append(searchIcon, input, clearButton);
        return searchDiv;
    }

    function createHeaderSection() {
        const header = document.createElement('div');
        header.className = 'toc-header';
        header.append(createHeaderRow(), createSearchSection());
        if (ADAPTER.id === 'chatgpt') {
            const status = document.createElement('div');
            status.className = 'toc-navigation-status';
            status.hidden = true;
            status.setAttribute('role', 'status');
            status.setAttribute('aria-live', 'polite');
            const spinner = document.createElement('span');
            spinner.className = 'toc-wait-spinner';
            spinner.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span');
            label.className = 'toc-navigation-label';
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'toc-navigation-retry';
            retry.textContent = '重试';
            retry.addEventListener('click', () => {
                clearChatGptHistoryWarmup();
                scheduleChatGptHistoryWarmup();
            });
            status.append(spinner, label, retry);
            header.appendChild(status);
        }
        return header;
    }

    function createTocListElement() {
        const list = document.createElement('ul');
        list.id = 'toc-list';
        bindTocListInteractions(list);
        return list;
    }

    function clearElementChildren(element) {
        while (element.firstChild) element.removeChild(element.firstChild);
    }

    function renderEmptyTocState(list) {
        setActiveIndex(-1);
        clearElementChildren(list);
        const item = document.createElement('li');
        item.className = 'toc-status';
        item.textContent = '...';
        list.appendChild(item);
    }

    function ensureTocItem(list, index) {
        let item = list.children[index];
        if (item) return item;

        item = document.createElement('li');
        item.className = 'toc-item';

        const icon = document.createElement('span');
        icon.className = 'toc-icon';
        icon.appendChild(createIcon('bullet'));

        const label = document.createElement('span');
        label.className = 'toc-text';

        item.append(icon, label);
        list.appendChild(item);
        return item;
    }

    function updateTocItem(item, text, index) {
        const normalizedText = text.toLowerCase();
        if (item.getAttribute('data-text') !== normalizedText) {
            item.setAttribute('data-text', normalizedText);
            item.title = text;
            item.querySelector('.toc-text').textContent = text;
        }

        item.dataset.index = String(index);
    }

    function trimExtraTocItems(list, total) {
        while (list.children.length > total) {
            list.removeChild(list.lastChild);
        }
    }

    function renderTocItems(list, messages) {
        for (let i = 0; i < messages.length; i++) {
            const item = ensureTocItem(list, i);
            updateTocItem(item, messages[i].text, i);
        }

        trimExtraTocItems(list, messages.length);
    }

    function preserveTocActiveState(list, previousActiveIndex, total) {
        const preservedIndex = previousActiveIndex >= 0 && previousActiveIndex < total
            ? previousActiveIndex
            : -1;
        Array.from(list.querySelectorAll('.toc-active')).forEach((item) => {
            item.classList.remove('toc-active');
        });
        STATE.activeIndex = preservedIndex;
        if (preservedIndex >= 0 && list.children[preservedIndex]) {
            list.children[preservedIndex].classList.add('toc-active');
        }
        if (STATE.clickLockIndex >= total) {
            STATE.clickLockIndex = -1;
        }
        if (STATE.manualActiveIndex >= total) {
            clearManualActiveIndex();
        }
    }

    function syncTocSearchFilter() {
        const input = document.querySelector('.toc-search input');
        if (input && input.value) {
            updateSearchState(input);
        }
    }

    function finalizeRenderedToc(list, previousActiveIndex, total) {
        preserveTocActiveState(list, previousActiveIndex, total);
        syncTocSearchFilter();
        bindScrollSync();
        refreshPositionCache();
        scheduleActiveSync();
    }

    function collectCurrentMessages() {
        let messages = collectMessagesFromAdapter(ADAPTER);
        if (ADAPTER.id === 'chatgpt') {
            const context = getChatGptMessageCacheContext();
            if (STATE.messageListContext !== context) {
                if (STATE.messageListContext) clearChatGptPendingRefresh();
                STATE.messageListContext = context;
                STATE.messages = [];
            }
            if (
                STATE.remoteMessageContext !== context ||
                !STATE.remoteMessageIsAuthoritative ||
                !STATE.remoteMessages.length
            ) {
                hydrateChatGptConversationMessages();
            }
        }
        if (ADAPTER.id === 'claude') {
            STATE.messageListContext = getClaudeMessageContext();
        }
        annotateMessagesWithNativeToc(messages);
        STATE.messages = messages;
        return messages;
    }

    function clearTocStatusState(list) {
        if (list.querySelector('.toc-status')) {
            clearElementChildren(list);
        }
    }

    function renderScanResult(list, messages, previousActiveIndex) {
        const total = messages.length;
        if (total === 0) {
            renderEmptyTocState(list);
            return;
        }

        clearTocStatusState(list);
        renderTocItems(list, messages);
        finalizeRenderedToc(list, previousActiveIndex, total);
        scheduleChatGptHistoryWarmup();
        syncChatGptNavigationFeedback();
    }

    // App bootstrap
    function createUI() {
        if (getPanelElement()) return;
        if (!document.body) return;

        injectStyles();

        const panel = createPanelElement();
        const header = createHeaderSection();
        const list = createTocListElement();

        panel.append(header, list);
        document.body.appendChild(panel);
        restorePanelState(panel);

        bindGlobalInteractionEvents();
        bindPanelDrag(panel, header);
        bindPanelActivity(panel);

        setTimeout(() => panel.classList.add('toc-visible'), 100);
        bindWindowResizeRefresh();
        startObserver();
        scanContent();
    }

    function scanContent() {
        const list = getTocList();
        if (!list) return;
        syncPanelForConversation();
        renderScanResult(list, collectCurrentMessages(), STATE.activeIndex);
    }

    function ensureAppRunning() {
        const panel = getPanelElement();
        if (!panel) {
            createUI();
        }
        if (!STATE.observer) {
            startObserver();
        }
        syncPanelForConversation();
    }

    function bootstrap() {
        installChatGptConversationInterceptors();
        installChatGptRouteWatcher();
        installChatGptConversationPrefetch();
        installClaudeConversationInterceptors();
        installClaudeResourceObserver();
        installClaudeRouteWatcher();
        installClaudeConversationPrefetch();
        exposeDebugInfo();
        ensureAppRunning();
        if (getPanelElement()) {
            scheduleScan(0);
        }
        window.setInterval(ensureAppRunning, 2000);
    }

    bootstrap();
})();
