<script setup lang="ts">
import AdminBossInfoCatalogPanel from '@/components/admin/AdminBossInfoCatalogPanel.vue'
</script>

<template>
  <main class="admin-boss-info-page">
    <RouterLink to="/admin" class="back">← 返回管理入口</RouterLink>
    <AdminBossInfoCatalogPanel />
  </main>
</template>

<style scoped>
.admin-boss-info-page {
  min-height: 100vh;
  padding: 1.25rem 1rem 2rem;
  max-width: 1240px;
  margin: 0 auto;
}

.back {
  display: inline-block;
  margin-bottom: 1rem;
  font-size: 0.85rem;
  color: var(--color-text);
  opacity: 0.75;
  text-decoration: none;
}

.back:hover {
  opacity: 1;
}
</style>
