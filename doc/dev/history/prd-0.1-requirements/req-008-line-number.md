好的，以下是使用 xterm.js 装饰器（Decoration）API 实现行号显示的详细计划。
这个方案的核心是在终端的每一行内容左侧，通过装饰器叠加显示一个静态的行号。
📝 第一步：理解核心概念
开始编码前，需要理解两个关键概念：
• 标记（Marker）：它就像一个书签，指向终端缓冲区（Terminal.buffer）中的特定行-
￼
。即使终端滚动，标记也会跟随它指向的那一行。它是装饰器定位的基础。
• 装饰器（Decoration）：它是附加在标记上的可视化元素-
10
。你可以控制它在屏幕上的位置（x 坐标）、宽度、高度、颜色等-
10
。更重要的是，它提供了一个 HTMLElement（decoration.element），允许你通过 CSS 完全自定义其样式-
￼
。我们正是利用这个特性，在每行左侧绘制行号。
🛠️ 第二步：实现步骤
这个方案的核心，是将终端输出按逻辑行分割，并在每次写入一行时，立即为该行注册一个显示行号的装饰器。xterm.js 4.18.0 及以上版本支持该 API。
1. 初始化与样式准备
首先，确保你的 xterm.js 版本符合要求。然后，你可以预先定义好行号容器的样式。
css
￼
￼
Copy
￼
￼
Download
/* 行号装饰器的样式，让它固定在左侧 */
.xterm-decoration-container .line-number {
    display: inline-block;
    width: 40px; /* 为行号预留固定宽度 */
    color: #888; /* 行号颜色，让它不那么显眼 */
    user-select: none; /* 防止行号被选中 */
    text-align: right;
    padding-right: 8px;
}
￼
￼
2. 实现行写入与行号注册函数
这是整个方案的核心。你需要一个函数，它接收一行文本，先写入终端，然后立即为这行注册一个带行号的装饰器。
typescript
￼
￼
Copy
￼
￼
Download
import { Terminal } from '@xterm/xterm';

let lineCounter = 0;

function writeLine(term: Terminal, line: string) {
    // 1. 写入文本内容，注意保留换行符
    //    使用 write 方法的回调，确保在内容被终端完全解析后再注册装饰器[reference:8][reference:9]
    term.write(line + '\r\n', () => {
        // 2. 内容已解析，此时注册标记和装饰器是安全的[reference:10]
        //    创建一个标记，指向当前写入行的位置[reference:11]
        const marker = term.registerMarker();
        if (!marker) return;

        // 3. 为这个标记创建一个装饰器
        //    设置 x: 0 让装饰器位于行首[reference:13]
        const decoration = term.registerDecoration({
            marker,
            x: 0,
            // width: 1, // 宽度默认为1个单元格，对于行号可能需要调整
        });

        if (decoration) {
            // 4. 在装饰器的 onRender 事件中，填充行号内容[reference:15]
            decoration.onRender(() => {
                if (decoration.element) {
                    // 将行号作为文本内容填充到装饰器的 DOM 元素中
                    decoration.element.textContent = `${lineCounter + 1}`;
                    // 应用样式
                    decoration.element.className = 'line-number';
                }
            });
            // 5. 行号计数器递增
            lineCounter++;
        }
    });
}
￼
￼
3. 在数据流中调用行写入函数
当你从后端（PTY）收到数据时，需要将数据分割成独立的行，然后调用 writeLine。
typescript
￼
￼
Copy
￼
￼
Download
// 假设从 Tauri 后端接收到数据
function onTerminalData(data: string) {
    // 按换行符分割数据
    const lines = data.split('\n');
    for (const line of lines) {
        if (line.trim() !== '') { // 忽略空行
            writeLine(terminal, line);
        }
    }
}
￼
￼
注意：这是一个简化的示例。在实际场景中，你可能需要一个更健壮的行缓冲器（Line Buffer），因为来自 PTY 的数据可能不会恰好以换行符结尾。
⚙️ 第三步：处理动态内容（如 vim、htop）
当终端进入备选屏幕（Alternate Screen） 时（如运行 vim、htop 等全屏应用），行号逻辑需要暂停。
• 检测切换：监听 terminal.onRender 事件或解析终端输出的转义序列（如 \x1b[?1049h 进入备选屏幕，\x1b[?1049l 退出）。
• 动态调整：
◦ 进入备选屏幕：清理所有行号装饰器，停止行号计数。
◦ 退出备选屏幕：恢复行号计数，并重新为当前可见行生成装饰器。
🚀 第四步：性能优化与注意事项
• 大文本处理：如果一次性写入数千行文本，为每一行都创建一个装饰器可能会导致性能问题。可以考虑分批次处理，或在写入大量数据时暂时禁用行号。
• 内存管理：当终端缓冲区滚动，旧行被清除时，对应的装饰器可能不会被自动清理。你需要监听 terminal.onScroll 事件，并手动清理不再可见的行号装饰器-
￼
。
• write 回调是关键：务必在 terminal.write() 的回调函数中注册 marker 和 decoration-
1
-
11
。这是确保行号位置准确的唯一可靠方法，避免因数据未解析完成而导致的错位问题-
1
-
11
。
💎 总结
这个计划的流程可以概括为：
数据流入 → 按行分割 → writeLine（写入+注册回调）→ 回调中创建标记和装饰器 → 在 onRender 中显示行号 → 监听屏幕切换和滚动事件进行管理。
这是一个功能完整、概念清晰的实现路径，适合在你的 Tauri 应用中进行集成和测试。