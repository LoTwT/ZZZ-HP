<script setup lang="ts">
import { watch } from 'vue'
import type { SkillDamageType, SkillSubcategory, SkillTypeId } from '@/types/calculator'
import { DAMAGE_EVENT_KIND_OPTIONS } from '@/utils/damageEvent'
import { skillNeedsDualAgents } from '@/utils/resolvedHit'
import { SKILL_TYPE_OPTIONS } from '@/utils/skillTypes'

const draft = defineModel<{
  name: string
  damageType: SkillDamageType
  skillTypes: SkillTypeId[]
  buffAnchorId: string
  baseMult: number
  settlementMult: number
}>({ required: true })

const props = defineProps<{
  readonly?: boolean
  anchors: SkillSubcategory[]
}>()

watch(
  () => draft.value.damageType,
  (type) => {
    if (props.readonly || !skillNeedsDualAgents(type)) return
    draft.value.skillTypes = []
    draft.value.buffAnchorId = ''
  },
)

function toggleSkillType(id: SkillTypeId) {
  if (props.readonly) return
  const index = draft.value.skillTypes.indexOf(id)
  if (index >= 0) draft.value.skillTypes.splice(index, 1)
  else draft.value.skillTypes.push(id)
}
</script>

<template>
  <div class="custom-form" :class="{ 'is-readonly': readonly }">
    <label>
      <span>名称</span>
      <input v-model="draft.name" placeholder="显示名称" :disabled="readonly" />
    </label>
    <label>
      <span>伤害类型</span>
      <select v-model="draft.damageType" :disabled="readonly">
        <option v-for="opt in DAMAGE_EVENT_KIND_OPTIONS" :key="opt.id" :value="opt.id">
          {{ opt.label }}
        </option>
      </select>
    </label>
    <div v-if="!skillNeedsDualAgents(draft.damageType)" class="type-checks">
      <span>招式类型（可多选，可空）</span>
      <div class="chip-row">
        <button
          v-for="opt in SKILL_TYPE_OPTIONS"
          :key="opt.id"
          type="button"
          class="chip"
          :class="{ active: draft.skillTypes.includes(opt.id) }"
          :disabled="readonly"
          @click="toggleSkillType(opt.id)"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>
    <p v-else class="empty-hint">异常类不设招式类型和增益锚点，因此不会吃招式限定 Buff。</p>
    <label v-if="!skillNeedsDualAgents(draft.damageType)">
      <span>增益锚点（仅本角色）</span>
      <select v-model="draft.buffAnchorId" :disabled="readonly">
        <option value="">无</option>
        <option v-for="item in anchors" :key="item.id" :value="item.id">
          {{ item.name }}
        </option>
      </select>
    </label>
    <label>
      <span>基础倍率%</span>
      <input v-model.number="draft.baseMult" type="number" :disabled="readonly" />
    </label>
    <label v-if="draft.damageType === 'direct'">
      <span>决算倍率%</span>
      <input v-model.number="draft.settlementMult" type="number" :disabled="readonly" />
    </label>
  </div>
</template>

<style scoped>
.custom-form {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.custom-form.is-readonly {
  opacity: 0.92;
}
.custom-form label,
.type-checks {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.76rem;
  color: #9aa3b0;
}
.custom-form input,
.custom-form select {
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #0f1217;
  color: #e8edf5;
  padding: 0.3rem 0.45rem;
}
.custom-form input:disabled,
.custom-form select:disabled,
.chip:disabled {
  opacity: 0.75;
  cursor: default;
}
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.chip {
  border: 1px solid #343a44;
  border-radius: 999px;
  background: #12161d;
  color: #d5dae4;
  padding: 0.22rem 0.6rem;
  font-size: 0.74rem;
  cursor: pointer;
}
.chip.active {
  border-color: #c9a55c;
  background: rgba(201, 165, 92, 0.14);
  color: #f0d7a2;
}
.empty-hint {
  margin: 0;
  color: #9aa3b0;
  font-size: 0.78rem;
}
</style>
