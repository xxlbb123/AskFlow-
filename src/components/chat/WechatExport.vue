<script setup>
import { onScopeDispose, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { exportWechatChecklist } from '../../services/wechat.js'

const props = defineProps({
  disabled: Boolean,
  draft: { type: String, default: '' }
})
const open = ref(false)
const request = ref('')
const busy = ref(false)
const error = ref('')
let active

function openDialog() {
  request.value = props.draft.trim().slice(0, 1200)
  error.value = ''
  open.value = true
}

function cancel() {
  active?.abort()
  active = null
  busy.value = false
}

onScopeDispose(cancel)

async function exportChecklist() {
  if (!request.value.trim() || busy.value) return
  const controller = new AbortController()
  active = controller
  busy.value = true
  error.value = ''
  try {
    const { file, filename } = await exportWechatChecklist(request.value.trim(), controller.signal)
    controller.signal.throwIfAborted()
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    open.value = false
    ElMessage.success('论文修改清单已下载')
  } catch (cause) {
    if (!controller.signal.aborted) error.value = cause.message || '微信整理失败，请重试'
  } finally {
    if (active === controller) cancel()
  }
}
</script>

<template>
  <el-button native-type="button" text size="small" :disabled="disabled" @click="openDialog">微信整理</el-button>
  <el-dialog
    v-model="open"
    title="从微信整理论文反馈"
    width="min(540px, calc(100vw - 32px))"
    append-to-body
    @close="cancel"
  >
    <p class="help">写出微信里的联系人备注和起止时间。选定范围内的文字会交给方舟整理。默认下载 Word，可在要求里写 Markdown。</p>
    <el-input
      v-model="request"
      type="textarea"
      :rows="4"
      maxlength="1200"
      aria-label="微信整理要求"
      placeholder="把我跟王老师 11 月 3 日到 11 月 6 日的论文修改意见分条整理成 Word"
      :disabled="busy"
    />
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <template #footer>
      <el-button native-type="button" @click="open = false">{{ busy ? '取消整理' : '取消' }}</el-button>
      <el-button
        native-type="button" type="primary" :loading="busy" :disabled="!request.trim()"
        @click="exportChecklist"
      >生成并下载</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.help { margin: 0 0 12px; color: var(--el-text-color-secondary); }
.error { margin: 12px 0 0; color: var(--el-color-danger); }
</style>
