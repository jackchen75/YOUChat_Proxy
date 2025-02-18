export function formatMessages(messages, proxyModel, randomFileName) {
    // 检查是否是 Claude 模型
    const isClaudeModel = proxyModel.toLowerCase().includes('claude');

    // 启用特殊前缀
    const USE_BACKSPACE_PREFIX = process.env.USE_BACKSPACE_PREFIX === 'true';

    // 定义角色映射
    const roleFeatures = getRoleFeatures(messages, isClaudeModel, USE_BACKSPACE_PREFIX);

    // 清除第一条消息的 role
    messages = clearFirstMessageRole(messages);

    messages = removeCustomRoleDefinitions(messages);

    messages = convertRoles(messages, roleFeatures);

    // 替换 content 中的角色
    messages = replaceRolesInContent(messages, roleFeatures);

    // 如果启用 clewd
    const CLEWD_ENABLED = process.env.CLEWD_ENABLED === 'true';
    if (CLEWD_ENABLED) {
        messages = xmlPlotAllMessages(messages, roleFeatures);
    }

    messages = messages.map((message) => {
        let newMessage = { ...message };
        if (typeof newMessage.content === 'string') {
            // 1) 移除 </FORMAT LINE BREAK/> 标识
            let tempContent = newMessage.content.replace(/<\/FORMAT\s+LINE\s+BREAK\/>/g, '');
            tempContent = tempContent.replace(/\n{3,}/g, '\n\n');
            newMessage.content = tempContent;
        }
        return newMessage;
    });

    return messages;
}

/**
 * 将首条消息role置空
 * @param {Array} messages - 消息数组
 * @returns {Array} 处理后的消息数组
 */
function clearFirstMessageRole(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
        return messages;
    }
    const processedMessages = messages.map(msg => ({...msg}));

    processedMessages[0] = {
        ...processedMessages[0],
        role: ''
    };

    return processedMessages;
}

// 获取角色特征
function getRoleFeatures(messages, isClaudeModel, useBackspacePrefix) {
    let prefix = useBackspacePrefix ? '\u0008' : '';
    let systemRole = `${prefix}${isClaudeModel ? 'System' : 'system'}`;
    let userRole = `${prefix}${isClaudeModel ? 'Human' : 'user'}`;
    let assistantRole = `${prefix}${isClaudeModel ? 'Assistant' : 'assistant'}`;

    // 匹配自定义角色
    const rolePattern = /\[\|(\w+)::(.*?)\|\]/g;
    let customRoles = {};
    messages.forEach(message => {
        let content = message.content;
        let match;
        while ((match = rolePattern.exec(content)) !== null) {
            const roleKey = match[1]; // 'system', 'user', 'assistant'
            customRoles[roleKey.toLowerCase()] = match[2];
        }
    });

    if (Object.keys(customRoles).length > 0) {
        prefix = '';

        if (customRoles['system']) {
            systemRole = customRoles['system'];
        }

        if (customRoles['user']) {
            userRole = customRoles['user'];
        }

        if (customRoles['assistant']) {
            assistantRole = customRoles['assistant'];
        }
    }

    return {
        systemRole,
        userRole,
        assistantRole,
        prefix
    };
}

// 移除 messages 自定义角色格式
function removeCustomRoleDefinitions(messages) {
    const rolePattern = /\[\|\w+::.*?\|]/g;

    return messages.map(message => {
        let newContent = message.content.replace(rolePattern, '');
        return {
            ...message,
            content: newContent
        };
    });
}

// 转换角色
function convertRoles(messages, roleFeatures) {
    const {systemRole, userRole, assistantRole} = roleFeatures;
    const roleMap = {
        'system': systemRole,
        'user': userRole,
        'human': userRole,
        'assistant': assistantRole
    };

    return messages.map(message => {
        let currentRole = message.role;

        if (currentRole.startsWith('\u0008')) {
            // 包含前缀不需要转换
            return message;
        } else {
            const roleKey = currentRole.toLowerCase();
            const newRole = roleMap[roleKey] || currentRole;
            return {...message, role: newRole};
        }
    });
}

// 替换 content 中的角色定义
function replaceRolesInContent(messages, roleFeatures) {
    // 避免重复添加
    const roleMap = {
        'System:': roleFeatures.systemRole.replace(roleFeatures.prefix, '') + ':',
        'system:': roleFeatures.systemRole.replace(roleFeatures.prefix, '') + ':',
        'Human:': roleFeatures.userRole.replace(roleFeatures.prefix, '') + ':',
        'human:': roleFeatures.userRole.replace(roleFeatures.prefix, '') + ':',
        'user:': roleFeatures.userRole.replace(roleFeatures.prefix, '') + ':',
        'Assistant:': roleFeatures.assistantRole.replace(roleFeatures.prefix, '') + ':',
        'assistant:': roleFeatures.assistantRole.replace(roleFeatures.prefix, '') + ':',
    };

    // 构建角色正则
    const escapedLabels = Object.keys(roleMap).map(label => escapeRegExp(label));
    const prefixPattern = roleFeatures.prefix ? escapeRegExp(roleFeatures.prefix) : '';

    const roleNamesPattern = new RegExp(`(\\n\\n)(${prefixPattern})?(${escapedLabels.join('|')})`, 'g');

    return messages.map(message => {
        let newContent = message.content;

        if (typeof newContent === 'string') {
            // 仅替换段落开头角色
            newContent = newContent.replace(roleNamesPattern, (match, p1, p2, p3) => {
                const newRoleLabel = roleMap[p3] || p3;
                const prefixToUse = p2 !== undefined ? p2 : roleFeatures.prefix;
                return p1 + (prefixToUse || '') + newRoleLabel;
            });
        } else {
            console.warn('message.content is not a string:', newContent);
            newContent = '';
        }

        return {
            ...message,
            content: newContent
        };
    });
}

