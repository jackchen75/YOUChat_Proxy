/**
 * @param {Object} page - Puppeteer
 * @param {Object} options - 配置选项
 * @param {number} options.width - 视口宽度
 * @param {number} options.height - 视口高度
 * @param {number} options.deviceScaleFactor - 设备缩放因子
 * @param {boolean} options.isMobile - 模拟移动设备
 * @param {boolean} options.hasTouch - 支持触摸
 * @param {boolean} options.isLandscape - 横屏
 * @returns {Promise<void>}
 */
export async function fixBrowserDisplay(page, options = {}) {
    if (!page) {
        console.error('页面对象为空，无法修复显示');
        return;
    }

    const defaultOptions = {
        width: 1280,
        height: 800,
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        isLandscape: true
    };

    const settings = {...defaultOptions, ...options};

    try {
        // 设置视口大小和设备比例
        await page.setViewport({
            width: settings.width,
            height: settings.height,
            deviceScaleFactor: settings.deviceScaleFactor,
            isMobile: settings.isMobile,
            hasTouch: settings.hasTouch,
            isLandscape: settings.isLandscape
        });

        // 尝试调整窗口大小
        const session = await page.target().createCDPSession();
        await session.send('Emulation.setDeviceMetricsOverride', {
            width: settings.width,
            height: settings.height,
            deviceScaleFactor: settings.deviceScaleFactor,
            mobile: settings.isMobile,
            screenWidth: settings.width,
            screenHeight: settings.height
        });

        // 重置页面缩放
        await page.evaluate(() => {
            document.body.style.zoom = '100%';
            document.body.style.transform = 'scale(1)';
            document.body.style.transformOrigin = '0 0';

            // 尝试修复可能存在的CSS
            const styleElement = document.createElement('style');
            styleElement.textContent = `
                html, body {
                    width: 100% !important;
                    height: 100% !important;
                    overflow: auto !important;
                }

                .container, .main, #app, #root {
                    max-width: 100% !important;
                    width: auto !important;
                }
            `;
            document.head.appendChild(styleElement);

            window.dispatchEvent(new Event('resize'));
        });

    } catch (error) {
        console.error('修复浏览器显示时出错:', error);
    }
}

/**
 * 调整CSS比例
 * @param {Object} page - Puppeteer
 * @param {number} scale - 缩放比例
 * @returns {Promise<void>}
 */
export async function adjustCssScaling(page, scale = 1) {
    if (!page) return;

    try {
        await page.evaluate((scale) => {
            const styleElem = document.createElement('style');
            styleElem.id = 'puppeteer-display-fix';
            styleElem.textContent = `
                html {
                    transform: scale(${scale});
                    transform-origin: top left;
                    width: ${100 / scale}% !important;
                    height: ${100 / scale}% !important;
                }
            `;
            document.head.appendChild(styleElem);

            // 重新计算布局
            window.dispatchEvent(new Event('resize'));
        }, scale);
    } catch (error) {
        console.error('调整CSS比例时出错:', error);
    }
}

/**
 * 修复高DPI
 * @param {Object} page - Puppeteer
 * @returns {Promise<void>}
 */
export async function fixHighDpiDisplay(page) {
    if (!page) return;

    try {
        // 检测设备像素比
        const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);

        if (devicePixelRatio > 1) {
            await page.setViewport({
                width: 1280,
                height: 800,
                deviceScaleFactor: devicePixelRatio
            });

            await page.evaluate((dpr) => {
                const meta = document.createElement('meta');
                meta.setAttribute('name', 'viewport');
                meta.setAttribute('content', `initial-scale=1, minimum-scale=1, maximum-scale=1, width=device-width, height=device-height, target-densitydpi=device-dpi, user-scalable=no`);
                document.head.appendChild(meta);
            }, devicePixelRatio);
        }
    } catch (error) {
        console.error('修复高DPI显示时出错:', error);
    }
}

/**
 * 完整浏览器显示优化
 * @param {Object} page - Puppeteer
 * @param {Object} options - 配置
 * @returns {Promise<void>}
 */
export async function optimizeBrowserDisplay(page, options = {}) {
    const defaultOptions = {
        width: 1280,
        height: 800,
        deviceScaleFactor: 1,
        cssScale: null,
        fixHighDpi: true,
        forceResize: true
    };

    const config = {...defaultOptions, ...options};

    try {
        // 基本显示修复
        await fixBrowserDisplay(page, {
            width: config.width,
            height: config.height,
            deviceScaleFactor: config.deviceScaleFactor
        });

        // 修复高DPI显示
        if (config.fixHighDpi) {
            await fixHighDpiDisplay(page);
        }

        if (config.cssScale !== null) {
            await adjustCssScaling(page, config.cssScale);
        }

        // 如果强制调整窗口大小
        if (config.forceResize && !config.isHeadless) {
            try {
                const client = await page.target().createCDPSession();
                await client.send('Browser.getWindowForTarget');
                await client.send('Browser.setWindowBounds', {
                    windowId: 1,
                    bounds: {
                        width: config.width,
                        height: config.height
                    }
                });
            } catch (resizeError) {
                // console.log('无法调整窗口大小:', resizeError.message);

                try {
                    await page.evaluate((width, height) => {
                        window.resizeTo(width, height);
                    }, config.width, config.height);
                } catch (altError) {
                    console.log('失败:', altError.message);
                }
            }
        }

    } catch (error) {
        console.error('浏览器显示优化失败:', error);
    }
}
