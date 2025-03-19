import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";
import {Mutex} from "async-mutex";

const configMutex = new Mutex(); // 互斥锁

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE_PATH = path.join(__dirname, "../config.mjs");

// 仅在 USE_MANUAL_LOGIN 为 false 且 ENABLE_AUTO_COOKIE_UPDATE 为 true 时生效
const ENABLE_AUTO_COOKIE_UPDATE = process.env.ENABLE_AUTO_COOKIE_UPDATE === "true";

function unifyQuotesForJSON(str) {
    // 正则匹配 `` `...` ``
    let out = str.replace(/`([^`]*)`/g, (match, p1) => {
        const safe = p1.replace(/"/g, '\\"');
        return `"${safe}"`;
    });
    out = out.replace(/'([^']*)'/g, (match, p1) => {
        const safe = p1.replace(/"/g, '\\"');
        return `"${safe}"`;
    });

    return out;
}


/**
 * cookies 解析出 DS 与 DSR
 * @param {Array} cookies 获取到的 cookie 数组
 * @returns {{ ds?: string, dsr?: string }}
 */
function parseDSAndDSR(cookies) {
    let dsValue, dsrValue;
    for (const c of cookies) {
        if (c.name === "DS") {
            dsValue = c.value;
        } else if (c.name === "DSR") {
            dsrValue = c.value;
        }
    }
    return {ds: dsValue, dsr: dsrValue};
}

/**
 * 从 DS 中解析 email 字段
 * @param {string} dsToken DS cookie
 * @returns {string|null} 返回 email或null
 */
function decodeEmailFromDs(dsToken) {
    try {
        const parts = dsToken.split(".");
        if (parts.length < 2) return null;
        const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
        return payload.email || null;
    } catch (err) {
        return null;
    }
}

/**
 * cookie 数组转换 "name=value; name=value"
 * @param {Array} cookies
 * @returns {string}
 */
function cookiesToStringAll(cookies) {
    return cookies.map(c => `${c.name}=${c.value}`).join("; ");
}

/**
 * cookie 转换数组
 * 每个对象如 { name, value }
 * @param {string} cookieStr
 * @returns {Array}
 */
function parseCookieString(cookieStr) {
    return cookieStr.split("; ").map(entry => {
        const [name, value] = entry.split("=", 2);
        return {name, value};
    });
}

/**
 * 本地 configObj.sessions 查找与指定 email 匹配的 session，
 * @param {object} configObj 解析后 config
 * @param {string} email 匹配的邮箱
 * @returns {{ index: number, oldCookie: string, ds: string, dsr: string } | null}
 */
function findSessionByEmail(configObj, email) {
    if (!Array.isArray(configObj.sessions)) return null;
    for (let i = 0; i < configObj.sessions.length; i++) {
        const cookieStr = configObj.sessions[i].cookie || "";
        const dsMatch = /DS=([^;\s]+)/.exec(cookieStr);
        if (!dsMatch) continue;
        const dsValue = dsMatch[1];
        const dsEmail = decodeEmailFromDs(dsValue);
        if (dsEmail && dsEmail.toLowerCase() === email.toLowerCase()) {
            const dsrMatch = /DSR=([^;\s]+)/.exec(cookieStr);
            const dsrValue = dsrMatch ? dsrMatch[1] : "";
            return {
                index: i,
                oldCookie: cookieStr,
                ds: dsValue,
                dsr: dsrValue
            };
        }
    }
    return null;
}

/**
 * config.mjs 中匹配相同 email 的 session，若 DS 或 DSR 有变化，则更新整个 cookie
 * @param {import('puppeteer-core').Page} page
 */
export async function updateLocalConfigCookieByEmail(page) {
    if (!ENABLE_AUTO_COOKIE_UPDATE || process.env.USE_MANUAL_LOGIN === "true") {
        return;
    }
    // 尝试从 “https://you.com/api/instrumentation” 获取 cookie
    let cookieStringFromInstrumentation = "";
    try {
        const instrRequest = await page.waitForRequest(
            req => req.url().includes("/api/instrumentation"),
            {timeout: 5000}
        );
        if (instrRequest) {
            cookieStringFromInstrumentation = instrRequest.headers()["cookie"];
        }
    } catch (err) {
    }

    let allCookiesString = "";
    if (cookieStringFromInstrumentation) {
        allCookiesString = cookieStringFromInstrumentation;
    } else {
        // 使用 page.cookies() 获取
        const cookies = await page.cookies("https://you.com");
        allCookiesString = cookiesToStringAll(cookies);
    }

    const cookieArray = parseCookieString(allCookiesString);
    const {ds: newDs, dsr: newDsr} = parseDSAndDSR(cookieArray);
    if (!newDs) {
        console.log("网页未找到 DS，跳过更新。");
        return;
    }
    const newEmail = decodeEmailFromDs(newDs);
    if (!newEmail) {
        console.log("[网页无法从 DS 解出 email，跳过更新。");
        return;
    }

    // 互斥区
    await configMutex.runExclusive(async () => {
        try {
            if (!fs.existsSync(CONFIG_FILE_PATH)) {
                console.warn(`找不到 config.mjs: ${CONFIG_FILE_PATH}`);
                return;
            }
            const raw = fs.readFileSync(CONFIG_FILE_PATH, "utf8");
            // 去掉 export const config =
            let jsonString = raw.replace(/^export const config\s*=\s*/, "").trim();

            jsonString = unifyQuotesForJSON(jsonString);

            const configObj = JSON.parse(jsonString);

            const found = findSessionByEmail(configObj, newEmail);
            if (!found) {
                console.log(`未能在 config 中找到 email=${newEmail} 的 session，跳过更新。`);
                return;
            }

            if (found.ds === newDs && found.dsr === newDsr) {
                console.log(`DS/DSR 未变化(email=${newEmail})，不更新。`);
                return;
            }

            configObj.sessions[found.index].cookie = allCookiesString;

            const newFileContent = "export const config = " + JSON.stringify(configObj, null, 4);
            fs.writeFileSync(CONFIG_FILE_PATH, newFileContent, "utf8");

            console.log(`Cookie已更新(email=${newEmail})`);
        } catch (err) {
            console.warn("Cookie更新过程出错:", err);
        }
    });
}

/**
 * 非阻塞
 * @param {import('puppeteer-core').Page} page
 */
export function updateLocalConfigCookieByEmailNonBlocking(page) {
    // 保证异步
    setImmediate(() => {
        updateLocalConfigCookieByEmail(page).catch(err =>
            console.error("Cookie update error:", err)
        );
    });
}