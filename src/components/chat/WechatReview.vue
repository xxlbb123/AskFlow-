<script setup>
defineProps({ review: { type: Object, required: true }, busy: Boolean })

const displayTime = value => value?.replace('T', ' ')
</script>

<template>
  <p v-if="review.status === 'confirmed'" class="review-state">已确认，清单见下方回复。</p>
  <p v-else-if="review.status === 'expired' || review.loadError" class="review-state">这批记录已结束或暂时无法恢复。可在聊天里重新查询。</p>
  <p v-else-if="!review.rows" class="review-state" role="status">正在恢复待核对的微信记录…</p>
  <section v-else class="wechat-review" aria-label="待核对的微信记录">
    <header class="review-summary">
      <strong>{{ review.contact }} · {{ review.rows.length }} 条记录</strong>
      <span>{{ displayTime(review.from) }} 至 {{ displayTime(review.to) }}</span>
    </header>
    <p v-for="warning in review.warnings" :key="warning" class="review-state">{{ warning }}</p>
    <p class="review-state">直接改写正文，清空一条可略过。核对完成后在聊天中回复「确认整理」。</p>
    <div class="review-rows" tabindex="0" aria-label="微信消息列表">
      <label v-for="row in review.rows" :key="row.index" class="review-row">
        <span class="row-meta">
          <span>{{ displayTime(row.when) }} · {{ row.speaker }}</span>
          <span v-if="row.source !== 'chat'">{{ row.text ? '语音转写' : '待转写语音' }}</span>
        </span>
        <textarea v-model="row.editedText" rows="2" :readonly="busy"
          :aria-label="`第 ${row.index + 1} 条微信记录`"
          :placeholder="row.source !== 'chat' ? '可在这里补上语音内容' : '此条将在整理时略过'" />
      </label>
    </div>
  </section>
</template>

<style scoped>
.wechat-review { margin-top: 12px; padding: 12px; border: 1px solid var(--el-border-color); border-radius: 10px; background: var(--chat-surface); }
.review-summary { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 4px 16px; font-size: 13px; }
.review-summary span, .review-state, .row-meta { color: var(--chat-muted); font-size: 12px; }
.review-state { margin: 8px 0; }
.review-rows { max-height: 380px; overflow: auto; overscroll-behavior: contain; padding: 0 4px 2px 0; }
.review-row { display: grid; gap: 5px; margin: 0 0 9px; }
.row-meta { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 4px 10px; }
.review-row textarea { width: 100%; resize: vertical; padding: 6px 8px; color: inherit; background: var(--chat-background); border: 1px solid var(--el-border-color); border-radius: 6px; font: inherit; }
.review-row textarea:focus-visible { outline: 1px solid var(--chat-accent); outline-offset: 1px; }
</style>
