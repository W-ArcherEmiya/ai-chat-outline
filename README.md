# ai-chat-outline


▎ Adds a sidebar table of contents to ChatGPT, Gemini and Claude. Jump to any previous prompt in long conversations, filter by keyword, and return to top or bottom instantly. Auto-highlights your current position. Optimized for very long chats.

▎ 为 ChatGPT、Gemini、Claude 网页版生成侧边目录，长对话中可快速跳转到任意历史提问，支持关键词过滤、一键回顶/到底，并自动高亮当前阅读位置。针对超长对话做了性能优化。

## 面板: 
![demo](https://raw.githubusercontent.com/W-ArcherEmiya/Images/main/ai_web_enhancer/scrennshoot_board.png)

## 侧边气泡:
![demo](https://raw.githubusercontent.com/W-ArcherEmiya/Images/main/ai_web_enhancer/scrennshoot_bubble.png)


## 功能

- 自动提取用户问题并生成侧边目录
- 点击目录快速跳转到对应位置
- 支持目录搜索过滤
- 支持一键回到顶部、直达底部
- 页面滚动时自动高亮当前条目
- 目录会跟随当前阅读位置自动滚回到对应条目
- 支持纯图片消息生成目录项，避免图片提问丢失
- 针对长对话与大 DOM 场景做了扫描与滚动性能优化

## 最新版本

### v2.8.9

- 修复 Claude 虚拟列表只挂载当前位置附近消息，导致目录条目不完整的问题。
- 目录改为读取会话接口的完整当前分支；页面滚动时，已卸载节点不会再造成条目消失。
- 未挂载条目按 Claude 的虚拟行索引定位，目标真实挂载后只执行一次最终对齐，避免上下震荡。
- 排除暂停、编辑或重试后废弃的分支，并支持重复文本、Markdown 提问及被打断回答造成的行号偏移。
- 修复 Claude 站内切换对话后无法重新读取完整目录的问题，无需刷新页面。
- 切换期间不会再把上一会话尚未卸载的页面节点写入新目录，旧请求晚到也不会覆盖当前会话。
- 新会话完整树请求会自动规范化接口地址并有限重试，避免首次请求失败后目录一直为空。
- Claude 改为按会话 ID 主动请求权威当前分支，不再要求页面先加载过对应接口。
- 完整目录按会话隔离缓存，并在鼠标移入侧栏会话链接时预取；站内切换可直接恢复目标目录，减少空列表等待。
- 修复 ChatGPT 同时存在页面滚动根节点与内部会话滚动区时，点击目录条目未滚动到目标的问题。
- 修复 ChatGPT 站内切换对话后必须刷新才能取得完整目录的问题；旧会话的延迟响应不会再阻塞或覆盖新会话。
- ChatGPT 完整分支按会话缓存并支持侧栏预取，目录点击使用当前会话的消息 ID 和内部滚动容器精确定位。
- 兼容 ChatGPT 不再提供旧虚拟占位槽、接口消息 ID 与页面 DOM ID 不一致的新版结构；通过当前挂载消息建立有序位置锚点后完成跳转。
- 参考稳定脚本增加 ChatGPT 新版 DOM 回退识别：旧角色属性不存在时，从用户气泡和 Markdown 回答节点恢复实时消息、滚动容器及跳转目标。
- 当 ChatGPT 再次调整消息类名时，自动用完整分支文本反查当前 DOM；即使当前没有可识别消息锚点，也会发现主滚动区并驱动目标挂载，不再依赖固定选择器。
- 适配 ChatGPT 动态分段滚动：点击未挂载条目时按当前锚点序号逐段加载；回顶和到底在分段高度不变时也会继续执行到真实边界。
- ChatGPT 新版优先使用原生消息 ID 导航；后台准备历史索引，点击复用同一次加载，并显示等待与重试状态。
- 修复重复文本、局部序号导致不同消息 ID 错误绑定，以及新聊天首条消息误报准备失败的问题。
- 返顶优先定位首条消息，返底先挂载最后一轮再到回答末尾；普通条目跳转后使用返顶、返底时，目录同步到对应位置。
- 进入或切换对话时自动展开目录并跟随当前阅读位置，保留同一对话内手动收起行为。
- 修复准备状态栏挤入收起气泡的问题，提示显隐不再改变目录布局。
- 增加短对话、长对话、重复提问及连续边界导航回归测试。浏览器用例采用本地模拟，不能替代真实网站兼容性验证。

### v2.8.8

- 修复 ChatGPT 新发送的提问不能立即出现在目录中的问题。
- 接口分支尚未更新时，临时追加当前 DOM 中已确认位于分支末尾的新提问，并自动刷新完整会话分支。
- 暂停后编辑重发时，已从页面移除的临时提问会同步从目录清除。

## 适用平台

- ChatGPT Web
- Gemini Web
- Claude Web

## 技术栈

- Vanilla JavaScript
- CSS3
- SVG
- Tampermonkey UserScript

## 安装

先安装浏览器扩展 [Tampermonkey](https://www.tampermonkey.net/)。

然后通过 Greasy Fork 安装脚本：

[安装 ai-chat-outline](https://greasyfork.org/zh-CN/scripts/563498-ai-chat-outline)

## 使用方式

安装完成后，打开 ChatGPT、Gemini 或 Claude 页面即可自动生效。

- 右侧会出现目录面板
- 点击目录项可跳转到对应问题
- 输入关键字可过滤目录内容
- 使用顶部和底部按钮可快速导航

## 开发

无额外依赖的回归测试：

```bash
node --test tests/chatgpt-navigation.test.cjs tests/catalog-order.test.cjs tests/boundary-navigation.test.cjs tests/panel-conversation.test.cjs
```

浏览器模拟测试需安装 Playwright 并可使用 Microsoft Edge：`node tests/boundary-browser.cjs`。
可通过 `PLAYWRIGHT_PATH` 指定 Playwright 模块路径，通过 `BROWSER_PATH` 指定 Chromium 浏览器可执行文件。

克隆仓库：

```bash
git clone https://github.com/W-ArcherEmiya/ai-chat-outline.git
```

核心脚本文件：

```text
ai-chat-outline.js
```

本地性能回归页：

```text
stress-test.html
```

本地调试时，可将脚本内容导入 Tampermonkey 后直接在目标网页验证。

## 反馈

如果这个脚本对你有帮助，欢迎在 GitHub 点一个 Star。

如发现 Bug 或希望增加功能，欢迎提交 Issue 或 PR：

- GitHub: https://github.com/W-ArcherEmiya/ai-chat-outline

## License

MIT