/**
 * 在 CLEWD 阶段，对一组 messages 进行二次处理：
 *   若消息 content 不含 <|KEEP_ROLE|>，则将 role 置空。
 *   然后调用 xmlHyperProcess 做多轮正则、合并、<@N>插入、收尾清理。
 *
 * @param {Array} messages  - [{ role: 'user', content: '...' }, ...]
 * @param {object} roleFeatures - { systemRole, userRole, assistantRole, prefix }
 * @return {Array} 新的 messages
 */
export function xmlPlotAllMessages(messages, roleFeatures) {
    return messages.map((msg) => {
        if (!msg.content.includes('<|KEEP_ROLE|>')) {
            msg = {
                ...msg,
                role: ''  // 置空
            };
        }

        // 核心调用
        const processed = xmlHyperProcess(msg.content, roleFeatures);

        return { ...msg, content: processed };
    });
}

/**
 *   多轮 <regex order=1 / 2 / 3>
 *   MergeDisable 判断 + System => user 替换
 *   段落合并 + <@N>插入
 *   最终收尾 cleanup
 *
 * @param {string} originalContent
 * @param {object} roleFeatures
 * @returns {string} 处理后的文本
 */
function xmlHyperProcess(originalContent, roleFeatures) {
    let content = originalContent;
    let regexLogs = '';

    // 第1轮正则 (order=1)
    [content, regexLogs] = xmlHyperRegex(content, 1, regexLogs);

    // 检测 MergeDisable 标记
    const mergeDisable = {
        all: content.includes('<|Merge Disable|>'),
        system: content.includes('<|Merge System Disable|>'),
        user: content.includes('<|Merge Human Disable|>'),
        assistant: content.includes('<|Merge Assistant Disable|>')
    };

    // 把“system:”在部分情况下替换为“user:”
    content = preSystemToUserFallback(content, roleFeatures, mergeDisable);

    // 开始合并 (首次)
    content = xmlHyperMerge(content, roleFeatures, mergeDisable);

    // 处理 <@N> 插入
    content = handleSubInsertion(content);

    // 第2轮正则 (order=2)
    [content, regexLogs] = xmlHyperRegex(content, 2, regexLogs);

    // 第2次合并
    content = xmlHyperMerge(content, roleFeatures, mergeDisable);

    // 第3轮正则 (order=3)
    [content, regexLogs] = xmlHyperRegex(content, 3, regexLogs);

    // 插入对 <|padtxtX|> 的处理 or countTokens, etc.

    // 收尾清理
    content = finalizeCleanup(content);

    return content.trim();
}

/**
 * xmlHyperRegex:
 *   匹配 <regex order=?> " /pattern/flags ":" replacement" </regex> 并完成替换
 */
function xmlHyperRegex(original, order, logs) {
    let content = original;
    // 仅处理同 order 的 block
    const patternRegex = new RegExp(
        `<regex(?: +order *= *(${order}))?>\\s*"\\/([^"]*?)\\/([gimsyu]*)"\\s*:\\s*"(.*?)"\\s*<\\/regex>`,
        'gm'
    );

    let match;
    while ((match = patternRegex.exec(content)) !== null) {
        const entire = match[0];
        const rawPattern = match[2];
        const rawFlags = match[3];
        let replacement = match[4];

        logs += `${entire}\n`;
        try {
            const regObj = new RegExp(rawPattern, rawFlags);
            replacement = JSON.parse(`"${replacement.replace(/\\?"/g, '\\"')}"`); // 反序列化
            content = content.replace(regObj, replacement);
        } catch (err) {
            console.warn(`Regex parse/replace error in block: ${entire}\n`, err);
        }
    }
    return [content, logs];
}

/**
 * content = content.replace(...)
 * 而后 system: => user:
 * 根据 roleFeatures.systemRole / userRole 动态替换
 */
