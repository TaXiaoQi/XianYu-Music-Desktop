import { ref } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import type { PluginSettings, PluginSubscription } from '../../types';
import {
  addSubscription,
  getSubscriptions,
  installAllSubscriptions,
  installFromSubscriptionUrl,
  isValidSubscriptionUrl,
  removeSubscription,
  updateSubscription,
} from '../../services/domain/pluginEngine';
import { useToast } from '../toast';
import { validatePluginUrl } from './usePluginInstall';

interface UsePluginSubscriptionsOptions {
  isPluginBusy: Ref<boolean>;
  refreshPluginList: () => void;
  pluginSettings: ComputedRef<PluginSettings>;
}

/**
 * 插件订阅源管理：添加/移除订阅、单源同步安装、全部同步、订阅名称行内编辑。
 */
export function usePluginSubscriptions(options: UsePluginSubscriptionsOptions) {
  const { isPluginBusy, refreshPluginList, pluginSettings } = options;
  const { showToast, showProgressToast } = useToast();

  const subscriptions = ref<PluginSubscription[]>(getSubscriptions());
  const showAddSubscriptionInput = ref(false);
  const newSubscriptionUrl = ref('');

  function handleAddSubscription() {
    showAddSubscriptionInput.value = !showAddSubscriptionInput.value;
    newSubscriptionUrl.value = '';
  }

  function confirmAddSubscription() {
    const url = newSubscriptionUrl.value.trim();
    if (!url) {
      showToast('请输入订阅 URL', 'error');
      return;
    }

    if (!validatePluginUrl(url) || !isValidSubscriptionUrl(url)) {
      showToast('订阅链接需为公网 http/https 链接且以 .js 或 .json 结尾', 'error');
      return;
    }

    const sub = addSubscription({ name: '', url });
    if (!sub) {
      showToast('该订阅已存在或 URL 无效', 'error');
      return;
    }
    subscriptions.value = getSubscriptions();
    newSubscriptionUrl.value = '';
    showAddSubscriptionInput.value = false;
    showToast(`已添加订阅: ${sub.name}`, 'success');
  }

  async function handleInstallFromSubscription(sub: PluginSubscription) {
    if (isPluginBusy.value) return;
    isPluginBusy.value = true;
    const progress = showProgressToast(`正在同步订阅 ${sub.name}...`);
    try {
      const result = await installFromSubscriptionUrl(sub.url, {
        skipVersionCheck: pluginSettings.value.skipVersionCheck,
        onPluginProgress: (done, total, name) => {
          const current = Math.min(done + 1, total);
          progress.update(
            name ? `正在安装 ${name} (${current}/${total})` : `正在安装插件 (${current}/${total})`,
            total > 0 ? (current / total) * 100 : 100,
          );
        },
      });
      updateSubscription(sub.id, {
        lastSyncAt: Date.now(),
        lastSyncStatus: result.failCount === 0 ? 'success' : (result.successCount > 0 ? 'partial' : 'failed'),
        lastSyncMessage: result.errors[0] || `成功安装 ${result.successCount} 个插件`,
        lastSyncCount: result.successCount,
      });
      subscriptions.value = getSubscriptions();
      refreshPluginList();
      if (result.successCount > 0) {
        progress.complete(
          `从 ${sub.name} 安装 ${result.successCount} 个插件${result.failCount ? `，${result.failCount} 个失败` : ''}`,
          'success',
        );
      } else {
        progress.fail(`从 ${sub.name} 安装失败: ${result.errors[0] || '无可安装插件'}`);
      }
    } catch (e: any) {
      progress.fail(`同步失败: ${e?.message || e}`);
    } finally {
      isPluginBusy.value = false;
      progress.close();
    }
  }

  const syncingAll = ref(false);
  async function handleSyncAllSubscriptions() {
    if (syncingAll.value || isPluginBusy.value) return;
    if (subscriptions.value.length === 0) {
      showToast('暂无订阅源', 'info');
      return;
    }
    syncingAll.value = true;
    const progress = showProgressToast(`正在同步订阅 (0/${subscriptions.value.length})`);
    try {
      const res = await installAllSubscriptions((index, total, sub) => {
        progress.update(
          `正在同步 ${sub.name || '订阅'} (${index + 1}/${total})`,
          ((index + 1) / total) * 100,
        );
      });
      subscriptions.value = getSubscriptions();
      refreshPluginList();
      progress.complete(
        `同步完成: 共安装 ${res.totalInstalled} 个插件${res.failedSubs ? `，${res.failedSubs} 个订阅失败` : ''}`,
        res.failedSubs ? 'info' : 'success',
      );
    } catch (e: any) {
      progress.fail(`同步失败: ${e?.message || e}`);
    } finally {
      syncingAll.value = false;
      progress.close();
    }
  }

  // ==================== 订阅名称编辑 ====================
  const editingSubId = ref<string | null>(null);
  const editingSubName = ref('');
  function startEditSubName(sub: PluginSubscription) {
    editingSubId.value = sub.id;
    editingSubName.value = sub.name;
  }
  function saveSubName(sub: PluginSubscription) {
    if (editingSubId.value !== sub.id) return;
    const name = editingSubName.value.trim();
    if (name && name !== sub.name) {
      updateSubscription(sub.id, { name });
      subscriptions.value = getSubscriptions();
    }
    editingSubId.value = null;
  }
  function cancelEditSubName() {
    editingSubId.value = null;
  }

  const showRemoveSubscriptionConfirm = ref(false);
  const pendingRemoveSubscription = ref<PluginSubscription | null>(null);

  function handleRemoveSubscription(sub: PluginSubscription) {
    pendingRemoveSubscription.value = sub;
    showRemoveSubscriptionConfirm.value = true;
  }

  function confirmRemoveSubscription() {
    const sub = pendingRemoveSubscription.value;
    if (!sub) return;
    removeSubscription(sub.id);
    subscriptions.value = getSubscriptions();
    showRemoveSubscriptionConfirm.value = false;
    pendingRemoveSubscription.value = null;
    showToast(`已移除订阅 ${sub.name}`, 'success');
  }

  return {
    subscriptions,
    showAddSubscriptionInput,
    newSubscriptionUrl,
    syncingAll,
    editingSubId,
    editingSubName,
    showRemoveSubscriptionConfirm,
    pendingRemoveSubscription,
    handleAddSubscription,
    confirmAddSubscription,
    handleInstallFromSubscription,
    handleSyncAllSubscriptions,
    startEditSubName,
    saveSubName,
    cancelEditSubName,
    handleRemoveSubscription,
    confirmRemoveSubscription,
  };
}
