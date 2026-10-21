<script setup lang="ts">
import { reactive } from 'vue';
import { Eye, EyeOff } from 'lucide-vue-next';

// 标题由宿主的展开条承担，这里只渲染表单本体（头部已并入展开条）
defineProps<{
  editing: boolean;
  persisting: boolean;
  probing: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  probe: [];
  submit: [];
}>();

const name = defineModel<string>('name', { required: true });
const address = defineModel<string>('baseUrl', { required: true });
const account = defineModel<string>('username', { required: true });
const secret = defineModel<string>('password', { required: true });
const rootDirectory = defineModel<string>('rootPath', { required: true });

const revealed = reactive<Record<'secret', boolean>>({ secret: false });
const holdingFocus = reactive<Record<'secret', boolean>>({ secret: false });

const toggleReveal = () => {
  revealed.secret = !revealed.secret;
};

const dropFocus = () => {
  holdingFocus.secret = false;
  revealed.secret = false;
};
</script>

<template>
  <section class="rl-editor">
    <div class="rl-sheet">
      <div class="rl-grid">
        <label class="rl-grid__cell">
          <span>名称</span>
          <input v-model="name" type="text" class="rl-input" placeholder="我的 WebDAV" />
        </label>
        <label class="rl-grid__cell">
          <span>服务器地址</span>
          <input v-model="address" type="url" class="rl-input" placeholder="https://example.com/dav" />
        </label>
        <label class="rl-grid__cell">
          <span>用户名</span>
          <input v-model="account" type="text" class="rl-input" autocomplete="username" />
        </label>
        <label class="rl-grid__cell">
          <span>密码</span>
          <div class="rl-grid__secret" @focusin="holdingFocus.secret = true" @focusout="dropFocus">
            <input
              v-model="secret"
              :type="revealed.secret ? 'text' : 'password'"
              class="rl-input rl-input--with-toggle"
              autocomplete="current-password"
            />
            <button
              v-show="holdingFocus.secret && secret.length > 0"
              type="button"
              class="rl-grid__eye"
              :aria-label="revealed.secret ? '隐藏密码' : '查看密码'"
              @mousedown.prevent
              @click="toggleReveal"
            >
              <EyeOff v-if="revealed.secret" class="rl-grid__eye-icon" />
              <Eye v-else class="rl-grid__eye-icon" />
            </button>
          </div>
        </label>
        <label class="rl-grid__cell">
          <span>根目录</span>
          <input v-model="rootDirectory" type="text" class="rl-input" placeholder="/" />
        </label>
      </div>

      <div class="rl-editor__actions">
        <button type="button" class="rl-button rl-button--ghost" @click="emit('cancel')">
          取消
        </button>
        <button type="button" class="rl-button rl-button--ghost" :disabled="probing" @click="emit('probe')">
          {{ probing ? '测试中...' : '测试连接' }}
        </button>
        <button type="button" class="rl-button" :disabled="persisting" @click="emit('submit')">
          {{ persisting ? '保存中...' : '保存' }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.rl-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
  animation: rl-editor-enter 240ms ease both;
}

@keyframes rl-editor-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }

  to {
    opacity: 1;
    transform: none;
  }
}

.rl-sheet {
  padding: 0 16px 16px;
}

.rl-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
}

.rl-grid__cell {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
  color: rgb(55 65 81);
  font-size: 12px;
  font-weight: 600;
}

.rl-input {
  height: 32px;
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.45);
  padding: 0 12px;
  color: rgb(31 41 55);
  font-size: 12px;
  font-weight: 500;
  outline: none;
  transition: all 150ms;
}

.rl-input--with-toggle {
  padding-right: 36px;
}

.rl-input::placeholder {
  color: rgb(156, 163, 175);
}

.rl-input:focus {
  border-color: rgba(236, 65, 65, 0.5);
  background: rgba(255, 255, 255, 0.7);
  box-shadow: 0 0 0 2px rgba(236, 65, 65, 0.1);
}

.rl-grid__secret {
  position: relative;
}

.rl-grid__eye {
  position: absolute;
  top: 50%;
  right: 4px;
  padding: 4px;
  transform: translateY(-50%);
  color: rgba(0, 0, 0, 0.4);
  cursor: pointer;
  transition: color 150ms ease;
}

.rl-grid__eye:hover {
  color: #ec4141;
}

.rl-grid__eye-icon {
  width: 16px;
  height: 16px;
}

.rl-editor__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
}

.rl-button {
  min-height: 36px;
  border: 1px solid rgba(236, 65, 65, 0.18);
  border-radius: 999px;
  background: #ec4141;
  padding: 0 15px;
  color: #ffffff;
  font-size: 12px;
  font-weight: 700;
}

.rl-button:hover:not(:disabled) {
  background: #d13b3b;
}

.rl-button--ghost {
  background: rgba(236, 65, 65, 0.07);
  color: #ec4141;
}

.rl-button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

html.dark .rl-editor__back {
  color: #9ca3af;
}

html.dark .rl-editor__back:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
}

html.dark .rl-editor__title {
  color: #e5e7eb;
}

html.dark .rl-sheet {
  border-color: rgba(31, 41, 55, 0.4);
  background: rgba(0, 0, 0, 0.1);
}

html.dark .rl-grid__cell {
  color: rgba(255, 255, 255, 0.72);
}

html.dark .rl-input {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgb(243 244 246);
}

html.dark .rl-input::placeholder {
  color: rgba(255, 255, 255, 0.35);
}

html.dark .rl-input:focus {
  background: rgba(255, 255, 255, 0.1);
}

html.dark .rl-grid__eye {
  color: rgba(255, 255, 255, 0.4);
}
</style>
