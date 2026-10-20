<script setup>
import AttachmentCard from './AttachmentCard.vue'
defineProps({ attachments: { type: Array, default: () => [] }, editable: Boolean })
defineEmits(['remove', 'retry'])
</script>
<template>
  <div v-if="attachments.length" class="attachment-list">
    <AttachmentCard v-for="attachment in attachments" :key="attachment.id" :attachment="attachment" :editable="editable"
      @remove="$emit('remove', $event)" @retry="$emit('retry', $event)" />
  </div>
</template>
<style scoped lang="scss">
.attachment-list { display: grid; gap: 8px; margin-bottom: 12px; min-width: 0; }
</style>
