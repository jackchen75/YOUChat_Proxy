import YouProvider from './you_providers/youProvider.mjs';
import PerplexityProvider from './perplexity_providers/perplexityProvider.mjs';
import HappyApiProvider from './happyapi_providers/happyApi.mjs';
import fs from 'fs';
import path from 'path';

// 动态导入配置文件
let youConfig;
try {
    // 尝试复制 config.mjs 到 xconfig.mjs (Docker环境下)
    if (fs.existsSync('/app/config.mjs') && !fs.existsSync('/app/xconfig.mjs')) {
        const configContent = fs.readFileSync('/app/config.mjs', 'utf8');
        fs.writeFileSync('/app/xconfig.mjs', configContent, 'utf8');
        console.log('已复制 /app/config.mjs 到 /app/xconfig.mjs');
    }
    
    // 导入配置
    const { config } = await import('./xconfig.mjs');
    youConfig = config;
} catch (e) {
    console.error('加载 xconfig.mjs 失败:', e);
    process.exit(1);
}

import {config as perplexityConfig} from './perplexityConfig.mjs';

class ProviderManager {
    constructor() {
        // 根据环境变量初始化提供者
        const activeProvider = process.env.ACTIVE_PROVIDER || 'you';

        switch (activeProvider) {
            case 'you':
                this.provider = new YouProvider(youConfig);
                break;
            case 'perplexity':
                this.provider = new PerplexityProvider(perplexityConfig);
                break;
            case 'happyapi':
                this.provider = new HappyApiProvider();
                break;
            default:
                throw new Error('Invalid ACTIVE_PROVIDER. Use "you", "perplexity", or "happyapi".');
        }

        console.log(`Initialized with ${activeProvider} provider.`);
    }

    async init() {
        await this.provider.init(this.provider.config);
        console.log(`Provider initialized.`);
    }

    async getCompletion(params) {
        return this.provider.getCompletion(params);
    }

    getCurrentProvider() {
        return this.provider.constructor.name;
    }

    getLogger() {
        return this.provider.logger;
    }

    getSessionManager() {
        return this.provider.sessionManager;
    }
}

export default ProviderManager;
