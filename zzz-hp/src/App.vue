<script setup lang="ts">
import { RouterView } from 'vue-router'
import ThemeToggle from '@/components/ThemeToggle.vue'
import HomeGuestbook from '@/components/home/HomeGuestbook.vue'
import MiyousheLoginDialog from '@/components/auth/MiyousheLoginDialog.vue'
</script>

<template>
  <RouterView v-slot="{ Component }">
    <!-- 计算器离开再返回时保持内存态，避免 Buff / 怪物被重挂载冲掉 -->
    <KeepAlive :include="['CharacterCalculatorView']">
      <component :is="Component" />
    </KeepAlive>
  </RouterView>
  <ThemeToggle />
  <HomeGuestbook />
  <MiyousheLoginDialog />
</template>