function preSystemToUserFallback(content, roleFeatures, mergeDisable) {
    if (mergeDisable.all || mergeDisable.system || mergeDisable.user) {
        return content; // 不做任何替换
    }

    const systemName = stripPrefix(roleFeatures.systemRole, roleFeatures.prefix);
    const userName = stripPrefix(roleFeatures.userRole, roleFeatures.prefix);
    const assistantName = stripPrefix(roleFeatures.assistantRole, roleFeatures.prefix);

    // 前面非 user|assistant 段落时的 system: -> 去掉
    const re1 = new RegExp(
        `(\\n\\n|^\\s*)(?<!\\n\\n(${userName}|${assistantName}):.*?)${systemName}:\\s*`,
        'gs'
    );
    content = content.replace(re1, '$1');

    // 补充 system => user
    const re2 = new RegExp(`(\\n\\n|^\\s*)${systemName}:\\s*`, 'g');
    content = content.replace(re2, `\n\n${userName}: `);

    return content;
}

/**
 * xmlHyperMerge:
 *   利用“段落合并”逻辑，动态 roleFeatures
 */
function xmlHyperMerge(original, roleFeatures, mergeDisable) {
    let content = original;
    if (mergeDisable.all) {
        return content; // 禁用合并
    }
    // 先获取名称
    const sys = stripPrefix(roleFeatures.systemRole, roleFeatures.prefix);
    const usr = stripPrefix(roleFeatures.userRole, roleFeatures.prefix);
    const ast = stripPrefix(roleFeatures.assistantRole, roleFeatures.prefix);

    // 合并 system 段
    if (!mergeDisable.system) {
        const regSys = new RegExp(`(?:\\n\\n|^\\s*)${escapeRegExp(sys)}:\\s*(.*?)(?=\\n\\n(?:${escapeRegExp(usr)}|${escapeRegExp(ast)}|$))`, 'gs');
        content = content.replace(regSys, (_m, p1) => `\n\n${sys}: ${p1}`);
    }

    // 合并 user 段
    if (!mergeDisable.user) {
        const regUsr = new RegExp(`(?:\\n\\n|^\\s*)${escapeRegExp(usr)}:\\s*(.*?)(?=\\n\\n(?:${escapeRegExp(ast)}|${escapeRegExp(sys)}|$))`, 'gs');
        content = content.replace(regUsr, (_m, p1) => `\n\n${usr}: ${p1}`);
    }

    // 合并 assistant 段
    if (!mergeDisable.assistant) {
        const regAst = new RegExp(`(?:\\n\\n|^\\s*)${escapeRegExp(ast)}:\\s*(.*?)(?=\\n\\n(?:${escapeRegExp(usr)}|${escapeRegExp(sys)}|$))`, 'gs');
        content = content.replace(regAst, (_m, p1) => `\n\n${ast}: ${p1}`);
    }

    return content;
}

/**
 * 先 splitContent = content.split(regExp)
 * 然后 for each <@N> => 把里面内容插入到 “倒数第N段落”后面
 * 删除 match[0]
 */
function handleSubInsertion(original) {
    let content = original;

    // 按  \n\n(?=.*?:) 拆分
    let splitted = content.split(/\n\n(?=.*?:)/g);

    let match;
    while ((match = /<@(\d+)>(.*?)<\/@\1>/gs.exec(content)) !== null) {
        const idx = splitted.length - parseInt(match[1], 10) - 1;
        if (idx >= 0 && splitted[idx]) {
            splitted[idx] += `\n\n${match[2]}`;
        }
        content = content.replace(match[0], '');
    }

    // 重组
    content = splitted.join('\n\n').replace(/<@(\d+)>.*?<\/@\1>/gs, '');
    return content;
}

/**
 * 移除 <regex> 块、统一换行、<|curtail|> => 换行，<|join|> => 空
 * <|space|> => ' '，以及 <|xxx|> => JSON.parse
 * 然后去除多余空行
 */
function finalizeCleanup(original) {
    let content = original;
    // 移除 <regex> 块
    content = content.replace(/<regex( +order *= *\d)?>.*?<\/regex>/gm, '');

    // 统一换行
    content = content.replace(/\r\n|\r/gm, '\n');

    // <|curtail|> => 换行
    content = content.replace(/\s*<\|curtail\|>\s*/g, '\n');

    // <|join|> => ''
    content = content.replace(/\s*<\|join\|>\s*/g, '');

    // <|space|> => ' '
    content = content.replace(/\s*<\|space\|>\s*/g, ' ');

    // JSON反序列化
    content = content.replace(/<\|(\\.*?)\|>/g, (m, p1) => {
        try {
            return JSON.parse(`"${p1.replace(/\\?"/g, '\\"')}"`);
        } catch {
            return m; // 保留原文本
        }
    });

    // 移除其他 <|xxx|> 标记
    content = content.replace(/\s*<\|(?!padtxt).*?\|>\s*/g, '\n\n');

    // 去除多余空行
    content = content.trim().replace(/(?<=\n)\n(?=\n)/g, '');

    return content;
}

/** stripPrefix: 如果 role 中含有前缀(如 \u0008)，去掉 */
function stripPrefix(fullStr, prefix) {
    if (!prefix) return fullStr;
    if (fullStr.startsWith(prefix)) {
        return fullStr.slice(prefix.length);
    }
    return fullStr;
}

/** 转义正则特殊字符 */
function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
