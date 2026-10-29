/**
 * ==============================================================================
 * JeikCode 二次开发 - 自定义功能挂载中心 (Custom Feature Registry)
 * ==============================================================================
 * 规范原则：
 * 1. 所有新增加的业务逻辑、第三方工具接入、自定义操作菜单集中在此处维护；
 * 2. 避免直接在官方 App.tsx 或核心组件内堆砌业务逻辑代码；
 * 3. 采用事件驱动或观察者模式注入。
 * ==============================================================================
 */

export interface CustomExtension {
  id: string;
  name: string;
  version: string;
  init: () => void;
}

class CustomExtensionRegistry {
  private extensions: Map<string, CustomExtension> = new Map();

  register(extension: CustomExtension) {
    if (this.extensions.has(extension.id)) {
      console.warn(`[CustomRegistry] Extension ${extension.id} already registered.`);
      return;
    }
    this.extensions.set(extension.id, extension);
    try {
      extension.init();
      console.log(`[CustomRegistry] Extension initialized: ${extension.name} (v${extension.version})`);
    } catch (e) {
      console.error(`[CustomRegistry] Failed to init extension ${extension.id}:`, e);
    }
  }

  getAll() {
    return Array.from(this.extensions.values());
  }
}

export const customRegistry = new CustomExtensionRegistry();

// 【示例扩展】演示非侵入式功能扩展：
customRegistry.register({
  id: 'custom-hello-banner',
  name: 'Custom Feature Banner',
  version: '1.0.0',
  init: () => {
    // 页面加载后的无侵入自定义功能钩子
    console.info('[Custom] 二次开发功能已就绪，上游官方更新可无冲突同步。');
  },
});
