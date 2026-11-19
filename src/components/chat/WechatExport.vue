<script setup>
import { computed, onScopeDispose, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { exportWechatChecklist } from '../../services/wechat.js'

const props = defineProps({
  disabled: Boolean,
  draft: { type: String, default: '' }
})
const open = ref(false)
const request = ref('')
const busy = ref(false)
const voices = ref([])
const error = ref('')
const canExport = computed(() => request.value.trim() && voices.value.every(voice =>
  voice.time && voice.speaker.trim() && voice.text.trim()
))
let active
let nextVoiceId = 0

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

function closeDialog() {
  cancel()
  voices.value = []
}

onScopeDispose(cancel)

function addVoice() {
  voices.value.push({ id: nextVoiceId++, time: '', speaker: '', text: '' })
}

async function exportChecklist() {
  if (!canExport.value || busy.value) return
  const controller = new AbortController()
  active = controller
  busy.value = true
  error.value = ''
  try {
    const voiceTranscripts = voices.value.map(({ time, speaker, text }) => ({ time, speaker: speaker.trim(), text: text.trim() }))
    const { file, filename } = await exportWechatChecklist(request.value.trim(), voiceTranscripts, controller.signal)
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
  <el-button native-type="button" text size="small" :disabled="disabled" @click="openDialog">补充微信转写</el-button>
  <el-dialog
    v-model="open"
    title="补充微信转写"
    width="min(540px, calc(100vw - 32px))"
    append-to-body
    @close="closeDialog"
  >
    <p class="help">写出微信里的联系人备注和起止时间。微信文字和可用的语音转写会交给方舟一起整理。默认下载 Word，可在要求里写 Markdown。</p>
    <el-input
      v-model="request"
      type="textarea"
      :rows="4"
      maxlength="1200"
      aria-label="微信整理要求"
      placeholder="把我跟王老师 11 月 3 日到 11 月 6 日的论文修改意见分条整理成 Word"
      :disabled="busy"
    />
    <div class="voice-options">
      <p class="help">可以在微信对语音使用「转文字」，再把转写粘贴到这里。填写原来的发送时间和发言人。</p>
      <fieldset v-for="(voice, index) in voices" :key="voice.id" class="voice-entry" :disabled="busy">
        <legend>语音 {{ index + 1 }}</legend>
        <div class="voice-fields">
          <label>发送时间（北京时间）<el-input v-model="voice.time" type="datetime-local" step="60" /></label>
          <label>发言人<el-input v-model="voice.speaker" maxlength="120" placeholder="如王老师" /></label>
        </div>
        <el-input v-model="voice.text" type="textarea" :rows="3" aria-label="语音转写文字" placeholder="粘贴或校对微信转写" />
        <el-button native-type="button" text size="small" @click="voices.splice(index, 1)">移除这段</el-button>
      </fieldset>
      <el-button class="add-voice" native-type="button" size="small" :disabled="busy" @click="addVoice">添加一段转写</el-button>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <template #footer>
      <el-button native-type="button" @click="open = false">{{ busy ? '取消整理' : '取消' }}</el-button>
      <el-button
        native-type="button" type="primary" :loading="busy" :disabled="!canExport"
        @click="exportChecklist"
      >生成并下载</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.help { margin: 0 0 12px; color: var(--el-text-color-secondary); }
.error { margin: 12px 0 0; color: var(--el-color-danger); }
.voice-options { margin-top: 14px; }
.add-voice { margin-top: 8px; }
.voice-entry { min-width: 0; margin: 12px 0 0; padding: 10px; border: 1px solid var(--el-border-color); border-radius: 6px; }
.voice-entry legend { overflow-wrap: anywhere; }
.voice-fields { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.voice-fields label { flex: 1 0 160px; }
</style>
